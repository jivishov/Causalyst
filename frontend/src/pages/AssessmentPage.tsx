import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, PhoneOff, Radio, Send } from "lucide-react";
import {
  DEFAULT_SIMULATION_HTML_REASONING_EFFORT,
  SIMULATION_HTML_REASONING_EFFORTS,
  assessSimulationDescriptionReadiness,
  getSimulationCodeModelLabel,
  type AssessmentSummary,
  type SimulationHtmlReasoningEffort,
  type StudentSimulationGenerationJob,
  type StudentSimulationPreview
} from "@alt-assessment/shared";
import { AudioRecorder, type RecordingResult } from "../components/AudioRecorder";
import { PdfImageUploader } from "../components/PdfImageUploader";
import { RubricFeedback } from "../components/RubricFeedback";
import { SimulationPreviewFrame, type SimulationPreviewHealthReport } from "../components/SimulationPreviewFrame";
import { ApiRequestError, cancelSimulationGenerationJob, connectRealtimeVoice, fallbackSimulationPreview, finalizeRealtimeVoice, generateSimulation, generateSimulationSketch, getSimulationGenerationJob, getSimulationPreviewUrl, gradeVoice, gradeWriting, logRealtimeVoiceEvents, refineSimulation, reserveUpload, startAttempt, submitSimulation, uploadArtifact, type RealtimeVoiceEventPayload } from "../lib/api";
import {
  SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE,
  canCancelSimulationGenerationJob,
  canRetrySimulationHtmlPreview,
  isActiveSimulationGenerationJob,
  isRetryableSimulationAttemptError,
  isTerminalSimulationJobStatus,
  resolveSimulationGenerateButtonLabel,
  resolveSimulationReadinessMessage,
  resolveSimulationRunMessage,
  type SimulationGenerationStage
} from "../lib/simulationGenerationUi";
import { extractLifecycleAssignmentId, extractLifecycleAttemptId, resolveStudentLifecycleError } from "../lib/studentLifecycle";
import { formatBytes, resolveAudioMaxBytes, resolveRealtimeVoiceMaxSessionSec, resolveSimulationMinDescriptionChars, resolveVoiceMaxRecordingSec, resolveWritingAcceptedMime, resolveWritingMaxBytes } from "../lib/uploadPolicy";
import { useSession } from "../state/session";

interface SimulationDraftState {
  attemptId: string;
  description: string;
  simulationPreview: StudentSimulationPreview | null;
  simulationSketchPreview: StudentSimulationPreview | null;
  activeSimulationJob: StudentSimulationGenerationJob | null;
}

