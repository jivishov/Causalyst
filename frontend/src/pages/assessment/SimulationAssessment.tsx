import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronDown, Image, LoaderCircle, Maximize2, Minimize2, MonitorPlay, RefreshCw, Send, SlidersHorizontal, Sparkles, WandSparkles, X } from "lucide-react";
import { DEFAULT_SIMULATION_HTML_REASONING_EFFORT, MAX_SIMULATION_STREAM_CHARS,
  assessSimulationDescriptionReadiness, type AssessmentSummary,
  type SimulationHtmlReasoningEffort, type StudentSimulationGenerationJob, type StudentSimulationModelSettings, type StudentSimulationPreview } from "@alt-assessment/shared";
import { RubricFeedback } from "../../components/RubricFeedback";
import { StudentActionProgress } from "../../components/StudentActionProgress";
import { SimulationHtmlStream } from "../../components/SimulationHtmlStream";
import { SimulationPreviewFrame, type SimulationPreviewHealthReport } from "../../components/SimulationPreviewFrame";
import { ApiRequestError, cancelSimulationGenerationJob, fallbackSimulationPreview, generateSimulation,
  generateSimulationSketch, getSimulationGenerationJob, getSimulationModelSettings, isRetryableApiError, streamSimulationGenerationJob, getSimulationPreviewUrl, refineSimulation, submitSimulation } from "../../lib/api";
import { SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE, canCancelSimulationGenerationJob, canRetrySimulationHtmlPreview,
  isActiveSimulationGenerationJob, isRetryableSimulationAttemptError, isTerminalSimulationJobStatus,
  resolveSimulationGenerateButtonLabel, resolveSimulationReadinessMessage, resolveSimulationRunMessage,
  type SimulationGenerationStage } from "../../lib/simulationGenerationUi";
import { resolveStudentLifecycleError } from "../../lib/studentLifecycle";
import { resolveSimulationMinDescriptionChars } from "../../lib/uploadPolicy";
import { useSession } from "../../state/session";

export interface SimulationDraftState {
  attemptId: string;
  description: string;
  simulationPreview: StudentSimulationPreview | null;
  simulationSketchPreview: StudentSimulationPreview | null;
  activeSimulationJob: StudentSimulationGenerationJob | null;
}

function formatSimulationHtmlReasoningEffort(effort: SimulationHtmlReasoningEffort): string {
  if (effort === "none") return "Provider default";
  if (effort === "xhigh") return "XHigh";
  if (effort === "max") return "Max";
  if (effort === "low") return "Low";
  if (effort === "high") return "High";
  return "Medium";
}

