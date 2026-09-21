import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIMULATION_HTML_REASONING_EFFORT,
  LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT,
  LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
  SIMULATION_HTML_REASONING_EFFORTS,
  SIMULATION_HTML_VIEWPORT_HEIGHT,
  SIMULATION_HTML_VIEWPORT_WIDTH,
  SIMULATION_INSUFFICIENT_DETAIL_MESSAGE
} from "@alt-assessment/shared";
import { ApiRequestError, buildGenerateSimulationRequest, buildRefineSimulationRequest, createSimulationPreviewObjectUrl } from "../src/lib/api";
import {
  SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE,
  canCancelSimulationGenerationJob,
  canRetrySimulationHtmlPreview,
  isActiveSimulationGenerationJob,
  isRetryableSimulationAttemptError,
  isTerminalSimulationJobStatus,
  resolveSimulationPreviewMetrics,
  resolveSimulationGenerateButtonLabel,
  resolveSimulationReadinessMessage,
  resolveSimulationRunMessage,
} from "../src/lib/simulationGenerationUi";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("simulation generation UI helpers", () => {
  it("uses stage-specific button labels", () => {
    expect(resolveSimulationGenerateButtonLabel("idle")).toBe("Generate sketch and HTML");
    expect(resolveSimulationGenerateButtonLabel("sketch")).toBe("Generating sketch...");
    expect(resolveSimulationGenerateButtonLabel("html")).toBe("Converting sketch...");
    expect(resolveSimulationGenerateButtonLabel("done")).toBe("Generate sketch and HTML");
  });

  it("does not show a run message before generation starts", () => {
    expect(resolveSimulationRunMessage({
      stage: "idle",
      runStarted: false,
      runError: null,
      sketchReady: false,
      htmlReady: false
    })).toBeNull();
  });

  it("prioritizes visible errors over progress messages", () => {
    expect(resolveSimulationRunMessage({
      stage: "sketch",
      runStarted: true,
      runError: "Sketch generation failed.",
      sketchReady: false,
      htmlReady: false
    })).toEqual({
      kind: "error",
      message: "Sketch generation failed."
    });
  });

  it("describes active sketch and HTML stages", () => {
    expect(resolveSimulationRunMessage({
      stage: "sketch",
      runStarted: true,
      runError: null,
      sketchReady: false,
      htmlReady: false
    })).toEqual({
      kind: "status",
      message: "Generating sketch..."
    });
    expect(resolveSimulationRunMessage({
      stage: "html",
      runStarted: true,
      runError: null,
      sketchReady: true,
      htmlReady: false
    })).toEqual({
      kind: "status",
      message: "Converting sketch into interactive HTML."
    });
  });

  it("distinguishes completed full output from partial sketch output", () => {
    expect(resolveSimulationRunMessage({
      stage: "done",
      runStarted: true,
      runError: null,
      sketchReady: true,
      htmlReady: true
    })).toEqual({
      kind: "status",
      message: "Generated sketch and interactive HTML."
    });
    expect(resolveSimulationRunMessage({
      stage: "done",
      runStarted: true,
      runError: null,
      sketchReady: true,
      htmlReady: false
    })).toEqual({
      kind: "status",
      message: "Sketch generated. Interactive HTML needs attention."
    });
  });

  it("uses neutral readiness messaging without hints", () => {
    expect(resolveSimulationReadinessMessage("block")).toEqual({
      kind: "error",
      message: SIMULATION_INSUFFICIENT_DETAIL_MESSAGE
    });
    expect(resolveSimulationReadinessMessage("needs_classifier")).toBeNull();
    expect(resolveSimulationReadinessMessage("allow")).toBeNull();
    expect(SIMULATION_INSUFFICIENT_DETAIL_MESSAGE).not.toMatch(/pressure|temperature|formula|because/i);
  });

  it("treats simulation error-state draft failures as retryable with fresh attempt recovery", () => {
    expect(isRetryableSimulationAttemptError(new ApiRequestError(
      "Attempt is no longer in draft state",
      409,
      undefined,
      { attemptId: "attempt-1", status: "error" }
    ))).toBe(true);
    expect(isRetryableSimulationAttemptError({
      status: 409,
      message: "Different lifecycle wording",
      details: { attemptId: "attempt-1", status: "error" }
    })).toBe(true);
    expect(SIMULATION_STALE_ATTEMPT_RETRY_MESSAGE).toBe("Previous simulation attempt could not be retried. Generate again to start a fresh draft.");
  });

  it("keeps submitted and final lifecycle responses non-retryable", () => {
    expect(isRetryableSimulationAttemptError(new ApiRequestError(
      "Attempt is no longer in draft state",
      409,
      "already_submitted",
      { attemptId: "attempt-1", status: "submitted" }
    ))).toBe(false);
    expect(isRetryableSimulationAttemptError(new ApiRequestError(
      "Final assessment already published",
      409,
      "final_published",
      { assignmentId: "assignment-1" }
    ))).toBe(false);
  });

  it("classifies simulation generation jobs for cancel and retry controls", () => {
    const activeJob = {
      jobId: "job-active",
      operation: "generate",
      status: "in_progress",
      startedAt: "2026-05-07T12:00:00.000Z",
      expiresAt: "2026-05-07T12:20:00.000Z",
      message: "Generating interactive HTML..."
    } as const;
    const incompleteJob = {
      ...activeJob,
      jobId: "job-incomplete",
      status: "incomplete",
      message: "Generation used too much reasoning before producing HTML. Try again with the faster setting."
    } as const;

    expect(isActiveSimulationGenerationJob(activeJob)).toBe(true);
    expect(canCancelSimulationGenerationJob(activeJob)).toBe(true);
    expect(isTerminalSimulationJobStatus(incompleteJob.status)).toBe(true);
    expect(isActiveSimulationGenerationJob(incompleteJob)).toBe(false);
    expect(canCancelSimulationGenerationJob(incompleteJob)).toBe(false);
    expect(canRetrySimulationHtmlPreview({
      sketchReady: true,
      htmlReady: false,
      generationActive: false
    })).toBe(true);
    expect(canRetrySimulationHtmlPreview({
      sketchReady: true,
      htmlReady: true,
      generationActive: false
    })).toBe(true);
    expect(canRetrySimulationHtmlPreview({
      sketchReady: true,
      htmlReady: false,
      generationActive: true
    })).toBe(false);
  });

  it("uses medium as the default HTML reasoning effort and exposes low/medium/high options", () => {
    expect(DEFAULT_SIMULATION_HTML_REASONING_EFFORT).toBe("medium");
    expect(SIMULATION_HTML_REASONING_EFFORTS).toEqual(["low", "medium", "high"]);
  });

  it("serializes selected HTML reasoning effort for generation and refinement requests", () => {
    expect(buildGenerateSimulationRequest({
      attemptId: "attempt-1",
      description: "A to B",
      sketchArtifactId: "sketch-1",
      htmlReasoningEffort: "low"
    })).toEqual({
      attemptId: "attempt-1",
      description: "A to B",
      sketchArtifactId: "sketch-1",
      htmlReasoningEffort: "low"
    });
    expect(buildRefineSimulationRequest({
      attemptId: "attempt-1",
      description: "A to B",
      sketchArtifactId: "sketch-1",
      htmlArtifactId: "html-1",
      htmlReasoningEffort: "high"
    })).toEqual({
      attemptId: "attempt-1",
      description: "A to B",
      sketchArtifactId: "sketch-1",
      htmlArtifactId: "html-1",
      htmlReasoningEffort: "high"
    });
  });

  it("uses a fixed virtual viewport for auto-fit previews", () => {
    expect(resolveSimulationPreviewMetrics({
      containerWidth: SIMULATION_HTML_VIEWPORT_WIDTH,
      containerHeight: SIMULATION_HTML_VIEWPORT_HEIGHT,
      viewport: { width: SIMULATION_HTML_VIEWPORT_WIDTH, height: SIMULATION_HTML_VIEWPORT_HEIGHT }
    })).toEqual({
      scale: 1,
      iframeWidth: SIMULATION_HTML_VIEWPORT_WIDTH,
      iframeHeight: SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperHeight: SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperOverflow: "hidden"
    });
  });

  it("scales auto-fit previews by the tighter visible dimension", () => {
    expect(resolveSimulationPreviewMetrics({
      containerWidth: SIMULATION_HTML_VIEWPORT_WIDTH,
      containerHeight: 512,
      viewport: { width: SIMULATION_HTML_VIEWPORT_WIDTH, height: SIMULATION_HTML_VIEWPORT_HEIGHT }
    })).toEqual({
      scale: 0.8,
      iframeWidth: SIMULATION_HTML_VIEWPORT_WIDTH,
      iframeHeight: SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperHeight: SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperOverflow: "hidden"
    });
  });

  it("keeps narrow auto-fit previews non-scrollable", () => {
    const metrics = resolveSimulationPreviewMetrics({
      containerWidth: 390,
      containerHeight: 420,
      viewport: { width: SIMULATION_HTML_VIEWPORT_WIDTH, height: SIMULATION_HTML_VIEWPORT_HEIGHT }
    });
    expect(metrics.scale).toBeCloseTo(390 / SIMULATION_HTML_VIEWPORT_WIDTH, 6);
    expect(metrics).toMatchObject({
      iframeWidth: SIMULATION_HTML_VIEWPORT_WIDTH,
      iframeHeight: SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperHeight: 260,
      wrapperOverflow: "hidden"
    });
  });

  it("defaults missing preview viewport metadata to the legacy artifact size", () => {
    expect(resolveSimulationPreviewMetrics({
      containerWidth: LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
      containerHeight: LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT
    })).toEqual({
      scale: 1,
      iframeWidth: LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
      iframeHeight: LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperHeight: LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT,
      wrapperOverflow: "hidden"
    });
  });

  it("decorates HTML preview blobs with no-scroll rules and optional health reporting", async () => {
    const { objectUrls } = stubCreateObjectUrl();
    const blob = new Blob(["<!doctype html><html><head><title>x</title></head><body><main>ok</main></body></html>"], {
      type: "text/html; charset=utf-8"
    });

    expect(await createSimulationPreviewObjectUrl(blob, { healthNonce: "nonce-1" })).toBe("blob:test-1");
    expect(objectUrls).toHaveLength(1);
    expect(objectUrls[0]).not.toBe(blob);
    expect(objectUrls[0].type).toContain("text/html");
    const decoratedHtml = await objectUrls[0].text();
    expect(decoratedHtml).toContain("data-alt-assessment-simulation-preview-fit");
    expect(decoratedHtml).toContain("<style data-alt-assessment-simulation-preview-fit>");
    expect(decoratedHtml).toContain("<script data-alt-assessment-simulation-preview-fit>");
    expect(decoratedHtml).toContain("alt-assessment:simulation-preview-health");
    expect(decoratedHtml).toContain("nonce-1");
    expect(decoratedHtml).toContain("html,\nbody");
    expect(decoratedHtml).toContain("overflow: hidden !important");
    expect(decoratedHtml).toContain("box-sizing: border-box !important");
    expect(decoratedHtml).not.toContain("alt-assessment-preview-fit-root");
    expect(decoratedHtml).not.toContain("MutationObserver");
    expect(decoratedHtml).not.toContain("ResizeObserver");
  });

  it("adds a head for HTML preview decorations without moving the doctype", async () => {
    const { objectUrls } = stubCreateObjectUrl();
    const blob = new Blob(["<!doctype html><html><body><main>ok</main></body></html>"], {
      type: "text/html"
    });

    expect(await createSimulationPreviewObjectUrl(blob)).toBe("blob:test-1");
    const decoratedHtml = await objectUrls[0].text();
    expect(decoratedHtml).toMatch(/^<!doctype html><html><head><style data-alt-assessment-simulation-preview-fit>/i);
  });

  it("does not decorate non-HTML preview blobs", async () => {
    const { objectUrls } = stubCreateObjectUrl();
    const blob = new Blob(["png"], { type: "image/png" });

    expect(await createSimulationPreviewObjectUrl(blob)).toBe("blob:test-1");
    expect(objectUrls).toEqual([blob]);
  });
});

function stubCreateObjectUrl(): { objectUrls: Blob[] } {
  const objectUrls: Blob[] = [];
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((blob: Blob) => {
      objectUrls.push(blob);
      return `blob:test-${objectUrls.length}`;
    }),
    revokeObjectURL: vi.fn()
  });
  return { objectUrls };
}