export function AssessmentPage() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { assignments } = useSession();
  const assignment = useMemo(() => assignments.find((item) => item.assignmentId === assignmentId), [assignmentId, assignments]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationDraft, setSimulationDraft] = useState<SimulationDraftState | null>(null);
  const restoredDraftAssignmentRef = useRef<string | null>(null);

  useEffect(() => {
    setAttemptId(null);
    setSimulationDraft(null);
    restoredDraftAssignmentRef.current = null;
  }, [assignment?.assignmentId]);

  useEffect(() => {
    if (!assignment) return;
    if (assignment.assessment.type !== "simulation") return;
    if (assignment.latestAttempt?.status !== "draft") return;
    if (attemptId || restoredDraftAssignmentRef.current === assignment.assignmentId) return;

    let cancelled = false;
    restoredDraftAssignmentRef.current = assignment.assignmentId;
    startAttempt(assignment.assignmentId)
      .then((created) => {
        if (cancelled) return;
        setAttemptId(created.attemptId);
        setSimulationDraft(created.simulationDraft ? {
          attemptId: created.attemptId,
          ...created.simulationDraft
        } : null);
      })
      .catch((err) => {
        if (!cancelled) setError(resolveStudentLifecycleError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [assignment, assignment?.assignmentId, assignment?.assessment.type, assignment?.latestAttempt?.status, attemptId]);

  if (!assignment) return <Navigate to="/" replace />;
  const activeAssignment = assignment;
  const activeAssessment = activeAssignment.assessment;

  async function ensureAttempt() {
    if (attemptId) return attemptId;
    const created = await startAttempt(activeAssignment.assignmentId);
    setAttemptId(created.attemptId);
    setSimulationDraft(created.simulationDraft ? {
      attemptId: created.attemptId,
      ...created.simulationDraft
    } : null);
    return created.attemptId;
  }

  async function runSubmission(task: (id: string) => Promise<void>): Promise<void> {
    setError(null);
    setWorking(true);
    try {
      await task(await ensureAttempt());
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && (err.code === "already_submitted" || err.code === "final_published")) {
        const attemptIdFromError = extractLifecycleAttemptId(err);
        if (attemptIdFromError) {
          navigate(`/attempt/${attemptIdFromError}`);
          return;
        }
        const assignmentIdFromError = err.code === "final_published" ? extractLifecycleAssignmentId(err) : null;
        if (assignmentIdFromError) {
          navigate(`/final/${assignmentIdFromError}`);
          return;
        }
      }
      setError(resolveStudentLifecycleError(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="page-stack">
      <button className="text-button" type="button" onClick={() => navigate("/")}>
        <ArrowLeft size={17} /> Dashboard
      </button>
      <header className="assessment-header">
        <div>
          <div className="assessment-title-row">
            <span className={`mode-label ${activeAssessment.type}`}>{formatAssessmentTypeLabel(activeAssessment.type)}</span>
            <h1>{activeAssessment.title}</h1>
          </div>
          <p>{activeAssignment.classCode} · {activeAssignment.className}</p>
          <p>{activeAssessment.prompt}</p>
        </div>
      </header>
      {error && <p className="field-error">{error}</p>}
      {activeAssessment.type !== "simulation" && working && <p className="status-line">Processing your submission</p>}
      {activeAssessment.type === "voice" && (
          <VoiceAssessment assessment={activeAssessment} disabled={working} onSubmit={(task) => runSubmission(task)} />
      )}
      {activeAssessment.type === "voice_realtime" && (
          <RealtimeVoiceAssessment assessment={activeAssessment} disabled={working} onSubmit={(task) => runSubmission(task)} />
      )}
      {activeAssessment.type === "writing" && (
          <WritingAssessment assessment={activeAssessment} disabled={working} onSubmit={(task) => runSubmission(task)} />
      )}
      {activeAssessment.type === "simulation" && (
          <SimulationAssessment
            assessment={activeAssessment}
            disabled={working}
            initialDraft={simulationDraft}
            onRecoverAttempt={() => setAttemptId(null)}
            onSubmit={(task) => runSubmission(task)}
          />
      )}
    </div>
  );
}

function formatAssessmentTypeLabel(type: AssessmentSummary["type"]): string {
  if (type === "voice") return "Voice Message";
  if (type === "voice_realtime") return "Live Voice Assessment";
  if (type === "writing") return "Writing";
  return "Simulation";
}

function formatSimulationHtmlReasoningEffort(effort: SimulationHtmlReasoningEffort): string {
  if (effort === "low") return "Low";
  if (effort === "high") return "High";
  return "Medium";
}

function VoiceAssessment({ assessment, disabled, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const maxRecordingSec = resolveVoiceMaxRecordingSec(assessment.config);
  const maxAudioBytes = resolveAudioMaxBytes(assessment.config);

  return (
    <div className="workspace-grid">
      <AudioRecorder onReady={setRecording} maxSeconds={maxRecordingSec} />
      <RubricFeedback feedback={null} rubric={assessment.rubric} />
      <button
        className="primary-button submit-button"
        disabled={!recording || disabled}
        type="button"
        onClick={() => onSubmit(async (attemptId) => {
          if (!recording) return;
          if (recording.blob.size > maxAudioBytes) {
            throw new Error(`Recording exceeds max size of ${formatBytes(maxAudioBytes)}. Retake a shorter answer.`);
          }
          const upload = await reserveUpload({
            attemptId,
            kind: "audio",
            mimeType: recording.blob.type || "audio/webm",
            filename: "voice-response.webm",
            byteSize: recording.blob.size
          });
          await uploadArtifact(upload, recording.blob);
          await gradeVoice({ attemptId, artifactId: upload.artifactId, browserTranscript: recording.transcript });
          navigate(`/attempt/${attemptId}`);
        })}
      >
        <Send size={18} /> Submit voice response
      </button>
    </div>
  );
}

type RealtimeSessionStatus = "idle" | "connecting" | "live" | "finalizing" | "complete" | "error";

function RealtimeVoiceAssessment({ assessment, disabled, onSubmit }: {
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
        startSessionTimers(response.maxSessionSec);
      } catch (error) {
        cleanupRealtimeConnection();
        setStatus("error");
        setLocalError(error instanceof Error ? error.message : "Could not start live voice assessment.");
      }
    });
  }

  function startSessionTimers(seconds: number) {
    const startedAt = Date.now();
    setRemainingSec(seconds);
    countdownTimerRef.current = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setRemainingSec(Math.max(0, seconds - elapsed));
    }, 1000);
    timeoutTimerRef.current = window.setTimeout(() => {
      void endRealtimeSession("timeout");
    }, seconds * 1000);
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
    cleanupRealtimeConnection();

    try {
      const finalEvents = pendingEventsRef.current.splice(0, pendingEventsRef.current.length);
      await finalizeRealtimeVoice({ sessionId: activeSessionId, events: finalEvents });
      setStatus("complete");
      navigate(`/attempt/${activeAttemptId}`);
    } catch (error) {
      setStatus("error");
      setLocalError(error instanceof Error ? error.message : "Could not finalize live voice assessment.");
    } finally {
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

function WritingAssessment({ assessment, disabled, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const acceptedMime = resolveWritingAcceptedMime(assessment.config);
  const maxBytes = resolveWritingMaxBytes(assessment.config);

  return (
    <div className="workspace-grid">
      <PdfImageUploader onFile={setFile} acceptedMime={acceptedMime} maxBytes={maxBytes} />
      <RubricFeedback feedback={null} rubric={assessment.rubric} />
      <button
        className="primary-button submit-button"
        disabled={!file || disabled}
        type="button"
        onClick={() => onSubmit(async (attemptId) => {
          if (!file) return;
          const upload = await reserveUpload({
            attemptId,
            kind: "writing",
            mimeType: file.type || "application/octet-stream",
            filename: file.name,
            byteSize: file.size
          });
          await uploadArtifact(upload, file);
          await gradeWriting({ attemptId, artifactId: upload.artifactId });
          navigate(`/attempt/${attemptId}`);
        })}
      >
        <Send size={18} /> Submit written work
      </button>
    </div>
  );
}

function SimulationAssessment({ assessment, disabled, initialDraft, onRecoverAttempt, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  initialDraft: SimulationDraftState | null;
  onRecoverAttempt: () => void;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const minDescriptionChars = resolveSimulationMinDescriptionChars(assessment.config);
  const [description, setDescription] = useState("");
  const [generationStage, setGenerationStage] = useState<SimulationGenerationStage>("idle");
  const [runStarted, setRunStarted] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [sketchArtifactId, setSketchArtifactId] = useState<string | null>(null);
  const [sketchPreviewPath, setSketchPreviewPath] = useState<string | null>(null);
  const [sketchPreviewToken, setSketchPreviewToken] = useState<string | null>(null);
  const [sketchPreviewUrl, setSketchPreviewUrl] = useState<string | null>(null);
  const [sketchRequestedModel, setSketchRequestedModel] = useState<string | null>(null);
  const [sketchModelUsed, setSketchModelUsed] = useState<string | null>(null);
  const [sketchPreviewRequested, setSketchPreviewRequested] = useState(false);
  const [sketchPreviewError, setSketchPreviewError] = useState<string | null>(null);
  const [sketchPreviewLoaded, setSketchPreviewLoaded] = useState(false);
  const [htmlArtifactId, setHtmlArtifactId] = useState<string | null>(null);
  const [htmlPreviewPath, setHtmlPreviewPath] = useState<string | null>(null);
  const [htmlPreviewToken, setHtmlPreviewToken] = useState<string | null>(null);
  const [htmlPreviewGenerationSource, setHtmlPreviewGenerationSource] = useState<StudentSimulationPreview["generationSource"] | null>(null);
  const [htmlPreviewViewport, setHtmlPreviewViewport] = useState<StudentSimulationPreview["htmlViewport"] | null>(null);
  const [selectedHtmlReasoningEffort, setSelectedHtmlReasoningEffort] = useState<SimulationHtmlReasoningEffort>(DEFAULT_SIMULATION_HTML_REASONING_EFFORT);
  const [currentHtmlReasoningEffort, setCurrentHtmlReasoningEffort] = useState<SimulationHtmlReasoningEffort | null>(null);
  const [htmlPreviewUrl, setHtmlPreviewUrl] = useState<string | null>(null);
  const [htmlRequestedModel, setHtmlRequestedModel] = useState<string | null>(null);
  const [htmlModelUsed, setHtmlModelUsed] = useState<string | null>(null);
  const [htmlPreviewRequested, setHtmlPreviewRequested] = useState(false);
  const [htmlPreviewError, setHtmlPreviewError] = useState<string | null>(null);
  const [htmlPreviewLoaded, setHtmlPreviewLoaded] = useState(false);
  const [htmlPreviewLoadedAt, setHtmlPreviewLoadedAt] = useState<number | null>(null);
  const [htmlPreviewHealthNonce, setHtmlPreviewHealthNonce] = useState<string | null>(null);
  const [htmlPreviewHealthMessage, setHtmlPreviewHealthMessage] = useState<string | null>(null);
  const [htmlGenerationJob, setHtmlGenerationJob] = useState<StudentSimulationGenerationJob | null>(null);
  const [htmlGenerationMessage, setHtmlGenerationMessage] = useState<string | null>(null);
  const [refiningPreview, setRefiningPreview] = useState(false);
  const [fallbackPreviewRunning, setFallbackPreviewRunning] = useState(false);
  const [fallbackPreviewError, setFallbackPreviewError] = useState<string | null>(null);
  const [cancellingGeneration, setCancellingGeneration] = useState(false);
  const [submittingSimulation, setSubmittingSimulation] = useState(false);
  const [inputPanelOpen, setInputPanelOpen] = useState(true);
  const sketchPanelRef = useRef<HTMLElement | null>(null);
  const generationRunTokenRef = useRef(0);
  const sketchPreviewLoadTokenRef = useRef(0);
  const htmlPreviewLoadTokenRef = useRef(0);
  const htmlJobPollTokenRef = useRef(0);
  const restoredDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      generationRunTokenRef.current += 1;
      htmlJobPollTokenRef.current += 1;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (sketchPreviewUrl) URL.revokeObjectURL(sketchPreviewUrl);
    };
  }, [sketchPreviewUrl]);

  useEffect(() => {
    return () => {
      if (htmlPreviewUrl) URL.revokeObjectURL(htmlPreviewUrl);
    };
  }, [htmlPreviewUrl]);

  function resetGeneratedState() {
    generationRunTokenRef.current += 1;
    sketchPreviewLoadTokenRef.current += 1;
    htmlPreviewLoadTokenRef.current += 1;
    htmlJobPollTokenRef.current += 1;
    setGenerationStage("idle");
    setRunStarted(false);
    setRunError(null);
    setRefiningPreview(false);
    setSubmittingSimulation(false);
    setSketchArtifactId(null);
    setSketchPreviewPath(null);
    setSketchPreviewToken(null);
    setSketchRequestedModel(null);
    setSketchModelUsed(null);
    setSketchPreviewRequested(false);
    setSketchPreviewError(null);
    setSketchPreviewLoaded(false);
    setSketchPreviewUrl((existing) => {
      if (existing) URL.revokeObjectURL(existing);
      return null;
    });
    setHtmlArtifactId(null);
    setHtmlPreviewPath(null);
    setHtmlPreviewToken(null);
    setHtmlPreviewGenerationSource(null);
    setHtmlPreviewViewport(null);
    setCurrentHtmlReasoningEffort(null);
    setHtmlRequestedModel(null);
    setHtmlModelUsed(null);
    setHtmlPreviewRequested(false);
    setHtmlPreviewError(null);
    setHtmlPreviewLoaded(false);
    setHtmlPreviewLoadedAt(null);
    setHtmlPreviewHealthNonce(null);
    setHtmlPreviewHealthMessage(null);
    setHtmlGenerationJob(null);
    setHtmlGenerationMessage(null);
    setFallbackPreviewRunning(false);
    setFallbackPreviewError(null);
    setHtmlPreviewUrl((existing) => {
      if (existing) URL.revokeObjectURL(existing);
      return null;
    });
    setCancellingGeneration(false);
  }

  async function requestSketchPreview(input?: { artifactId: string; previewPath: string; previewToken: string }) {
    const targetArtifactId = input?.artifactId ?? sketchArtifactId;
    const targetPreviewPath = input?.previewPath ?? sketchPreviewPath;
    const targetPreviewToken = input?.previewToken ?? sketchPreviewToken;
    if (!targetArtifactId || !targetPreviewPath || !targetPreviewToken) {
      setSketchPreviewError("No simulation sketch artifact is available for preview.");
      return;
    }

    const currentToken = sketchPreviewLoadTokenRef.current + 1;
    sketchPreviewLoadTokenRef.current = currentToken;

    setSketchPreviewError(null);
    setSketchPreviewLoaded(false);
    setSketchPreviewRequested(true);
    try {
      const nextUrl = await getSimulationPreviewUrl({
        artifactId: targetArtifactId,
        previewPath: targetPreviewPath,
        previewToken: targetPreviewToken
      });
      if (sketchPreviewLoadTokenRef.current !== currentToken) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      setSketchPreviewUrl((existing) => {
        if (existing) URL.revokeObjectURL(existing);
        return nextUrl;
      });
    } catch (error) {
      if (sketchPreviewLoadTokenRef.current !== currentToken) return;
      setSketchPreviewLoaded(false);
      setSketchPreviewError(error instanceof Error ? error.message : "Sketch preview failed to load.");
    }
  }

  async function requestHtmlPreview(input?: StudentSimulationPreview) {
    const targetArtifactId = input?.artifactId ?? htmlArtifactId;
    const targetPreviewPath = input?.previewPath ?? htmlPreviewPath;
    const targetPreviewToken = input?.previewToken ?? htmlPreviewToken;
    if (!targetArtifactId || !targetPreviewPath || !targetPreviewToken) {
      setHtmlPreviewError("No simulation HTML artifact is available for preview.");
      return;
    }

    const currentToken = htmlPreviewLoadTokenRef.current + 1;
    htmlPreviewLoadTokenRef.current = currentToken;

    setHtmlPreviewError(null);
    setHtmlPreviewLoaded(false);
    setHtmlPreviewLoadedAt(null);
    setHtmlPreviewHealthMessage(null);
    setHtmlPreviewHealthNonce(null);
    setHtmlPreviewRequested(true);
    try {
      const healthNonce = makeSimulationPreviewHealthNonce();
      const nextUrl = await getSimulationPreviewUrl({
        artifactId: targetArtifactId,
        previewPath: targetPreviewPath,
        previewToken: targetPreviewToken,
        healthNonce
      });
      if (htmlPreviewLoadTokenRef.current !== currentToken) {
        URL.revokeObjectURL(nextUrl);
        return;
      }
      if (input) {
        setHtmlPreviewGenerationSource(input.generationSource ?? null);
        setCurrentHtmlReasoningEffort(input.htmlReasoningEffort ?? null);
        setHtmlPreviewViewport(input.htmlViewport ?? null);
      }
      setHtmlPreviewHealthNonce(healthNonce);
      setHtmlPreviewUrl((existing) => {
        if (existing) URL.revokeObjectURL(existing);
        return nextUrl;
      });
    } catch (error) {
      if (htmlPreviewLoadTokenRef.current !== currentToken) return;
      setHtmlPreviewLoaded(false);
      setHtmlPreviewLoadedAt(null);
      setHtmlPreviewHealthNonce(null);
      setHtmlPreviewError(error instanceof Error ? error.message : "HTML preview failed to load.");
    }
  }

  async function pollHtmlGenerationJob(job: StudentSimulationGenerationJob, input: {
    runToken: number;
    preservePreviewOnFailure: boolean;
    preservePreviewFailureMessage?: string;
  }): Promise<StudentSimulationGenerationJob | null> {
    const pollToken = htmlJobPollTokenRef.current + 1;
    htmlJobPollTokenRef.current = pollToken;
    let currentJob = job;
    const startedAt = Date.now();
    setHtmlGenerationJob(currentJob);
    setHtmlGenerationMessage(currentJob.message);
    setCurrentHtmlReasoningEffort(currentJob.htmlReasoningEffort ?? null);

    while (generationRunTokenRef.current === input.runToken && htmlJobPollTokenRef.current === pollToken) {
      if (currentJob.status === "completed" && currentJob.preview) {
        setHtmlArtifactId(currentJob.preview.artifactId);
        setHtmlPreviewPath(currentJob.preview.previewPath);
        setHtmlPreviewToken(currentJob.preview.previewToken);
        setHtmlPreviewGenerationSource(currentJob.preview.generationSource ?? "model");
        setHtmlPreviewViewport(currentJob.preview.htmlViewport ?? null);
        setHtmlRequestedModel(currentJob.requestedModel ?? null);
        setHtmlModelUsed(currentJob.modelUsed ?? null);
        setCurrentHtmlReasoningEffort(currentJob.preview.htmlReasoningEffort ?? currentJob.htmlReasoningEffort ?? null);
        setHtmlGenerationMessage(currentJob.message);
        await requestHtmlPreview(currentJob.preview);
        setGenerationStage("done");
        return currentJob;
      }

      if (isTerminalSimulationJobStatus(currentJob.status)) {
        const message = currentJob.errorMessage ?? currentJob.message;
        setHtmlGenerationMessage(message);
        setHtmlPreviewError(input.preservePreviewOnFailure ? input.preservePreviewFailureMessage ?? "Could not refine preview. Current preview was not changed." : message);
        setGenerationStage("done");
        return currentJob;
      }

      await waitForSimulationJobPoll(resolveSimulationJobPollDelayMs(startedAt));
      if (generationRunTokenRef.current !== input.runToken || htmlJobPollTokenRef.current !== pollToken) return null;
      currentJob = await getSimulationGenerationJob(currentJob.jobId);
      setHtmlGenerationJob(currentJob);
      setHtmlGenerationMessage(currentJob.message);
      setCurrentHtmlReasoningEffort(currentJob.htmlReasoningEffort ?? null);
      if (currentJob.status === "finalizing") setGenerationStage("html");
    }
    return null;
  }

  useEffect(() => {
    if (!initialDraft) return;
    const sketchArtifactKey = initialDraft.simulationSketchPreview?.artifactId ?? "no-sketch";
    const htmlArtifactKey = initialDraft.simulationPreview?.artifactId ?? "no-html";
    const activeJobKey = initialDraft.activeSimulationJob?.jobId ?? "no-job";
    const draftKey = `${initialDraft.attemptId}:${sketchArtifactKey}:${htmlArtifactKey}:${activeJobKey}:${initialDraft.description}`;
    if (restoredDraftKeyRef.current === draftKey) return;
    restoredDraftKeyRef.current = draftKey;

    resetGeneratedState();
    setDescription(initialDraft.description);
    setRunStarted(Boolean(initialDraft.simulationSketchPreview || initialDraft.simulationPreview || initialDraft.activeSimulationJob));
    setGenerationStage(initialDraft.activeSimulationJob ? "html" : initialDraft.simulationPreview || initialDraft.simulationSketchPreview ? "done" : "idle");
    setInputPanelOpen(!initialDraft.simulationPreview);
    if (initialDraft.activeSimulationJob) {
      setHtmlGenerationJob(initialDraft.activeSimulationJob);
      setHtmlGenerationMessage(initialDraft.activeSimulationJob.message);
      setCurrentHtmlReasoningEffort(initialDraft.activeSimulationJob.htmlReasoningEffort ?? null);
    }

    if (initialDraft.simulationSketchPreview) {
      setSketchArtifactId(initialDraft.simulationSketchPreview.artifactId);
      setSketchPreviewPath(initialDraft.simulationSketchPreview.previewPath);
      setSketchPreviewToken(initialDraft.simulationSketchPreview.previewToken);
      void requestSketchPreview(initialDraft.simulationSketchPreview);
    }
    if (initialDraft.simulationPreview) {
      setHtmlArtifactId(initialDraft.simulationPreview.artifactId);
      setHtmlPreviewPath(initialDraft.simulationPreview.previewPath);
      setHtmlPreviewToken(initialDraft.simulationPreview.previewToken);
      setHtmlPreviewGenerationSource(initialDraft.simulationPreview.generationSource ?? null);
      setHtmlPreviewViewport(initialDraft.simulationPreview.htmlViewport ?? null);
      setCurrentHtmlReasoningEffort(initialDraft.simulationPreview.htmlReasoningEffort ?? initialDraft.activeSimulationJob?.htmlReasoningEffort ?? null);
      void requestHtmlPreview(initialDraft.simulationPreview);
    }
    if (initialDraft.activeSimulationJob) {
      const runToken = generationRunTokenRef.current;
      void pollHtmlGenerationJob(initialDraft.activeSimulationJob, {
        runToken,
        preservePreviewOnFailure: initialDraft.activeSimulationJob.operation === "refine"
      }).then((job) => {
        if (!job || generationRunTokenRef.current !== runToken) return;
        setGenerationStage(job.status === "completed" ? "done" : initialDraft.simulationPreview || initialDraft.simulationSketchPreview ? "done" : "idle");
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialDraft]);

  function revealSketchPanel() {
    window.setTimeout(() => {
      sketchPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
      sketchPanelRef.current?.focus({ preventScroll: true });
    }, 0);
  }

  async function cancelHtmlGeneration() {
    if (!htmlGenerationJob || isTerminalSimulationJobStatus(htmlGenerationJob.status)) return;
    generationRunTokenRef.current += 1;
    htmlJobPollTokenRef.current += 1;
    setCancellingGeneration(true);
    setRunError(null);
    try {
      const cancelled = await cancelSimulationGenerationJob(htmlGenerationJob.jobId);
      const message = cancelled.message || "Generation was cancelled.";
      setHtmlGenerationJob(cancelled);
      setHtmlGenerationMessage(message);
      setRunError(message);
      if (!htmlPreviewUrl) setHtmlPreviewError(message);
      setGenerationStage("done");
    } catch (error) {
      const message = resolveStudentLifecycleError(error);
      setRunError(message);
      if (!htmlPreviewUrl) setHtmlPreviewError(message);
    } finally {
      setCancellingGeneration(false);
    }
  }

  async function regenerateHtmlPreview() {
    if (!sketchArtifactId) return;
    await onSubmit(async (attemptId) => {
      const submittedDescription = description;
      const runToken = generationRunTokenRef.current + 1;
      generationRunTokenRef.current = runToken;
      htmlJobPollTokenRef.current += 1;
      const isCurrentRun = () => generationRunTokenRef.current === runToken;
      const preserveExistingPreview = Boolean(htmlArtifactId && htmlPreviewUrl);
      setRunStarted(true);
      setRunError(null);
      setHtmlPreviewError(null);
      if (!preserveExistingPreview) setHtmlPreviewLoaded(false);
      setHtmlGenerationJob(null);
      setHtmlGenerationMessage("Starting preview generation...");
      setGenerationStage("html");
      try {
        const job = await generateSimulation({
          attemptId,
          description: submittedDescription,
          sketchArtifactId,
          htmlReasoningEffort: selectedHtmlReasoningEffort
        });
        if (!isCurrentRun()) return;
        setHtmlRequestedModel(job.requestedModel ?? null);
        setHtmlModelUsed(job.modelUsed ?? null);
        setCurrentHtmlReasoningEffort(job.htmlReasoningEffort ?? selectedHtmlReasoningEffort);
        setInputPanelOpen(false);
        const completed = await pollHtmlGenerationJob(job, {
          runToken,
          preservePreviewOnFailure: preserveExistingPreview,
          preservePreviewFailureMessage: "Could not regenerate preview. Current preview was not changed."
        });
        if (!isCurrentRun()) return;
        if (completed?.status === "completed") setGenerationStage("done");
      } catch (error) {
        if (shouldEscalateSimulationError(error)) throw error;
        if (isRetryableSimulationAttemptError(error) && isCurrentRun()) {
          onRecoverAttempt();
          resetGeneratedState();
          setInputPanelOpen(true);
          setRunStarted(true);
          setRunError(SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE);
          setGenerationStage("idle");
          return;
        }
        if (isCurrentRun()) {
          const message = resolveStudentLifecycleError(error);
          setRunError(message);
          setHtmlPreviewError(message);
          setGenerationStage("done");
        }
      }
    });
  }

  async function refineHtmlPreview() {
    if (!sketchArtifactId || !htmlArtifactId) return;
    await onSubmit(async (attemptId) => {
      setRefiningPreview(true);
      setHtmlPreviewError(null);
      setHtmlGenerationMessage("Starting preview refinement...");
      try {
        const job = await refineSimulation({
          attemptId,
          description,
          sketchArtifactId,
          htmlArtifactId,
          htmlReasoningEffort: selectedHtmlReasoningEffort
        });
        setRunStarted(true);
        setGenerationStage("html");
        setCurrentHtmlReasoningEffort(job.htmlReasoningEffort ?? selectedHtmlReasoningEffort);
        const runToken = generationRunTokenRef.current;
        const completed = await pollHtmlGenerationJob(job, {
          runToken,
          preservePreviewOnFailure: true,
          preservePreviewFailureMessage: "Could not refine preview. Current preview was not changed."
        });
        if (completed?.status === "completed") setGenerationStage("done");
      } catch (error) {
        if (shouldEscalateSimulationError(error)) throw error;
        setHtmlPreviewError("Could not refine preview. Current preview was not changed.");
      } finally {
        setRefiningPreview(false);
      }
    });
  }

  async function useStructuredFallback(reasonCodes: string[]) {
    if (!sketchArtifactId || !htmlArtifactId) return;
    const inputHtmlArtifactId = htmlArtifactId;
    const activeDescription = description;
    const activeSketchArtifactId = sketchArtifactId;
    await onSubmit(async (attemptId) => {
      setFallbackPreviewRunning(true);
      setFallbackPreviewError(null);
      setHtmlPreviewError(null);
      setHtmlGenerationMessage("Building structured fallback preview...");
      try {
        const preview = await fallbackSimulationPreview({
          attemptId,
          description: activeDescription,
          sketchArtifactId: activeSketchArtifactId,
          htmlArtifactId: inputHtmlArtifactId,
          reasonCodes
        });
        setRunStarted(true);
        setGenerationStage("done");
        setHtmlArtifactId(preview.artifactId);
        setHtmlPreviewPath(preview.previewPath);
        setHtmlPreviewToken(preview.previewToken);
        setHtmlPreviewGenerationSource(preview.generationSource ?? "structured_fallback");
        setHtmlPreviewViewport(preview.htmlViewport ?? null);
        setHtmlRequestedModel("system");
        setHtmlModelUsed("structured-fallback");
        setCurrentHtmlReasoningEffort(null);
        setHtmlGenerationJob(null);
        setHtmlGenerationMessage("Structured fallback preview ready.");
        await requestHtmlPreview(preview);
      } catch (error) {
        if (shouldEscalateSimulationError(error)) throw error;
        const message = resolveStudentLifecycleError(error);
        setFallbackPreviewError(message);
        if (!htmlPreviewUrl) setHtmlPreviewError(message);
      } finally {
        setFallbackPreviewRunning(false);
      }
    });
  }

  function handleHtmlPreviewHealth(report: SimulationPreviewHealthReport, reportedArtifactId: string) {
    if (reportedArtifactId !== htmlArtifactId) return;
    markHtmlPreviewLoaded();
    if (report.ok) {
      setHtmlPreviewHealthMessage("Preview layout check passed.");
      return;
    }
    const reasonCodes = report.reasonCodes.length > 0 ? report.reasonCodes : ["unhealthy_preview"];
    setHtmlPreviewHealthMessage(`Preview layout needs repair: ${formatHealthReasonCodes(reasonCodes)}.`);
  }

  async function submitFinalSimulation() {
    if (!sketchArtifactId || !htmlArtifactId) return;
    await onSubmit(async (attemptId) => {
      setSubmittingSimulation(true);
      try {
        const response = await submitSimulation({
          attemptId,
          description,
          sketchArtifactId,
          htmlArtifactId
        });
        navigate(`/attempt/${response.attemptId}`);
      } finally {
        setSubmittingSimulation(false);
      }
    });
  }

  function markHtmlPreviewLoaded() {
    setHtmlPreviewLoaded(true);
    setHtmlPreviewLoadedAt((current) => current ?? Date.now());
  }

  const sketchStatus = sketchPreviewError
    ? "Blocked/Failed"
    : sketchPreviewLoaded
      ? "Loaded"
      : sketchPreviewRequested
        ? "Loading"
        : generationStage === "sketch"
          ? "Generating"
          : "Ready";

  const htmlStatus = htmlPreviewError
    ? "Blocked/Failed"
    : htmlPreviewLoaded
      ? "Loaded"
      : htmlPreviewRequested
        ? "Loading"
        : generationStage === "html" || htmlGenerationJob
          ? "Generating"
          : "Ready";
  const baseRunMessage = resolveSimulationRunMessage({
    stage: generationStage,
    runStarted,
    runError,
    sketchReady: Boolean(sketchArtifactId),
    htmlReady: Boolean(htmlArtifactId) && !htmlPreviewError
  });
  const runMessage = !runError && htmlGenerationMessage && generationStage === "html"
    ? { kind: "status" as const, message: htmlGenerationMessage }
    : baseRunMessage;
  const readiness = useMemo(() => assessSimulationDescriptionReadiness({
    assessmentPrompt: assessment.prompt,
    description,
    config: assessment.config
  }), [assessment.config, assessment.prompt, description]);
  const readinessMessage = description.trim() ? resolveSimulationReadinessMessage(readiness.decision) : null;
  const generateButtonLabel = resolveSimulationGenerateButtonLabel(generationStage);
  const generationActive = generationStage === "sketch" || generationStage === "html" || isActiveSimulationGenerationJob(htmlGenerationJob);
  const canCancelHtmlGeneration = canCancelSimulationGenerationJob(htmlGenerationJob);
  const sketchPreviewLoading = sketchPreviewRequested && !sketchPreviewLoaded && !sketchPreviewError && Boolean(sketchArtifactId);
  const htmlPreviewLoading = htmlPreviewRequested && !htmlPreviewLoaded && !htmlPreviewError && Boolean(htmlArtifactId);
  const actionBusy = disabled || generationActive || refiningPreview || fallbackPreviewRunning || cancellingGeneration || submittingSimulation || sketchPreviewLoading || htmlPreviewLoading;
  const canRefinePreview = Boolean(sketchArtifactId && htmlArtifactId && sketchPreviewUrl && htmlPreviewUrl);
  const canUseStructuredFallback = Boolean(sketchArtifactId && htmlArtifactId && htmlPreviewUrl && htmlPreviewGenerationSource !== "structured_fallback");
  const canRegenerateHtmlPreview = canRetrySimulationHtmlPreview({
    sketchReady: Boolean(sketchArtifactId && sketchPreviewPath && sketchPreviewToken),
    htmlReady: Boolean(htmlArtifactId || htmlPreviewUrl),
    generationActive
  });
  const canSubmitSimulation = Boolean(sketchArtifactId && htmlArtifactId && htmlPreviewUrl);

  return (
    <div className="simulation-layout">
      <details
        className="simulation-input-accordion"
        open={inputPanelOpen}
        onToggle={(event) => setInputPanelOpen(event.currentTarget.open)}
      >
        <summary>Input and Rubric</summary>
        <div className="simulation-input-body">
          <div className="simulation-input-grid">
            <section className="writing-panel">
              <label htmlFor="simulation-description">Description</label>
              <textarea
                id="simulation-description"
                value={description}
                disabled={disabled}
                onChange={(event) => {
                  setDescription(event.target.value);
                  resetGeneratedState();
                }}
                placeholder="Describe only what you know should happen in the process."
                rows={12}
              />
            </section>
            <RubricFeedback feedback={null} rubric={assessment.rubric} />
            <div className="simulation-html-options">
              <div>
                <label htmlFor="html-reasoning-effort">HTML reasoning</label>
                <select
                  id="html-reasoning-effort"
                  value={selectedHtmlReasoningEffort}
                  disabled={actionBusy}
                  onChange={(event) => {
                    const nextEffort = event.target.value;
                    if ((SIMULATION_HTML_REASONING_EFFORTS as readonly string[]).includes(nextEffort)) {
                      setSelectedHtmlReasoningEffort(nextEffort as SimulationHtmlReasoningEffort);
                    }
                  }}
                >
                  {SIMULATION_HTML_REASONING_EFFORTS.map((effort) => (
                    <option key={effort} value={effort}>{formatSimulationHtmlReasoningEffort(effort)}</option>
                  ))}
                </select>
              </div>
              <p className="overall-comment">Model: {getSimulationCodeModelLabel(assessment.config.simulationCodeModelId)}</p>
            </div>
            <button
              className="primary-button simulation-submit"
              disabled={readiness.decision === "block" || actionBusy}
              type="button"
              onClick={() => onSubmit(async (attemptId) => {
                const submittedDescription = description;
                resetGeneratedState();
                const runToken = generationRunTokenRef.current;
                let sketchCreated = false;
                const isCurrentRun = () => generationRunTokenRef.current === runToken;
                setRunStarted(true);
                setRunError(null);

                setGenerationStage("sketch");
                try {
                  const sketch = await generateSimulationSketch({ attemptId, description: submittedDescription });
                  if (!isCurrentRun()) return;
                  sketchCreated = true;
                  setSketchArtifactId(sketch.artifactId);
                  setSketchPreviewPath(sketch.previewPath);
                  setSketchPreviewToken(sketch.previewToken);
                  setSketchRequestedModel(sketch.requestedModel);
                  setSketchModelUsed(sketch.modelUsed);
                  setInputPanelOpen(false);
                  revealSketchPanel();
                  await requestSketchPreview({
                    artifactId: sketch.artifactId,
                    previewPath: sketch.previewPath,
                    previewToken: sketch.previewToken
                  });
                  if (!isCurrentRun()) return;

                  setGenerationStage("html");
                  setHtmlGenerationMessage("Starting preview generation...");
                  const job = await generateSimulation({
                    attemptId,
                    description: submittedDescription,
                    sketchArtifactId: sketch.artifactId,
                    htmlReasoningEffort: selectedHtmlReasoningEffort
                  });
                  if (!isCurrentRun()) return;
                  setHtmlRequestedModel(job.requestedModel ?? null);
                  setHtmlModelUsed(job.modelUsed ?? null);
                  setCurrentHtmlReasoningEffort(job.htmlReasoningEffort ?? selectedHtmlReasoningEffort);
                  setInputPanelOpen(false);
                  const completed = await pollHtmlGenerationJob(job, {
                    runToken,
                    preservePreviewOnFailure: false
                  });
                  if (!isCurrentRun()) return;
                  if (completed?.status === "completed") setGenerationStage("done");
                } catch (error) {
                  if (shouldEscalateSimulationError(error)) throw error;
                  if (isRetryableSimulationAttemptError(error) && isCurrentRun()) {
                    onRecoverAttempt();
                    resetGeneratedState();
                    setInputPanelOpen(true);
                    setRunStarted(true);
                    setRunError(SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE);
                    setGenerationStage("idle");
                    return;
                  }
                  if (isCurrentRun()) {
                    const message = resolveStudentLifecycleError(error);
                    if (sketchCreated) {
                      setRunError(message);
                      setHtmlPreviewError(message);
                      setGenerationStage("done");
                    } else {
                      setInputPanelOpen(true);
                      setRunError(message);
                      setGenerationStage("idle");
                    }
                  }
                }
              })}
            >
              <Send size={18} /> {generateButtonLabel}
            </button>
            {runMessage && (
              <p className={runMessage.kind === "error" ? "field-error" : "status-line"} aria-live="polite">
                {runMessage.message}
              </p>
            )}
            {!runMessage && readinessMessage && (
              <p className="field-error" aria-live="polite">
                {readinessMessage.message}
              </p>
            )}
            <p className="overall-comment">Minimum description length: {minDescriptionChars} characters.</p>
          </div>
        </div>
      </details>

      <div className="simulation-output-stack">
        <section className="safe-preview-panel" ref={sketchPanelRef} tabIndex={-1}>
          <div className="safe-preview-header">
            <h2>Sketch Preview</h2>
            <div className="preview-actions">
              <button type="button" className="secondary-button" onClick={() => { void requestSketchPreview(); }} disabled={!sketchArtifactId || actionBusy}>
                Reload Sketch
              </button>
            </div>
          </div>
          <p className="overall-comment">
            Preview status: {sketchStatus}. The sketch is generated from the exact student description and is used as visual guidance for the interactive output.
          </p>
          {sketchPreviewError && <p className="field-error">{sketchPreviewError}</p>}
          {sketchPreviewUrl && sketchPreviewRequested ? (
            <img
              className="sketch-preview-image"
              alt="Generated simulation sketch"
              src={sketchPreviewUrl}
              onLoad={() => setSketchPreviewLoaded(true)}
              onError={() => {
                setSketchPreviewLoaded(false);
                setSketchPreviewError("Sketch preview failed to load.");
              }}
            />
          ) : (
            <div className="safe-preview-empty">Generate to create the visual sketch.</div>
          )}
        </section>
        <section className="safe-preview-panel safe-preview-primary">
          <div className="safe-preview-header">
            <h2>Interactive Preview</h2>
            <div className="preview-actions">
              <button type="button" className="secondary-button" onClick={() => { void requestHtmlPreview(); }} disabled={!htmlArtifactId || actionBusy}>
                Reload Safe Preview
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void cancelHtmlGeneration(); }}
                disabled={!canCancelHtmlGeneration || cancellingGeneration || submittingSimulation}
                aria-busy={cancellingGeneration}
                aria-label={cancellingGeneration ? "Cancelling..." : "Cancel generation"}
              >
                Cancel generation
              </button>
              <button type="button" className="secondary-button" onClick={() => { void regenerateHtmlPreview(); }} disabled={!canRegenerateHtmlPreview || actionBusy}>
                Regenerate HTML Preview
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void refineHtmlPreview(); }}
                disabled={!canRefinePreview || actionBusy}
                aria-busy={refiningPreview}
                aria-label={refiningPreview ? "Refining preview..." : "Refine to Match Sketch"}
              >
                Refine to Match Sketch
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void useStructuredFallback(["manual_fallback"]); }}
                disabled={!canUseStructuredFallback || actionBusy}
                aria-busy={fallbackPreviewRunning}
                aria-label={fallbackPreviewRunning ? "Building fallback..." : "Use Structured Fallback"}
              >
                Use Structured Fallback
              </button>
            </div>
          </div>
          <div className="simulation-preview-status" aria-live="polite">
            <p className="overall-comment">
              {htmlPreviewLoadedAt
                ? `Preview status: Loaded @ ${formatSimulationPreviewLoadedAt(htmlPreviewLoadedAt)}.`
                : `Preview status: ${htmlStatus}.`}
            </p>
            {htmlPreviewHealthMessage && <p className="overall-comment">{htmlPreviewHealthMessage}</p>}
            {fallbackPreviewError && <p className="field-error">{fallbackPreviewError}</p>}
            {htmlPreviewError && <p className="field-error">{htmlPreviewError}</p>}
          </div>
          {htmlPreviewUrl && htmlPreviewRequested && htmlArtifactId ? (
            <SimulationPreviewFrame
              artifactId={htmlArtifactId}
              title="Safe simulation preview"
              src={htmlPreviewUrl}
              healthNonce={htmlPreviewHealthNonce}
              viewport={htmlPreviewViewport}
              onHealth={handleHtmlPreviewHealth}
              onLoad={markHtmlPreviewLoaded}
              onError={() => {
                setHtmlPreviewLoaded(false);
                setHtmlPreviewLoadedAt(null);
                setHtmlPreviewError("Preview failed to load in sandbox.");
              }}
            />
          ) : (
            <div className="safe-preview-empty">The interactive HTML will appear after the sketch is converted.</div>
          )}
        </section>

        {canSubmitSimulation && (
          <div className="simulation-final-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => { void submitFinalSimulation(); }}
              disabled={actionBusy}
            >
              <Send size={18} /> {submittingSimulation ? "Submitting simulation..." : "Submit Simulation"}
            </button>
          </div>
        )}

        <details className="raw-debug-accordion">
          <summary>Simulation Metadata</summary>
          <div className="raw-debug-content">
            <p className="overall-comment">
              {sketchRequestedModel ? `Sketch requested model: ${sketchRequestedModel}` : "Sketch requested model: n/a"} | {sketchModelUsed ? `Sketch model used: ${sketchModelUsed}` : "Sketch model used: n/a"} | Output kind: image
            </p>
            <p className="overall-comment">
              {htmlRequestedModel ? `HTML requested model: ${htmlRequestedModel}` : "HTML requested model: n/a"} | {htmlModelUsed ? `HTML model used: ${htmlModelUsed}` : "HTML model used: n/a"} | Output kind: html
            </p>
            <p className="overall-comment">
              Selected next HTML reasoning: {formatSimulationHtmlReasoningEffort(selectedHtmlReasoningEffort)} | Current preview/job HTML reasoning: {currentHtmlReasoningEffort ? formatSimulationHtmlReasoningEffort(currentHtmlReasoningEffort) : "n/a"}
            </p>
            <p className="overall-comment">{sketchArtifactId ? `Sketch artifact ID: ${sketchArtifactId}` : "Sketch artifact ID: n/a"}</p>
            <p className="overall-comment">{htmlArtifactId ? `HTML artifact ID: ${htmlArtifactId}` : "HTML artifact ID: n/a"}</p>
          </div>
        </details>
      </div>

    </div>
  );
}

function shouldEscalateSimulationError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.code === "already_submitted" || error.code === "final_published");
}

function resolveSimulationJobPollDelayMs(startedAtMs: number): number {
  return Date.now() - startedAtMs < 60000 ? 5000 : 10000;
}

function waitForSimulationJobPoll(delayMs: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function makeSimulationPreviewHealthNonce(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatHealthReasonCodes(reasonCodes: string[]): string {
  return reasonCodes
    .map((code) => code.replace(/_/g, " "))
    .join(", ");
}

function formatSimulationPreviewLoadedAt(timestampMs: number): string {
  const date = new Date(timestampMs);
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