export function SimulationAssessment({ assessment, disabled, initialDraft, draftAttemptId, isActive, onRecoverAttempt, onSubmit }: {
  assessment: AssessmentSummary;
  disabled: boolean;
  initialDraft: SimulationDraftState | null;
  draftAttemptId: string | null;
  isActive: () => boolean;
  onRecoverAttempt: () => void;
  onSubmit: (task: (attemptId: string) => Promise<void>) => Promise<void>;
}) {
  const navigate = useNavigate();
  const { assignmentId } = useParams();
  const { rememberAttemptResult, readSimulationDescriptionDraft, rememberSimulationDescriptionDraft } = useSession();
  const minDescriptionChars = resolveSimulationMinDescriptionChars(assessment.config);
  const [description, setDescription] = useState(() => assignmentId && draftAttemptId ? readSimulationDescriptionDraft(assignmentId, draftAttemptId) ?? "" : "");
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
  const [currentHtmlServiceTiers, setCurrentHtmlServiceTiers] = useState<Pick<StudentSimulationPreview, "htmlServiceTierRequested" | "htmlServiceTierUsed"> | null>(null);
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
  const [htmlStreamSource, setHtmlStreamSource] = useState("");
  const [htmlStreamLive, setHtmlStreamLive] = useState(true);
  const [refiningPreview, setRefiningPreview] = useState(false);
  const [fallbackPreviewRunning, setFallbackPreviewRunning] = useState(false);
  const [fallbackPreviewError, setFallbackPreviewError] = useState<string | null>(null);
  const [cancellingGeneration, setCancellingGeneration] = useState(false);
  const [submittingSimulation, setSubmittingSimulation] = useState(false);
  const [inputPanelOpen, setInputPanelOpen] = useState(true);
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [modelSettings, setModelSettings] = useState<StudentSimulationModelSettings | null>(null);
  const [modelSettingsLoading, setModelSettingsLoading] = useState(false);
  const [modelSettingsError, setModelSettingsError] = useState<string | null>(null);
  const selectedHtmlReasoningEffort = modelSettings?.htmlReasoningEffort ?? DEFAULT_SIMULATION_HTML_REASONING_EFFORT;
  const modelSettingsLoadTokenRef = useRef(0);
  const sketchPanelRef = useRef<HTMLDetailsElement | null>(null);
  const htmlPanelRef = useRef<HTMLElement | null>(null);
  const generationRunTokenRef = useRef(0);
  const sketchPreviewLoadTokenRef = useRef(0);
  const htmlPreviewLoadTokenRef = useRef(0);
  const htmlJobPollTokenRef = useRef(0);
  const htmlStreamAbortRef = useRef<AbortController | null>(null);
  const restoredDraftKeyRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      generationRunTokenRef.current += 1;
      sketchPreviewLoadTokenRef.current += 1;
      htmlPreviewLoadTokenRef.current += 1;
      htmlJobPollTokenRef.current += 1;
      modelSettingsLoadTokenRef.current += 1;
      htmlStreamAbortRef.current?.abort();
      // StrictMode replays mount effects. A cancelled restoration must be
      // allowed to run again instead of leaving its previews in "Loading".
      restoredDraftKeyRef.current = null;
    };
  }, []);

  const refreshModelSettings = useCallback(async () => {
    if (!draftAttemptId || !isActive()) return;
    const token = ++modelSettingsLoadTokenRef.current;
    setModelSettingsLoading(true);
    setModelSettingsError(null);
    try {
      const settings = await getSimulationModelSettings(draftAttemptId);
      if (!settings.sketchModelId || !settings.htmlModelId || !settings.htmlReasoningEffort) throw new Error("Model settings are unavailable. Refresh model settings to try again.");
      if (isActive() && modelSettingsLoadTokenRef.current === token) setModelSettings(settings);
    } catch (error) {
      if (isActive() && modelSettingsLoadTokenRef.current === token) {
        setModelSettings(null);
        setModelSettingsError(error instanceof Error ? error.message : "Could not load model settings.");
      }
    } finally {
      if (isActive() && modelSettingsLoadTokenRef.current === token) setModelSettingsLoading(false);
    }
  }, [draftAttemptId, isActive]);

  useEffect(() => {
    void refreshModelSettings();
    return () => { modelSettingsLoadTokenRef.current += 1; };
  }, [refreshModelSettings]);

  useEffect(() => {
    const update = () => setPreviewExpanded(document.fullscreenElement === htmlPanelRef.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  async function togglePreviewSize() {
    if (document.fullscreenElement === htmlPanelRef.current) await document.exitFullscreen();
    else await htmlPanelRef.current?.requestFullscreen?.();
  }

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
    htmlStreamAbortRef.current?.abort();
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
    setCurrentHtmlServiceTiers(null);
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
    setHtmlStreamSource("");
    setHtmlStreamLive(true);
    setFallbackPreviewRunning(false);
    setFallbackPreviewError(null);
    setHtmlPreviewUrl((existing) => {
      if (existing) URL.revokeObjectURL(existing);
      return null;
    });
    setCancellingGeneration(false);
  }

  async function requestSketchPreview(input?: { artifactId: string; previewPath: string; previewToken: string }) {
    if (!isActive()) return;
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
    if (!isActive()) return;
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
        setCurrentHtmlServiceTiers({ htmlServiceTierRequested: input.htmlServiceTierRequested, htmlServiceTierUsed: input.htmlServiceTierUsed });
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
    if (!isActive()) return null;
    const pollToken = htmlJobPollTokenRef.current + 1;
    htmlJobPollTokenRef.current = pollToken;
    let currentJob = job;
    const startedAt = Date.now();
    setHtmlGenerationJob(currentJob);
    setHtmlGenerationMessage(currentJob.message);
    setCurrentHtmlReasoningEffort(currentJob.htmlReasoningEffort ?? null);

    htmlStreamAbortRef.current?.abort();
    const streamAbort = new AbortController();
    htmlStreamAbortRef.current = streamAbort;
    setHtmlStreamSource("");
    setHtmlStreamLive(true);
    let cursor: number | undefined;
    let streamAvailable = true;
    let streamFailures = 0;
    let pollFailures = 0;
    let wakePoll: (() => void) | null = null;
    const isCurrent = () => isActive() && !streamAbort.signal.aborted && generationRunTokenRef.current === input.runToken && htmlJobPollTokenRef.current === pollToken;
    const reconnect = () => { if (isCurrent()) wakePoll?.(); };
    const resume = () => { if (document.visibilityState === "visible") reconnect(); };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", resume);
    window.requestAnimationFrame(() => {
      if (isCurrent()) htmlPanelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    // Polling remains the recovery path for old jobs and networks that buffer
    // streams. Both paths observe the same job; neither starts provider work.
    void (async () => {
      while (isCurrent() && streamAvailable && !isTerminalSimulationJobStatus(currentJob.status)) {
        try {
          await streamSimulationGenerationJob(job.jobId, {
            after: cursor,
            signal: streamAbort.signal,
            onEvent(event) {
              if (!isCurrent()) return;
              if (event.type === "html_delta" || event.type === "checkpoint") {
                if (cursor !== undefined && event.cursor <= cursor) return;
                cursor = event.cursor;
                streamFailures = 0;
                setHtmlStreamLive(true);
                if (event.type === "html_delta") {
                  setHtmlStreamSource(source => (source + event.delta).slice(0, MAX_SIMULATION_STREAM_CHARS));
                }
              } else if (event.type === "job" && event.job.jobId === job.jobId && !isTerminalSimulationJobStatus(currentJob.status)) {
                const changed = currentJob.status !== event.job.status;
                currentJob = event.job;
                setHtmlGenerationJob(currentJob);
                setHtmlGenerationMessage(currentJob.message);
                if (currentJob.status === "finalizing") streamAvailable = false;
                if (changed) wakePoll?.();
              } else if (event.type === "unavailable") {
                streamAvailable = false;
                setHtmlStreamLive(false);
              }
            }
          });
        } catch {
          if (!isCurrent()) return;
          setHtmlStreamLive(false);
          if (++streamFailures >= 3) streamAvailable = false;
        }
        if (isCurrent() && streamAvailable && !isTerminalSimulationJobStatus(currentJob.status)) {
          await waitForSimulationJobPoll(1000);
        }
      }
    })();

    try {
      while (isCurrent()) {
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
          if (!isCurrent()) return null;
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

        await new Promise<void>(resolve => {
          const finish = () => {
            window.clearTimeout(timer);
            streamAbort.signal.removeEventListener("abort", finish);
            wakePoll = null;
            resolve();
          };
          const delay = pollFailures ? Math.min(30000, 1000 * 2 ** Math.min(pollFailures, 5)) : resolveSimulationJobPollDelayMs(startedAt);
          const timer = window.setTimeout(finish, delay);
          wakePoll = finish;
          streamAbort.signal.addEventListener("abort", finish, { once: true });
        });
        if (!isCurrent()) return null;
        if (isTerminalSimulationJobStatus(currentJob.status)) continue;
        try {
          const nextJob = await getSimulationGenerationJob(currentJob.jobId);
          if (!isCurrent()) return null;
          if (!isTerminalSimulationJobStatus(currentJob.status)) currentJob = nextJob;
          pollFailures = 0;
        } catch (error) {
          if (!isCurrent()) return null;
          if (isTerminalSimulationJobStatus(currentJob.status)) continue;
          if (!isRetryableApiError(error)) {
            setHtmlGenerationJob(null);
            setGenerationStage("done");
            throw error;
          }
          // A connection failure says nothing about the provider job. Keep its
          // identity and retry only the status read, including after finalization
          // errors, whose terminal state is persisted by the Worker.
          pollFailures += 1;
          setHtmlGenerationMessage("Connection interrupted. Your preview request is saved. Reconnecting...");
          continue;
        }
        if (!isCurrent()) return null;
        setHtmlGenerationJob(currentJob);
        setHtmlGenerationMessage(currentJob.message);
        setCurrentHtmlReasoningEffort(currentJob.htmlReasoningEffort ?? null);
        if (currentJob.status === "finalizing") setGenerationStage("html");
      }
      return null;
    } finally {
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", resume);
      streamAbort.abort();
      if (htmlStreamAbortRef.current === streamAbort) htmlStreamAbortRef.current = null;
    }
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
    const localDescription = assignmentId ? readSimulationDescriptionDraft(assignmentId, initialDraft.attemptId) : undefined;
    setDescription(localDescription ?? initialDraft.description);
    // An ungenerated edit belongs to this assignment/attempt, but its older
    // artifacts describe different text and cannot be submitted with the edit.
    if (localDescription !== undefined && localDescription !== initialDraft.description) return;
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
      setCurrentHtmlServiceTiers({ htmlServiceTierRequested: initialDraft.simulationPreview.htmlServiceTierRequested, htmlServiceTierUsed: initialDraft.simulationPreview.htmlServiceTierUsed });
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
      }).catch((error) => {
        if (generationRunTokenRef.current !== runToken) return;
        const message = resolveStudentLifecycleError(error);
        setHtmlPreviewError(message);
        setHtmlGenerationMessage(message);
        setRunError(message);
        setGenerationStage("done");
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
    htmlStreamAbortRef.current?.abort();
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
        if (!isActive()) return;
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
    if (!sketchArtifactId) return;
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
          htmlArtifactId: inputHtmlArtifactId ?? undefined,
          reasonCodes
        });
        if (!isActive()) return;
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
    setCurrentHtmlServiceTiers(null);
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
        rememberAttemptResult({
          assignmentId: assignmentId ?? null, attemptId: response.attemptId, status: "submitted", provisionalScore: null,
          submittedAt: response.submittedAt ?? new Date().toISOString(), submittedAfterDue: response.submittedAfterDue
        }, true);
        if (isActive()) navigate(`/attempt/${response.attemptId}`);
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
  const canUseStructuredFallback = Boolean(sketchArtifactId && htmlPreviewGenerationSource !== "structured_fallback");
  const canRegenerateHtmlPreview = canRetrySimulationHtmlPreview({
    sketchReady: Boolean(sketchArtifactId && sketchPreviewPath && sketchPreviewToken),
    htmlReady: Boolean(htmlArtifactId || htmlPreviewUrl),
    generationActive
  });
  const canSubmitSimulation = Boolean(sketchArtifactId && htmlArtifactId && htmlPreviewUrl);
  const progressTitle = cancellingGeneration ? "Cancelling generation"
    : submittingSimulation ? "Submitting your simulation"
    : fallbackPreviewRunning ? "Building an alternate preview"
    : refiningPreview || isActiveSimulationGenerationJob(htmlGenerationJob) && htmlGenerationJob?.operation === "refine" ? "Refining your simulation"
    : generationStage === "sketch" ? "Generating your sketch"
    : htmlGenerationJob?.status === "finalizing" ? "Finishing your interactive preview"
    : generationStage === "html" || isActiveSimulationGenerationJob(htmlGenerationJob) ? "Generating your interactive preview"
    : htmlPreviewLoading ? "Loading your interactive preview"
    : sketchPreviewLoading ? "Loading your sketch"
    : "Preparing your request";

  return (
    <div className="simulation-layout">
      <StudentActionProgress active={actionBusy} title={progressTitle} message={generationStage === "html" && htmlStreamSource ? "HTML is arriving. Your preview will open after the code is complete and checked." : undefined} />
      <details
        className="simulation-input-accordion"
        open={inputPanelOpen}
        onToggle={(event) => setInputPanelOpen(event.currentTarget.open)}
      >
        <summary><SlidersHorizontal size={17} aria-hidden="true" /><span>Input and Rubric</span><ChevronDown size={16} className="accordion-chevron" aria-hidden="true" /></summary>
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
                  if (assignmentId && draftAttemptId) rememberSimulationDescriptionDraft(assignmentId, draftAttemptId, event.target.value);
                  resetGeneratedState();
                }}
                placeholder="Describe only what you know should happen in the process."
                rows={12}
              />
            </section>
            <RubricFeedback feedback={null} rubric={assessment.rubric} />
            <div className="simulation-html-options">
              <p id="html-reasoning-effort" className="overall-comment">Reasoning effort and token limits are assigned by your teacher.</p>
              <p className="overall-comment">Next HTML model: {modelSettings?.htmlModelId || (modelSettingsLoading ? "Loading settings…" : "Unavailable")}{modelSettings ? ` · Reasoning: ${formatSimulationHtmlReasoningEffort(modelSettings.htmlReasoningEffort)}` : ""}</p>
            </div>
            <button
              className="primary-button simulation-submit"
              disabled={readiness.decision === "block" || actionBusy}
              aria-busy={generationActive}
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
              {generationActive ? <LoaderCircle size={18} className="student-action-spinner" aria-hidden="true" /> : <Send size={18} />} {generateButtonLabel}
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
        <details className="safe-preview-panel simulation-sketch-panel" open={Boolean(sketchArtifactId) && !htmlArtifactId} ref={sketchPanelRef} tabIndex={-1}>
          <summary><Image size={17} aria-hidden="true" /><span>Sketch Preview</span><ChevronDown size={16} className="accordion-chevron" aria-hidden="true" /></summary>
          <div className="simulation-sketch-body">
          <div className="safe-preview-header">
            <div className="preview-actions">
              <button type="button" className="secondary-button" onClick={() => { void requestSketchPreview(); }} disabled={!sketchArtifactId || actionBusy} aria-busy={sketchPreviewLoading}>
                {sketchPreviewLoading ? <LoaderCircle size={16} className="student-action-spinner" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} Reload Sketch
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
          </div>
        </details>
        <section className="safe-preview-panel safe-preview-primary" ref={htmlPanelRef}>
          <div className="safe-preview-header">
            <h2><MonitorPlay size={19} aria-hidden="true" />Interactive Preview</h2>
            <div className="preview-actions">
              <button type="button" className="secondary-button" aria-label="Reload Safe Preview" title="Reload the interactive preview" onClick={() => { void requestHtmlPreview(); }} disabled={!htmlArtifactId || actionBusy} aria-busy={htmlPreviewLoading}>
                {htmlPreviewLoading ? <LoaderCircle size={16} className="student-action-spinner" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} Reload
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void cancelHtmlGeneration(); }}
                disabled={!canCancelHtmlGeneration || cancellingGeneration || submittingSimulation}
                aria-busy={cancellingGeneration}
                aria-label={cancellingGeneration ? "Cancelling..." : "Cancel generation"}
              >
                {cancellingGeneration ? <LoaderCircle size={16} className="student-action-spinner" aria-hidden="true" /> : <X size={15} aria-hidden="true" />} {cancellingGeneration ? "Cancelling..." : "Cancel generation"}
              </button>
              <button type="button" className="secondary-button" aria-label="Regenerate HTML Preview" title="Regenerate the interactive preview from your sketch" onClick={() => { void regenerateHtmlPreview(); }} disabled={!canRegenerateHtmlPreview || actionBusy} aria-busy={generationStage === "html" && !refiningPreview}>
                {generationStage === "html" && !refiningPreview ? <LoaderCircle size={16} className="student-action-spinner" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />} Regenerate
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void refineHtmlPreview(); }}
                disabled={!canRefinePreview || actionBusy}
                aria-busy={refiningPreview}
                aria-label={refiningPreview ? "Refining preview..." : "Refine to Match Sketch"}
                title="Refine the interactive preview to match your sketch"
              >
                {refiningPreview ? <LoaderCircle size={16} className="student-action-spinner" aria-hidden="true" /> : <WandSparkles size={15} aria-hidden="true" />} {refiningPreview ? "Refining..." : "Match sketch"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => { void useStructuredFallback(["manual_fallback"]); }}
                disabled={!canUseStructuredFallback || actionBusy}
                aria-busy={fallbackPreviewRunning}
                aria-label={fallbackPreviewRunning ? "Building fallback..." : "Use Structured Fallback"}
                title="Build an alternative preview from the structured simulation"
              >
                {fallbackPreviewRunning ? <LoaderCircle size={16} className="student-action-spinner" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />} {fallbackPreviewRunning ? "Building preview..." : "Alternate preview"}
              </button>
              <button type="button" className="secondary-button preview-expand-button" onClick={() => { void togglePreviewSize().catch(() => setHtmlPreviewHealthMessage("Expanded view is unavailable in this browser.")); }} aria-label={previewExpanded ? "Exit expanded preview" : "Expand preview"}>
                {previewExpanded ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}{previewExpanded ? "Exit expanded view" : "Expand preview"}
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
          <SimulationHtmlStream
            active={generationStage === "html" || isActiveSimulationGenerationJob(htmlGenerationJob)}
            source={htmlStreamSource}
            startedAt={htmlGenerationJob?.startedAt}
            live={htmlStreamLive}
            finalizing={htmlGenerationJob?.status === "finalizing"}
          />
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
            <div className="safe-preview-empty">{generationActive ? "Your interactive simulation will open here after the HTML is complete and checked." : "Generate HTML to open your interactive simulation here."}</div>
          )}
        </section>

        {canSubmitSimulation && (
          <div className="simulation-final-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => { void submitFinalSimulation(); }}
              disabled={actionBusy}
              aria-busy={submittingSimulation}
            >
              {submittingSimulation ? <LoaderCircle size={18} className="student-action-spinner" aria-hidden="true" /> : <Send size={18} />} {submittingSimulation ? "Submitting simulation..." : "Submit Simulation"}
            </button>
          </div>
        )}

        <details className="raw-debug-accordion">
          <summary>Simulation Metadata</summary>
          <div className="raw-debug-content">
            <button type="button" className="secondary-button" disabled={modelSettingsLoading || !draftAttemptId} aria-busy={modelSettingsLoading} onClick={() => { void refreshModelSettings(); }}><RefreshCw size={15} aria-hidden="true" /> {modelSettingsLoading ? "Loading model settings…" : "Refresh model settings"}</button>
            {modelSettingsError && <p className="field-error" role="alert">{modelSettingsError}</p>}
            <p className="overall-comment">Next sketch model: {modelSettings?.sketchModelId || (modelSettingsLoading ? "Loading…" : "Unavailable")}</p>
            <p className="overall-comment">Next HTML model: {modelSettings?.htmlModelId || (modelSettingsLoading ? "Loading…" : "Unavailable")} | Next HTML reasoning: {modelSettings ? formatSimulationHtmlReasoningEffort(modelSettings.htmlReasoningEffort) : "Unavailable"}{modelSettings?.htmlMaxOutputTokens ? ` | Token limit: ${modelSettings.htmlMaxOutputTokens.toLocaleString()}` : ""}</p>
            <p className="overall-comment">Next HTML mode: {modelSettings ? modelSettings.htmlFastMode ? "Fast" : modelSettings.htmlServiceTierRequested === "provider_default" ? "Provider default" : "Standard" : modelSettingsLoading ? "Loading…" : "Unavailable"} | Fast mode: {modelSettings ? modelSettings.htmlFastMode ? "On" : "Off" : "Unavailable"} | Request tier: {modelSettings?.htmlServiceTierRequested ?? "n/a"}</p>
            <p className="overall-comment">These are the next request settings. Refresh to check for teacher changes. Current preview and job settings below describe the request that created them.</p>
            <p className="overall-comment">
              {sketchRequestedModel ? `Sketch requested model: ${sketchRequestedModel}` : "Sketch requested model: n/a"} | {sketchModelUsed ? `Sketch model used: ${sketchModelUsed}` : "Sketch model used: n/a"} | Output kind: image
            </p>
            <p className="overall-comment">
              {htmlRequestedModel ? `HTML requested model: ${htmlRequestedModel}` : "HTML requested model: n/a"} | {htmlModelUsed ? `HTML model used: ${htmlModelUsed}` : "HTML model used: n/a"} | Output kind: html
            </p>
            <p className="overall-comment">
              Current preview/job HTML reasoning: {currentHtmlReasoningEffort ? formatSimulationHtmlReasoningEffort(currentHtmlReasoningEffort) : "n/a"}
            </p>
            <p className="overall-comment">HTML requested tier: {(htmlGenerationJob ?? currentHtmlServiceTiers)?.htmlServiceTierRequested ?? "n/a"} | Provider reported tier: {(htmlGenerationJob ?? currentHtmlServiceTiers)?.htmlServiceTierUsed ?? "Not reported"}</p>
            <p className="overall-comment">Fast requests may be served as Standard (default). Reported tiers fast and priority both indicate Fast processing.</p>
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
