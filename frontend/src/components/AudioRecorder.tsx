import { Mic, Play, RotateCcw, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string; confidence: number }>>;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export interface RecordingResult {
  blob: Blob;
  transcript: string;
}

export function AudioRecorder({ onReady, maxSeconds = 30 }: { onReady: (recording: RecordingResult | null) => void; maxSeconds?: number }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");
  const previewUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(false);
  const sessionRef = useRef(0);
  const discardPendingRecordingRef = useRef(false);

  const revokePreviewUrl = useCallback((url: string | null) => {
    if (url) URL.revokeObjectURL(url);
  }, []);

  const replacePreviewUrl = useCallback((url: string | null) => {
    setPreviewUrl((previous) => {
      revokePreviewUrl(previous);
      previewUrlRef.current = url;
      return url;
    });
  }, [revokePreviewUrl]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopSpeechRecognition = useCallback(() => {
    const recognition = speechRef.current;
    speechRef.current = null;
    if (!recognition) return;
    try {
      recognition.stop();
    } catch {
      // Some browsers throw when recognition has already stopped.
    }
  }, []);

  const stopMicrophoneTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const cleanupRecordingResources = useCallback((options: { discardRecording: boolean }) => {
    if (options.discardRecording) {
      discardPendingRecordingRef.current = true;
      chunksRef.current = [];
    }
    clearTimer();
    stopSpeechRecognition();
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    if (recorder && recorder.state !== "inactive") {
      try {
        recorder.stop();
      } catch {
        chunksRef.current = [];
      }
    }
    stopMicrophoneTracks();
    if (mountedRef.current) setRecording(false);
  }, [clearTimer, stopMicrophoneTracks, stopSpeechRecognition]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      cleanupRecordingResources({ discardRecording: true });
      revokePreviewUrl(previewUrlRef.current);
      previewUrlRef.current = null;
    };
  }, [cleanupRecordingResources, revokePreviewUrl]);

  async function start() {
    sessionRef.current += 1;
    const sessionId = sessionRef.current;
    discardPendingRecordingRef.current = false;
    setError(null);
    setTranscript("");
    transcriptRef.current = "";
    replacePreviewUrl(null);
    onReady(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current || sessionRef.current !== sessionId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (!discardPendingRecordingRef.current && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        if (!mountedRef.current || sessionRef.current !== sessionId || discardPendingRecordingRef.current) {
          chunksRef.current = [];
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const url = URL.createObjectURL(blob);
        replacePreviewUrl(url);
        onReady({ blob, transcript: transcriptRef.current });
        chunksRef.current = [];
      };
      recorder.start();
      startSpeechRecognition();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((value) => {
          if (value + 1 >= maxSeconds) stop();
          return value + 1;
        });
      }, 1000);
    } catch {
      stopMicrophoneTracks();
      if (mountedRef.current && sessionRef.current === sessionId) {
        setError("Microphone permission is needed to record your answer.");
      }
    }
  }

  function startSpeechRecognition() {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Recognition) return;
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      if (!mountedRef.current) return;
      const parts: string[] = [];
      for (let index = 0; index < event.results.length; index += 1) {
        parts.push(event.results[index][0]?.transcript ?? "");
      }
      const nextTranscript = parts.join(" ").trim();
      transcriptRef.current = nextTranscript;
      setTranscript(nextTranscript);
    };
    recognition.onerror = () => undefined;
    speechRef.current = recognition;
    try {
      recognition.start();
    } catch {
      speechRef.current = null;
    }
  }

  function stop() {
    cleanupRecordingResources({ discardRecording: false });
  }

  function reset() {
    sessionRef.current += 1;
    cleanupRecordingResources({ discardRecording: true });
    replacePreviewUrl(null);
    setTranscript("");
    transcriptRef.current = "";
    setElapsed(0);
    onReady(null);
  }

  return (
    <section className="recorder-panel" aria-label="Voice recorder">
      <div className="recording-meter">
        <span className={recording ? "record-dot active" : "record-dot"} />
        <strong>{recording ? "Recording" : previewUrl ? "Ready" : "Not recorded"}</strong>
        <span>{elapsed}s / {maxSeconds}s</span>
      </div>
      <div className="waveform" aria-hidden="true">
        {Array.from({ length: 24 }).map((_, index) => (
          <i key={index} style={{ height: `${20 + ((index * 17) % 46)}%` }} />
        ))}
      </div>
      {transcript && <p className="live-transcript">{transcript}</p>}
      {error && <p className="field-error">{error}</p>}
      <div className="control-row">
        {!recording && !previewUrl && (
          <button className="primary-button" type="button" onClick={start}>
            <Mic size={18} /> Record
          </button>
        )}
        {recording && (
          <button className="danger-button" type="button" onClick={stop}>
            <Square size={18} /> Stop
          </button>
        )}
        {previewUrl && (
          <>
            <audio controls src={previewUrl} aria-label="Recorded answer playback" />
            <button className="secondary-button" type="button" onClick={reset}>
              <RotateCcw size={18} /> Retake
            </button>
            <a className="secondary-button" href={previewUrl}>
              <Play size={18} /> Preview
            </a>
          </>
        )}
      </div>
    </section>
  );
}
