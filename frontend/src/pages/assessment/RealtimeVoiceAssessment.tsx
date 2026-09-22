import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PhoneOff, Radio } from "lucide-react";
import type { AssessmentSummary } from "@alt-assessment/shared";
import { RubricFeedback } from "../../components/RubricFeedback";
import { connectRealtimeVoice, finalizeRealtimeVoice, logRealtimeVoiceEvents, type RealtimeVoiceEventPayload } from "../../lib/api";
import { resolveRealtimeVoiceMaxSessionSec } from "../../lib/uploadPolicy";

type RealtimeSessionStatus = "idle" | "connecting" | "live" | "finalizing" | "complete" | "error";

export function RealtimeVoiceAssessment({ assessment, disabled, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const maxSessionSec = resolveRealtimeVoiceMaxSessionSec(assessment.config);
  const [status, setStatus] = useState<RealtimeSessionStatus>("idle");
  const [localError, setLocalError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [events, setEvents] = useState<RealtimeVoiceEventPayload[]>([]);
  const [remainingSec, setRemainingSec] = useState(maxSessionSec);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingEventsRef = useRef<RealtimeVoiceEventPayload[]>([]);
  const sequenceRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const attemptIdRef = useRef<string | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const timeoutTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const finalizingRef = useRef(false);

  useEffect(() => {
    return () => {
      cleanupRealtimeConnection();
      if (flushTimerRef.current) window.clearTimeout(flushTimerRef.current);
    };
  }, []);

  function recordEvent(event: Omit<RealtimeVoiceEventPayload, "sequence" | "occurredAt"> & { occurredAt?: string }) {
    const nextEvent: RealtimeVoiceEventPayload = {
      ...event,
      sequence: sequenceRef.current,
      occurredAt: event.occurredAt ?? new Date().toISOString()
    };
    sequenceRef.current += 1;
    pendingEventsRef.current.push(nextEvent);
    setEvents((current) => [...current, nextEvent]);
    scheduleFlush();
  }

  function scheduleFlush() {
    if (flushTimerRef.current || !sessionIdRef.current) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      void flushPendingEvents();
    }, 2500);
  }

  async function flushPendingEvents() {
    const activeSessionId = sessionIdRef.current;
    if (!activeSessionId || pendingEventsRef.current.length === 0) return;
    const batch = pendingEventsRef.current.splice(0, pendingEventsRef.current.length);
    try {
      await logRealtimeVoiceEvents({ sessionId: activeSessionId, events: batch });
    } catch (error) {
      pendingEventsRef.current = [...batch, ...pendingEventsRef.current];
      setLocalError(error instanceof Error ? error.message : "Could not save live voice events.");
    }
  }

  async function beginRealtimeSession() {
    if (!window.RTCPeerConnection || !navigator.mediaDevices?.getUserMedia) {
      setLocalError("This browser does not support live voice assessment.");
      return;
    }

    await onSubmit(async (attemptId) => {
      cleanupRealtimeConnection();
      setLocalError(null);
      setEvents([]);
      setSessionId(null);
      setModel(null);
      setRemainingSec(maxSessionSec);
      pendingEventsRef.current = [];
      sequenceRef.current = 0;
      attemptIdRef.current = attemptId;
      setStatus("connecting");

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const peer = new RTCPeerConnection();
        peerRef.current = peer;
        stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));
        peer.ontrack = (event) => {
          if (audioRef.current) {
            audioRef.current.srcObject = event.streams[0];
          }
        };

        const channel = peer.createDataChannel("oai-events");
        dataChannelRef.current = channel;
        channel.addEventListener("open", () => {
          recordEvent({ eventType: "session_started", role: "status", text: "Live voice session started.", metadata: { model: model ?? "gpt-realtime" } });
          channel.send(JSON.stringify({
            type: "response.create",
            response: {
              instructions: "Briefly invite the student to answer the assessment prompt, then give concise feedback after they respond."
            }
          }));
        });
        channel.addEventListener("message", (event) => {
          const normalized = normalizeRealtimeServerEvent(event.data);
          if (normalized) recordEvent(normalized);
        });
        channel.addEventListener("error", () => {
          recordEvent({ eventType: "data_channel_error", role: "status", text: "Realtime event channel reported an error.", metadata: {} });
        });

        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        if (!offer.sdp) throw new Error("Browser did not create a realtime SDP offer.");

        const response = await connectRealtimeVoice({ attemptId, sdpOffer: offer.sdp });
        sessionIdRef.current = response.sessionId;
        setSessionId(response.sessionId);
        setModel(response.model);
        await peer.setRemoteDescription({ type: "answer", sdp: response.sdpAnswer });
        setStatus("live");
        startSessionTimers(response.expiresAt);
      } catch (error) {
        cleanupRealtimeConnection();
        setStatus("error");
        setLocalError(error instanceof Error ? error.message : "Could not start live voice assessment.");
      }
    });
  }

  function startSessionTimers(expiresAt: string) {
    const deadline = Date.parse(expiresAt);
    const update = () => setRemainingSec(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    update();
    countdownTimerRef.current = window.setInterval(update, 250);
    // Leave time to commit the final audio turn before the provider cutoff.
    timeoutTimerRef.current = window.setTimeout(() => { void endRealtimeSession("timeout"); }, Math.max(0, deadline - Date.now() - 1500));
  }

  async function endRealtimeSession(reason: "student_end" | "timeout") {
    if (finalizingRef.current) return;
    const activeSessionId = sessionIdRef.current;
    const activeAttemptId = attemptIdRef.current;
    if (!activeSessionId || !activeAttemptId) {
      setLocalError("No live voice session is ready to finalize.");
      return;
    }
    finalizingRef.current = true;
    setStatus("finalizing");
    recordEvent({
      eventType: "session_ended",
      role: "status",
      text: reason === "timeout" ? "Live voice session reached the time limit." : "Live voice session ended by the student.",
      metadata: { reason }
    });
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false; });

    try {
      const finalEvents = pendingEventsRef.current.splice(0, pendingEventsRef.current.length);
      await finalizeRealtimeVoice({ sessionId: activeSessionId, events: finalEvents });
      setStatus("complete");
      navigate(`/attempt/${activeAttemptId}`);
    } catch (error) {
      setStatus("error");
      setLocalError(error instanceof Error ? error.message : "Could not finalize live voice assessment.");
    } finally {
      cleanupRealtimeConnection();
      finalizingRef.current = false;
    }
  }

  function cleanupRealtimeConnection() {
    if (timeoutTimerRef.current) window.clearTimeout(timeoutTimerRef.current);
    if (countdownTimerRef.current) window.clearInterval(countdownTimerRef.current);
    timeoutTimerRef.current = null;
    countdownTimerRef.current = null;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
  }

  const transcriptEvents = events.filter((event) => event.text && (event.role === "student" || event.role === "assistant"));
  const canStart = status === "idle" || status === "error";
  const canEnd = status === "live";

  return (
    <div className="workspace-grid">
      <section className="recorder-panel realtime-panel" aria-label="Live voice assessment">
        <div className="recording-meter">
          <span className={status === "live" ? "record-dot active" : "record-dot"} />
          <strong>{formatRealtimeStatus(status)}</strong>
          <span>{status === "live" ? `${remainingSec}s left` : `${maxSessionSec}s max`}</span>
        </div>
        <audio ref={audioRef} autoPlay aria-label="Live model audio" />
        <div className="realtime-session-actions">
          {canStart && (
            <button className="primary-button" type="button" onClick={() => { void beginRealtimeSession(); }} disabled={disabled}>
              <Radio size={18} /> Start live assessment
            </button>
          )}
          {canEnd && (
            <button className="danger-button" type="button" onClick={() => { void onSubmit(async () => endRealtimeSession("student_end")); }} disabled={disabled}>
              <PhoneOff size={18} /> End and submit
            </button>
          )}
        </div>
        {model && <p className="overall-comment">Model: {model}</p>}
        {sessionId && <p className="overall-comment">Session: {sessionId}</p>}
        {localError && <p className="field-error">{localError}</p>}
        <div className="realtime-log" aria-live="polite">
          {transcriptEvents.length === 0 ? (
            <p className="status-line">Live transcript and feedback will appear here.</p>
          ) : (
            transcriptEvents.map((event) => (
              <article key={event.sequence} className={`realtime-log-entry ${event.role ?? "status"}`}>
                <strong>{event.role === "student" ? "Student" : "GPT"}</strong>
                <p>{event.text}</p>
              </article>
            ))
          )}
        </div>
      </section>
      <RubricFeedback feedback={null} rubric={assessment.rubric} />
    </div>
  );
}

