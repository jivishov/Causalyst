import {
  LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT,
  LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
  SIMULATION_HTML_VIEWPORT_HEIGHT,
  SIMULATION_HTML_VIEWPORT_WIDTH,
  SIMULATION_INSUFFICIENT_DETAIL_MESSAGE,
  type SimulationHtmlViewport,
  type SimulationReadinessDecision,
  type StudentSimulationGenerationJob
} from "@alt-assessment/shared";

export type SimulationGenerationStage = "idle" | "sketch" | "html" | "done";

export interface SimulationRunMessage {
  kind: "status" | "error";
  message: string;
}

export const SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE = "Previous simulation attempt could not be retried. Generate again to start a fresh draft.";
export const SIMULATION_PREVIEW_VIRTUAL_WIDTH = SIMULATION_HTML_VIEWPORT_WIDTH;
export const SIMULATION_PREVIEW_VIRTUAL_HEIGHT = SIMULATION_HTML_VIEWPORT_HEIGHT;

export interface SimulationPreviewMetricsInput {
  containerWidth: number;
  containerHeight: number;
  viewport?: SimulationHtmlViewport | null;
}

export interface SimulationPreviewMetrics {
  scale: number;
  iframeWidth: number;
  iframeHeight: number;
  wrapperHeight: number;
  wrapperOverflow: "hidden" | "auto";
}

export function resolveSimulationGenerateButtonLabel(stage: SimulationGenerationStage): string {
  if (stage === "sketch") return "Generating sketch...";
  if (stage === "html") return "Converting sketch...";
  return "Generate sketch and HTML";
}

export function resolveSimulationReadinessMessage(decision: SimulationReadinessDecision): SimulationRunMessage | null {
  if (decision !== "block") return null;
  return { kind: "error", message: SIMULATION_INSUFFICIENT_DETAIL_MESSAGE };
}

export function resolveSimulationRunMessage(input: {
  stage: SimulationGenerationStage;
  runStarted: boolean;
  runError: string | null;
  sketchReady: boolean;
  htmlReady: boolean;
}): SimulationRunMessage | null {
  if (input.runError) {
    return { kind: "error", message: input.runError };
  }
  if (!input.runStarted) return null;
  if (input.stage === "sketch") {
    return { kind: "status", message: "Generating sketch..." };
  }
  if (input.stage === "html") {
    return { kind: "status", message: "Converting sketch into interactive HTML." };
  }
  if (input.stage === "done" && input.htmlReady) {
    return { kind: "status", message: "Generated sketch and interactive HTML." };
  }
  if (input.stage === "done" && input.sketchReady) {
    return { kind: "status", message: "Sketch generated. Interactive HTML needs attention." };
  }
  return null;
}

export function isRetryableSimulationAttemptError(error: unknown): boolean {
  if (!isRecord(error) || error.status !== 409) return false;
  if (error.code === "already_submitted" || error.code === "final_published") return false;
  if (!isRecord(error.details)) return false;
  return error.details.status === "error";
}

export function isTerminalSimulationJobStatus(status: StudentSimulationGenerationJob["status"]): boolean {
  return status === "completed" || status === "failed" || status === "incomplete" || status === "cancelled" || status === "expired";
}

export function isActiveSimulationGenerationJob(job: StudentSimulationGenerationJob | null): boolean {
  return Boolean(job && !isTerminalSimulationJobStatus(job.status));
}

export function canCancelSimulationGenerationJob(job: StudentSimulationGenerationJob | null): boolean {
  return isActiveSimulationGenerationJob(job);
}

export function canRetrySimulationHtmlPreview(input: {
  sketchReady: boolean;
  htmlReady: boolean;
  generationActive: boolean;
}): boolean {
  return input.sketchReady && !input.generationActive;
}

export function resolveSimulationPreviewMetrics(input: SimulationPreviewMetricsInput): SimulationPreviewMetrics {
  const containerWidth = normalizeDimension(input.containerWidth);
  const containerHeight = normalizeDimension(input.containerHeight);
  const viewport = normalizeSimulationPreviewViewport(input.viewport);
  const virtualWidth = viewport.width;
  const virtualHeight = viewport.height;
  const wrapperHeight = containerWidth > 0
    ? clamp(Math.round(containerWidth * virtualHeight / virtualWidth), 260, virtualHeight)
    : virtualHeight;
  const widthScale = containerWidth > 0 ? containerWidth / virtualWidth : 1;
  const heightScale = (containerHeight > 0 ? containerHeight : wrapperHeight) / virtualHeight;
  const scale = clamp(Math.min(widthScale, heightScale), 0, 1);
  return {
    scale,
    iframeWidth: virtualWidth,
    iframeHeight: virtualHeight,
    wrapperHeight,
    wrapperOverflow: "hidden"
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeDimension(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function normalizeSimulationPreviewViewport(viewport: SimulationHtmlViewport | null | undefined): SimulationHtmlViewport {
  if (
    viewport
    && Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0
  ) {
    return {
      width: Math.round(viewport.width),
      height: Math.round(viewport.height)
    };
  }
  return {
    width: LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
    height: LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