function formatRealtimeStatus(status: RealtimeSessionStatus): string {
  if (status === "connecting") return "Connecting";
  if (status === "live") return "Live";
  if (status === "finalizing") return "Submitting";
  if (status === "complete") return "Submitted";
  if (status === "error") return "Needs retry";
  return "Ready";
}

function normalizeRealtimeServerEvent(data: string): Omit<RealtimeVoiceEventPayload, "sequence" | "occurredAt"> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return {
      eventType: "unparseable_event",
      role: "status",
      text: "Received an unreadable realtime event.",
      metadata: {}
    };
  }
  if (!isRecord(raw)) return null;
  const type = typeof raw.type === "string" ? raw.type : "event";
  if (type.endsWith(".delta")) return null;

  if (type.includes("input_audio_transcription") && typeof raw.transcript === "string" && raw.transcript.trim()) {
    return {
      eventType: type,
      role: "student",
      text: raw.transcript.trim(),
      metadata: compactRealtimeMetadata(raw)
    };
  }

  if ((type.includes("response.audio_transcript") || type.includes("response.text")) && typeof raw.transcript === "string" && raw.transcript.trim()) {
    return {
      eventType: type,
      role: "assistant",
      text: raw.transcript.trim(),
      metadata: compactRealtimeMetadata(raw)
    };
  }

  if (type.includes("response.text") && typeof raw.text === "string" && raw.text.trim()) {
    return {
      eventType: type,
      role: "assistant",
      text: raw.text.trim(),
      metadata: compactRealtimeMetadata(raw)
    };
  }

  if (type === "response.done") {
    const text = extractRealtimeResponseText(raw.response);
    if (text) {
      return {
        eventType: type,
        role: "assistant",
        text,
        metadata: compactRealtimeMetadata(raw)
      };
    }
  }

  if (type === "error") {
    const message = isRecord(raw.error) && typeof raw.error.message === "string"
      ? raw.error.message
      : "The realtime model reported an error.";
    return {
      eventType: type,
      role: "status",
      text: message,
      metadata: compactRealtimeMetadata(raw)
    };
  }

  if (type === "session.created" || type === "input_audio_buffer.speech_started" || type === "input_audio_buffer.speech_stopped") {
    return {
      eventType: type,
      role: "status",
      text: null,
      metadata: compactRealtimeMetadata(raw)
    };
  }

  return null;
}

function extractRealtimeResponseText(response: unknown): string | null {
  if (!isRecord(response) || !Array.isArray(response.output)) return null;
  const parts: string[] = [];
  for (const output of response.output) {
    if (!isRecord(output) || !Array.isArray(output.content)) continue;
    for (const content of output.content) {
      if (!isRecord(content)) continue;
      if (typeof content.transcript === "string" && content.transcript.trim()) {
        parts.push(content.transcript.trim());
      } else if (typeof content.text === "string" && content.text.trim()) {
        parts.push(content.text.trim());
      }
    }
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

function compactRealtimeMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const key of ["type", "event_id", "item_id", "response_id", "output_index", "content_index"]) {
    const value = raw[key];
    if (typeof value === "string" || typeof value === "number") metadata[key] = value;
  }
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
