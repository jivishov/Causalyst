import * as jobsLib from "../src/lib/simulationJobs";
import * as budgetLib from "../src/lib/aiBudget";
import * as evidenceLib from "../src/lib/evidence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUDIO_MAX_BYTES, SIMULATION_HTML_VIEWPORT } from "@alt-assessment/shared";
import { createUploadToken, previewArtifact, uploadArtifact } from "../src/routes/artifacts";
import { HttpError } from "../src/lib/http";
import * as cryptoLib from "../src/lib/crypto";
import * as dbLib from "../src/lib/db";
import * as openaiLib from "../src/lib/openai";
import * as attemptLifecycleLib from "../src/lib/attemptLifecycle";
import { fallbackSimulation, generateSimulation, generateSimulationSketch, getSimulationGenerationJob, refineSimulation, submitSimulation } from "../src/routes/simulation";

describe("simulation artifact flow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(budgetLib, "reserveAiBudget").mockResolvedValue();
    vi.spyOn(evidenceLib, "completeArtifact").mockImplementation(async (db, userId, artifactId, hash) => {
      await db.from("attempt_artifacts").update({ upload_state: "uploaded", content_sha256: hash }).eq("id", artifactId).eq("student_id", userId);
    });
    vi.spyOn(jobsLib, "reserveSimulationJob").mockImplementation(async (db, input) => {
      const table = db.from("simulation_generation_jobs");
      const { data: active, error } = await table.select("*").eq("attempt_id", input.attemptId).eq("reasoning_effort", input.htmlReasoningEffort).maybeSingle();
      if (error) throw new HttpError(503, "Simulation generation job storage is not ready. Apply the latest Supabase database update and try again.");
      if (active) return { claimed: false, job: active };
      const { data: job } = await table.insert({ attempt_id: input.attemptId, student_id: input.userId, operation: input.operation,
        status: "queued", provider: input.provider, requested_model: input.requestedModel, reasoning_effort: input.htmlReasoningEffort,
        sketch_artifact_id: input.sketchArtifactId, input_html_artifact_id: input.inputHtmlArtifactId ?? null,
        source_description_sha256: input.sourceDescriptionSha256, expires_at: new Date(Date.now() + 1200000).toISOString() }).select("*").single();
      return { claimed: true, job };
    });
  });

  it("starts generated HTML as a draft background job without claiming submission", async () => {
    const description = "Water evaporates, condenses, and returns as precipitation in a closed cycle.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse").mockResolvedValue({
      responseId: "resp-html-1",
      status: "queued",
      modelUsed: "gpt-5.5",
      requestedModel: "openai:gpt-5.5"
    });
    vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch123");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-1/sketch-1-simulation-sketch.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: null,
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-1",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T12:00:00.000Z",
      submittedAfterDue: false,
      assignmentDueAt: "2026-05-02T00:00:00.000Z"
    });
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();

    const insertedJobs: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const attemptUpdateFilters: Array<{ column: string; value: unknown }> = [];
    const downloadSpy = vi.fn().mockResolvedValue({
      data: new Blob(["png-bytes"], { type: "image/png" }),
      error: null
    });

    const db = {
      storage: {
        from: (bucket: string) => {
          if (bucket === "simulation-sketch") return { download: downloadSpy };
          throw new Error(`Unexpected bucket ${bucket}`);
        }
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") return artifactTable([], updatedArtifactRows);
        if (table === "simulation_generation_jobs") return simulationJobTable(insertedJobs);
        if (table === "attempts") {
          return {
            update(payload: Record<string, unknown>) {
              expect(claimSpy).not.toHaveBeenCalled();
              updatedAttempts.push(payload);
              return {
                eq(column: string, value: unknown) {
                  attemptUpdateFilters.push({ column, value });
                  return this;
                },
                then(resolve: (value: { error: null }) => void) {
                  resolve({ error: null });
                }
              };
            }
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        sketchArtifactId: "sketch-1",
        description
      })
    });

    const result = await generateSimulation(request, {
      OPENAI_API_KEY: "key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1");

    expect(result.jobId).toBe("job-1");
    expect(result.status).toBe("queued");
    expect(result.operation).toBe("generate");
    expect(result.modelUsed).toBe("gpt-5.5");
    expect(result.requestedModel).toBe("openai:gpt-5.5");
    expect(result.htmlReasoningEffort).toBe("medium");

    expect(insertedJobs).toHaveLength(1);
    expect(insertedJobs[0]).toMatchObject({
      attempt_id: "attempt-1",
      student_id: "student-1",
      operation: "generate",
      status: "queued",
      provider_response_id: "resp-html-1",
      requested_model: "openai:gpt-5.5",
      model_used: "gpt-5.5",
      reasoning_effort: "medium",
      sketch_artifact_id: "sketch-1",
      input_html_artifact_id: null,
      source_description_sha256: await descriptionHash(description),
    });
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(openaiLib.startSimulationHtmlBackgroundResponse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sketchFileId: "file-sketch123",
      htmlReasoningEffort: "medium"
    }));
    expect(updatedArtifactRows).toHaveLength(1);
    expect(updatedArtifactRows[0]).toMatchObject({
      openai_file_id: "file-sketch123"
    });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(updatedAttempts).toHaveLength(1);
    expect(updatedAttempts[0]).toMatchObject({
      simulation_description: description
    });
    expect(attemptUpdateFilters).toEqual([
      { column: "id", value: "attempt-1" },
      { column: "student_id", value: "student-1" },
      { column: "status", value: "draft" }
    ]);
    expect(JSON.stringify(result)).not.toContain("resp-html-1");
    expect(JSON.stringify(result)).not.toContain("file-sketch123");
  });

  it("generates completed HTML with Kimi from sketch bytes and student text without OpenAI file ids", async () => {
    const description = "Water evaporates, condenses, and returns as precipitation in a closed cycle.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const client = { chat: { completions: { create: vi.fn() } } } as any;
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient").mockReturnValue(client);
    const uploadFileSpy = vi.spyOn(openaiLib, "uploadUserDataFile");
    const chatSpy = vi.spyOn(openaiLib, "generateSimulationHtmlChatCompletion").mockResolvedValue({
      html: "<!doctype html><html><body><main>simulation</main></body></html>",
      modelUsed: "kimi-k2.6",
      requestedModel: "kimi-k2.6",
      providerResponseId: "chatcmpl-secret"
    });
    vi.spyOn(cryptoLib, "signPreviewToken").mockResolvedValue("preview-token");
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-kimi"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: { simulationCodeModelId: "kimi:kimi-k2.6" }
      }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-kimi",
      attempt_id: "attempt-kimi",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-kimi/sketch-kimi.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: "file-openai-must-not-be-used",
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);

    const insertedArtifacts: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const insertedJobs: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const uploadSpy = vi.fn().mockResolvedValue({ error: null });
    const db = {
      storage: {
        from(bucket: string) {
          if (bucket === "simulation-sketch") {
            return {
              download: vi.fn().mockResolvedValue({
                data: new Blob(["png-bytes"], { type: "image/png" }),
                error: null
              })
            };
          }
          if (bucket === "simulation-derived") return { upload: uploadSpy };
          throw new Error(`Unexpected bucket ${bucket}`);
        }
      },
      from(table: string) {
        if (table === "attempt_artifacts") return artifactTable(insertedArtifacts, updatedArtifactRows);
        if (table === "simulation_generation_jobs") return simulationJobTable(insertedJobs);
        if (table === "attempts") return attemptsTable(updatedAttempts);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-kimi",
        sketchArtifactId: "sketch-kimi",
        description
      })
    });

    const result = await generateSimulation(request, {
      OPENAI_API_KEY: "openai-key",
      MOONSHOT_API_KEY: "moonshot-key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1");

    expect(openaiClientSpy).toHaveBeenCalledWith("moonshot-key", "https://api.moonshot.ai/v1");
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(chatSpy).toHaveBeenCalledWith(client, expect.objectContaining({
      id: "kimi:kimi-k2.6",
      provider: "kimi",
      providerModelId: "kimi-k2.6"
    }), expect.objectContaining({
      description,
      sketchDataUrl: expect.stringMatching(/^data:image\/png;base64,/)
    }));
    expect(result).toMatchObject({
      status: "completed",
      requestedModel: "kimi:kimi-k2.6",
      modelUsed: "kimi-k2.6",
      preview: expect.objectContaining({
        previewToken: "preview-token",
        generationSource: "model"
      })
    });
    expect(insertedJobs[0]).toMatchObject({
      status: "completed",
      provider: "kimi",
      provider_response_id: "chatcmpl-secret",
      requested_model: "kimi:kimi-k2.6",
      model_used: "kimi-k2.6",
      result_artifact_id: expect.any(String)
    });
    expect(JSON.stringify(result)).not.toContain("chatcmpl-secret");
    expect(JSON.stringify(result)).not.toContain("file-openai-must-not-be-used");
  });

  it("rejects invalid HTML reasoning effort before loading attempts or starting OpenAI", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const requireAttemptSpy = vi.spyOn(dbLib, "requireAttempt");
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient");
    const backgroundSpy = vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse");

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        sketchArtifactId: "sketch-1",
        description: "A cell divides into two daughter cells.",
        htmlReasoningEffort: "xhigh"
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, {} as any, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Invalid simulation HTML reasoning effort"
    });
    expect(requireAttemptSpy).not.toHaveBeenCalled();
    expect(openaiClientSpy).not.toHaveBeenCalled();
    expect(backgroundSpy).not.toHaveBeenCalled();
  });

  it("reuses only active HTML jobs matching the selected reasoning effort", async () => {
    const description = "A pendulum swings back and forth while its angle changes.";
    const sourceDescriptionSha256 = await descriptionHash(description);
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient");
    const backgroundSpy = vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-active"),
      assessment: { id: "assessment-1", type: "simulation", title: "Sim", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-active",
      attempt_id: "attempt-active",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "sketch-active.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: "file-sketch-active",
      source_description_sha256: sourceDescriptionSha256,
      upload_state: "uploaded"
    } as any);

    const eqFilters: Array<{ column: string; value: unknown }> = [];
    const activeJob = {
      id: "job-active",
      attempt_id: "attempt-active",
      student_id: "student-1",
      operation: "generate",
      status: "in_progress",
      provider: "openai",
      provider_response_id: "resp-active",
      requested_model: "openai:gpt-5.5",
      model_used: "gpt-5.5",
      reasoning_effort: "high",
      sketch_artifact_id: "sketch-active",
      input_html_artifact_id: null,
      result_artifact_id: null,
      source_description_sha256: sourceDescriptionSha256,
      error_message: null,
      provider_status: "in_progress",
      created_at: "2026-05-07T12:00:00.000Z",
      updated_at: "2026-05-07T12:00:00.000Z",
      completed_at: null,
      expires_at: "2099-01-01T00:00:00.000Z",
      cancelled_at: null
    };
    const db = {
      from(table: string) {
        if (table !== "simulation_generation_jobs") throw new Error(`Unexpected table ${table}`);
        return {
          select() {
            return {
              eq(column: string, value: unknown) {
                eqFilters.push({ column, value });
                return this;
              },
              in() {
                return this;
              },
              is() {
                return this;
              },
              order() {
                return this;
              },
              limit() {
                return this;
              },
              async maybeSingle() {
                return {
                  data: eqFilters.some((filter) => filter.column === "reasoning_effort" && filter.value === "high")
                    ? activeJob
                    : null,
                  error: null
                };
              }
            };
          }
        };
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-active",
        sketchArtifactId: "sketch-active",
        description,
        htmlReasoningEffort: "high"
      })
    });

    const result = await generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1");

    expect(result).toMatchObject({
      jobId: "job-active",
      status: "in_progress",
      requestedModel: "openai:gpt-5.5",
      modelUsed: "gpt-5.5",
      htmlReasoningEffort: "high"
    });
    expect(eqFilters).toContainEqual({ column: "reasoning_effort", value: "high" });
    expect(openaiClientSpy).not.toHaveBeenCalled();
    expect(backgroundSpy).not.toHaveBeenCalled();
  });

  it("polls a completed background job, stores HTML once, and hides provider ids from the client", async () => {
    const jobRow = {
      id: "job-complete",
      attempt_id: "attempt-1",
      student_id: "student-1",
      operation: "generate",
      status: "in_progress",
      provider: "openai",
      provider_response_id: "resp-secret",
      requested_model: "openai:gpt-5.5",
      model_used: "gpt-5.5",
      reasoning_effort: "low",
      sketch_artifact_id: "sketch-1",
      input_html_artifact_id: null,
      result_artifact_id: null,
      source_description_sha256: await descriptionHash("A to B"),
      error_message: null,
      provider_status: "in_progress",
      created_at: "2026-05-07T12:00:00.000Z",
      updated_at: "2026-05-07T12:00:00.000Z",
      completed_at: null,
      expires_at: "2099-01-01T00:00:00.000Z",
      cancelled_at: null
    };
    const client = {} as any;
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue(client);
    vi.spyOn(openaiLib, "retrieveSimulationBackgroundResponse").mockResolvedValue({
      id: "resp-secret",
      status: "completed",
      model: "gpt-5.5-2026-03-17",
      output_text: "<!doctype html><html><body>done</body></html>"
    });
    vi.spyOn(cryptoLib, "signPreviewToken").mockResolvedValue("preview-token");
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();

    const insertedArtifacts: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const uploadSpy = vi.fn().mockResolvedValue({ error: null });
    const db = {
      storage: {
        from(bucket: string) {
          if (bucket !== "simulation-derived") throw new Error(`Unexpected bucket ${bucket}`);
          return { upload: uploadSpy };
        }
      },
      from(table: string) {
        if (table === "simulation_generation_jobs") return simulationJobStateTable(jobRow);
        if (table === "attempt_artifacts") return artifactTable(insertedArtifacts, updatedArtifactRows);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const result = await getSimulationGenerationJob(
      new Request("https://worker.test/api/simulation/jobs/job-complete"),
      { OPENAI_API_KEY: "key", PIN_PEPPER: "pepper", WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any,
      db,
      "student-1",
      "job-complete"
    );

    expect(result).toMatchObject({
      jobId: "job-complete",
      status: "completed",
      preview: {
        previewPath: expect.stringMatching(/^\/artifacts\/.+\/preview$/),
        previewToken: "preview-token",
        outputKind: "html",
        generationSource: "model",
        htmlReasoningEffort: "low",
        htmlViewport: SIMULATION_HTML_VIEWPORT
      }
    });
    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(insertedArtifacts[0]).toMatchObject({
      kind: "simulation-derived",
      upload_state: "pending",
      simulation_html_viewport_width: SIMULATION_HTML_VIEWPORT.width,
      simulation_html_viewport_height: SIMULATION_HTML_VIEWPORT.height
    });
    expect(updatedArtifactRows.at(-1)).toMatchObject({ upload_state: "uploaded", content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(jobRow.result_artifact_id).toBe(result.preview?.artifactId);
    expect(JSON.stringify(result)).not.toContain("resp-secret");
  });

  it("maps incomplete max-output background jobs to a clear retry message", async () => {
    const jobRow = {
      id: "job-incomplete",
      attempt_id: "attempt-1",
      student_id: "student-1",
      operation: "generate",
      status: "in_progress",
      provider: "openai",
      provider_response_id: "resp-max-output",
      requested_model: "openai:gpt-5.5",
      model_used: "gpt-5.5",
      sketch_artifact_id: "sketch-1",
      input_html_artifact_id: null,
      result_artifact_id: null,
      source_description_sha256: await descriptionHash("A to B"),
      error_message: null,
      provider_status: "in_progress",
      created_at: "2026-05-07T12:00:00.000Z",
      updated_at: "2026-05-07T12:00:00.000Z",
      completed_at: null,
      expires_at: "2099-01-01T00:00:00.000Z",
      cancelled_at: null
    };
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "retrieveSimulationBackgroundResponse").mockResolvedValue({
      id: "resp-max-output",
      status: "incomplete",
      incomplete_details: {
        reason: "max_output_tokens"
      }
    });

    const db = {
      from(table: string) {
        if (table === "simulation_generation_jobs") return simulationJobStateTable(jobRow);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const result = await getSimulationGenerationJob(
      new Request("https://worker.test/api/simulation/jobs/job-incomplete"),
      { OPENAI_API_KEY: "key", PIN_PEPPER: "pepper", WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any,
      db,
      "student-1",
      "job-incomplete"
    );

    expect(result).toMatchObject({
      jobId: "job-incomplete",
      status: "incomplete",
      message: "Generation used too much reasoning before producing HTML. Try again with the faster setting.",
      errorMessage: "Generation used too much reasoning before producing HTML. Try again with the faster setting."
    });
    expect(jobRow).toMatchObject({
      status: "incomplete",
      provider_status: "incomplete",
      error_message: "Generation used too much reasoning before producing HTML. Try again with the faster setting."
    });
  });

  it("stores generated sketch as a private artifact without claiming submission", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "generateSimulationSketch").mockResolvedValue({
      bytes: new TextEncoder().encode("png-bytes"),
      mimeType: "image/png",
      modelUsed: "gpt-image-2",
      requestedModel: "gpt-image-2"
    });
    vi.spyOn(cryptoLib, "signPreviewToken").mockResolvedValue("sketch-preview-token");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-sketch"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);
    const auditSpy = vi.spyOn(dbLib, "logAudit").mockResolvedValue();

    const insertedArtifacts: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const uploadSpy = vi.fn().mockResolvedValue({ error: null });
    const db = {
      storage: {
        from: (bucket: string) => {
          expect(bucket).toBe("simulation-sketch");
          return { upload: uploadSpy };
        }
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") return artifactTable(insertedArtifacts, updatedArtifactRows);
        if (table === "attempts") return attemptsTable(updatedAttempts);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-sketch", description: "A cell divides into two daughter cells with chromosomes separated." })
    });

    const result = await generateSimulationSketch(request, {
      OPENAI_API_KEY: "key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1");

    expect(result.outputKind).toBe("image");
    expect(result.previewToken).toBe("sketch-preview-token");
    expect(claimSpy).not.toHaveBeenCalled();
    expect(insertedArtifacts).toHaveLength(1);
    expect(insertedArtifacts[0]).toMatchObject({
      attempt_id: "attempt-sketch",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      mime_type: "image/png"
    });
    expect(updatedArtifactRows).toHaveLength(1);
    expect(updatedArtifactRows[0]).toMatchObject({ upload_state: "uploaded", content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });

    const auditPayload = auditSpy.mock.calls[0][1] as any;
    expect(auditPayload.rawResponse).toMatchObject({
      outputKind: "simulation-sketch-artifact",
      artifactId: result.artifactId
    });
    expect(JSON.stringify(auditPayload)).not.toContain("png-bytes");
  });

  it("refines an existing draft HTML artifact without claiming submission", async () => {
    const description = "A tank gets hotter and the pressure gauge moves higher.";
    const sourceDescriptionSha256 = await descriptionHash(description);
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "startRefineSimulationHtmlBackgroundResponse").mockResolvedValue({
      responseId: "resp-refine-1",
      status: "queued",
      modelUsed: "gpt-5.5",
      requestedModel: "openai:gpt-5.5"
    });
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-refine"),
      assessment: { id: "assessment-1", type: "simulation", title: "Sim", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockImplementation(async (_db, _userId, artifactId) => ({
      id: artifactId,
      attempt_id: "attempt-refine",
      student_id: "student-1",
      kind: artifactId === "sketch-refine" ? "simulation-sketch" : "simulation-derived",
      bucket: artifactId === "sketch-refine" ? "simulation-sketch" : "simulation-derived",
      storage_key: artifactId === "sketch-refine" ? "sketch-refine.png" : "html-refine.html",
      mime_type: artifactId === "sketch-refine" ? "image/png" : "text/html; charset=utf-8",
      byte_size: 9,
      original_filename: artifactId === "sketch-refine" ? "simulation-sketch.png" : "simulation.html",
      openai_file_id: artifactId === "sketch-refine" ? "file-sketch-refine" : null,
      source_description_sha256: sourceDescriptionSha256,
      upload_state: "uploaded"
    }) as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);

    const insertedJobs: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: (bucket: string) => {
          if (bucket !== "simulation-derived") throw new Error(`Unexpected bucket ${bucket}`);
          return {
            download: vi.fn().mockResolvedValue({
              data: new Blob(["<!doctype html><html><body>distorted</body></html>"], { type: "text/html" }),
              error: null
            })
          };
        }
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") {
          return artifactTableWithExisting({
            id: "html-refine",
            storage_key: "html-refine.html",
            openai_file_id: null
          }, [], updatedArtifactRows);
        }
        if (table === "simulation_generation_jobs") return simulationJobTable(insertedJobs);
        if (table === "attempts") return attemptsTable(updatedAttempts);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/refine", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-refine",
        description,
        sketchArtifactId: "sketch-refine",
        htmlArtifactId: "html-refine",
        htmlReasoningEffort: "high"
      })
    });

    const result = await refineSimulation(request, { OPENAI_API_KEY: "key", PIN_PEPPER: "pepper" } as any, db, "student-1");

    expect(result).toMatchObject({
      jobId: "job-1",
      status: "queued",
      operation: "refine",
      requestedModel: "openai:gpt-5.5",
      modelUsed: "gpt-5.5",
      htmlReasoningEffort: "high"
    });
    expect(openaiLib.startRefineSimulationHtmlBackgroundResponse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sketchFileId: "file-sketch-refine",
      currentHtml: expect.stringContaining("distorted"),
      htmlReasoningEffort: "high"
    }));
    expect(insertedJobs[0]).toMatchObject({
      provider_response_id: "resp-refine-1",
      reasoning_effort: "high",
      sketch_artifact_id: "sketch-refine",
      input_html_artifact_id: "html-refine",
      source_description_sha256: sourceDescriptionSha256,
    });
    expect(updatedArtifactRows).toHaveLength(0);
    expect(updatedAttempts).toHaveLength(1);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("resp-refine-1");
  });

  it("creates a structured fallback HTML artifact without claiming submission", async () => {
    const description = "Gay-Lussac's Law: a scuba oxygen tank gets hotter, pressure increases, and the tank volume stays constant. When cooler, pressure decreases.";
    const sourceDescriptionSha256 = await descriptionHash(description);
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-fallback"),
      assessment: { id: "assessment-1", type: "simulation", title: "Gas Law", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockImplementation(async (_db, _userId, artifactId) => ({
      id: artifactId,
      attempt_id: "attempt-fallback",
      student_id: "student-1",
      kind: artifactId === "sketch-fallback" ? "simulation-sketch" : "simulation-derived",
      bucket: artifactId === "sketch-fallback" ? "simulation-sketch" : "simulation-derived",
      storage_key: `${artifactId}.bin`,
      mime_type: artifactId === "sketch-fallback" ? "image/png" : "text/html; charset=utf-8",
      byte_size: 9,
      original_filename: artifactId === "sketch-fallback" ? "simulation-sketch.png" : "simulation.html",
      openai_file_id: null,
      source_description_sha256: sourceDescriptionSha256,
      upload_state: "uploaded"
    }) as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);
    const auditSpy = vi.spyOn(dbLib, "logAudit").mockResolvedValue();
    vi.spyOn(cryptoLib, "signPreviewToken").mockResolvedValue("fallback-preview-token");

    const insertedArtifacts: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const uploadedHtml: string[] = [];
    const uploadSpy = vi.fn().mockImplementation(async (_storageKey: string, bytes: Uint8Array) => {
      uploadedHtml.push(new TextDecoder().decode(bytes));
      return { error: null };
    });
    const db = {
      storage: {
        from(bucket: string) {
          if (bucket !== "simulation-derived") throw new Error(`Unexpected bucket ${bucket}`);
          return { upload: uploadSpy };
        }
      },
      from(table: string) {
        if (table === "attempt_artifacts") return artifactTable(insertedArtifacts, updatedArtifactRows);
        if (table === "attempts") return attemptsTable(updatedAttempts);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/fallback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-fallback",
        description,
        sketchArtifactId: "sketch-fallback",
        htmlArtifactId: "html-fallback",
        reasonCodes: ["clipped_elements", "text_overflow"]
      })
    });

    const result = await fallbackSimulation(request, {
      OPENAI_API_KEY: "key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1");

    expect(result).toMatchObject({
      previewPath: expect.stringMatching(/^\/artifacts\/.+\/preview$/),
      previewToken: "fallback-preview-token",
      outputKind: "html",
      generationSource: "structured_fallback",
      htmlViewport: SIMULATION_HTML_VIEWPORT
    });
    expect(result.artifactId).not.toBe("html-fallback");
    expect(claimSpy).not.toHaveBeenCalled();
    expect(insertedArtifacts).toHaveLength(1);
    expect(insertedArtifacts[0]).toMatchObject({
      id: result.artifactId,
      kind: "simulation-derived",
      original_filename: "simulation-fallback.html",
      upload_state: "pending",
      source_description_sha256: sourceDescriptionSha256,
      simulation_html_viewport_width: SIMULATION_HTML_VIEWPORT.width,
      simulation_html_viewport_height: SIMULATION_HTML_VIEWPORT.height
    });
    expect(updatedArtifactRows.at(-1)).toMatchObject({ upload_state: "uploaded", content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(updatedAttempts).toHaveLength(1);
    expect(updatedAttempts[0]).toMatchObject({ simulation_description: description });
    expect(uploadedHtml[0]).toContain("Gay-Lussac");
    expect(uploadedHtml[0]).toContain("Structured fallback");
    expect(uploadedHtml[0]).not.toContain("Pressure gauge");
    expect(uploadedHtml[0]).not.toContain("Gas particles");
    expect(JSON.stringify(result)).not.toContain("html-fallback");
    expect(JSON.stringify(result)).not.toContain(sourceDescriptionSha256);
    expect((auditSpy.mock.calls[0][1] as any)).toMatchObject({
      route: "/api/simulation/fallback",
      provider: "system",
      model: "none"
    });
    expect((auditSpy.mock.calls[0][1] as any).requestSummary).toMatchObject({
      inputHtmlArtifactId: "html-fallback",
      htmlViewport: SIMULATION_HTML_VIEWPORT,
      renderer: "generic",
      reasonCodes: ["clipped_elements", "text_overflow"]
    });
    expect((auditSpy.mock.calls[0][1] as any).rawResponse).toMatchObject({
      outputKind: "simulation-derived-fallback-artifact",
      artifactId: result.artifactId,
      htmlViewport: SIMULATION_HTML_VIEWPORT,
      renderer: "generic"
    });
  });

  it("rejects non-draft simulation attempts before sketch readiness or image generation", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient");
    const imageSpy = vi.spyOn(openaiLib, "generateSimulationSketch").mockResolvedValue({
      bytes: new TextEncoder().encode("png-bytes"),
      mimeType: "image/png",
      modelUsed: "gpt-image-2",
      requestedModel: "gpt-image-2"
    });
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: { id: "attempt-stale", status: "error" } as any,
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const db = {
      storage: { from: vi.fn() },
      from: vi.fn()
    } as any;

    const request = new Request("https://worker.test/api/simulation/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-stale",
        description: "A scuba tank heats up in sunlight and the gas pressure rises inside the sealed tank."
      })
    });

    await expect(generateSimulationSketch(request, { OPENAI_API_KEY: "key" } as any, db, "student-1")).rejects.toMatchObject({
      status: 409,
      message: "Attempt is no longer in draft state",
      details: { attemptId: "attempt-stale", status: "error" },
      code: undefined
    });
    expect(openaiClientSpy).not.toHaveBeenCalled();
    expect(imageSpy).not.toHaveBeenCalled();
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects insufficient sketch descriptions before OpenAI image generation or artifact writes", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient");
    const imageSpy = vi.spyOn(openaiLib, "generateSimulationSketch").mockResolvedValue({
      bytes: new TextEncoder().encode("png-bytes"),
      mimeType: "image/png",
      modelUsed: "gpt-image-2",
      requestedModel: "gpt-image-2"
    });
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-sketch"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Describe a real life case for a gas law and show how the gas law applies.",
        rubric: [],
        config: { minDescriptionChars: 40 }
      }
    } as any);

    const db = {
      storage: { from: vi.fn() },
      from: vi.fn()
    } as any;

    const request = new Request("https://worker.test/api/simulation/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-sketch",
        description: "Real life case is a scuba diver's oxygen tank and it is related to Gay-Lussac's Law. Simulate the oxygen tank and show how it is related to Gay-Lussac's Law. Simulate the oxygen tank and show how it is related to Gay-Lussac's Law."
      })
    });

    await expect(generateSimulationSketch(request, {
      OPENAI_API_KEY: "key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Not enough student-provided detail to generate a sketch. No sketch was created."
    });

    expect(openaiClientSpy).not.toHaveBeenCalled();
    expect(imageSpy).not.toHaveBeenCalled();
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns retry guidance when the readiness classifier fails before sketch generation", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const client = {
      responses: {
        create: vi.fn().mockRejectedValue({
          status: 503,
          message: "model unavailable"
        })
      }
    } as any;
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue(client);
    const imageSpy = vi.spyOn(openaiLib, "generateSimulationSketch").mockResolvedValue({
      bytes: new TextEncoder().encode("png-bytes"),
      mimeType: "image/png",
      modelUsed: "gpt-image-2",
      requestedModel: "gpt-image-2"
    });
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-sketch"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Describe a real life case for a gas law and show how the gas law applies.",
        rubric: [],
        config: { minDescriptionChars: 40 }
      }
    } as any);

    const db = {
      storage: { from: vi.fn() },
      from: vi.fn()
    } as any;

    const request = new Request("https://worker.test/api/simulation/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-sketch",
        description: "A plant grows taller when fertilizer is added to the soil for four weeks."
      })
    });

    await expect(generateSimulationSketch(request, {
      OPENAI_API_KEY: "key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1")).rejects.toMatchObject({
      status: 503,
      message: "We could not check whether this description is ready. Please try again."
    });

    expect(client.responses.create).toHaveBeenCalledTimes(1);
    expect(imageSpy).not.toHaveBeenCalled();
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("creates a new sketch version and preserves previous artifact handles", async () => {
    const client = {} as any;
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue(client);
    vi.spyOn(openaiLib, "deleteOpenAIFile").mockResolvedValue();
    vi.spyOn(openaiLib, "generateSimulationSketch").mockResolvedValue({
      bytes: new TextEncoder().encode("new-png"),
      mimeType: "image/png",
      modelUsed: "gpt-image-2",
      requestedModel: "gpt-image-2"
    });
    vi.spyOn(cryptoLib, "signPreviewToken").mockResolvedValue("preview-token");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-sketch"),
      assessment: { id: "assessment-1", type: "simulation", title: "Sim", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();

    const insertedArtifacts: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const uploadSpy = vi.fn().mockResolvedValue({ error: null });
    const db = {
      storage: {
        from: () => ({ upload: uploadSpy })
      },
      from: (table: string) => {
        if (table === "attempts") return attemptsTable(updatedAttempts);
        if (table !== "attempt_artifacts") throw new Error(`Unexpected table ${table}`);
        return artifactTableWithExisting(
          {
            id: "sketch-existing",
            storage_key: "simulation-sketch/student-1/attempt-sketch/sketch-existing-simulation-sketch.png",
            openai_file_id: "file-old"
          },
          insertedArtifacts,
          updatedArtifactRows
        );
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-sketch", description: "A cell divides into two daughter cells with chromosomes separated." })
    });

    const result = await generateSimulationSketch(request, {
      OPENAI_API_KEY: "key",
      PIN_PEPPER: "pepper",
      WORKER_PUBLIC_BASE_URL: "https://worker.test"
    } as any, db, "student-1");

    expect(result.artifactId).not.toBe("sketch-existing");
    expect(insertedArtifacts).toHaveLength(1);
    expect(insertedArtifacts[0]).toMatchObject({ id: result.artifactId });
    expect(insertedArtifacts[0].openai_file_id).toBeUndefined();
    expect(openaiLib.deleteOpenAIFile).not.toHaveBeenCalled();
    expect(updatedArtifactRows).toHaveLength(1);
    expect(updatedArtifactRows[0]).toMatchObject({ upload_state: "uploaded" });
  });

  it("rejects HTML generation when the sketch was generated for different text", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: { id: "assessment-1", type: "simulation", title: "Sim", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-1/sketch-1.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: null,
      source_description_sha256: await descriptionHash("A parent cell separates into two daughter cells."),
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        sketchArtifactId: "sketch-1",
        description: "A water molecule evaporates and condenses into droplets."
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, {} as any, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Simulation sketch no longer matches the description. Generate a new sketch."
    });
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("rejects HTML generation when the sketch artifact is not an uploaded simulation sketch", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: { id: "assessment-1", type: "simulation", title: "Sim", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-html",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-derived",
      bucket: "simulation-derived",
      storage_key: "simulation-derived/student-1/attempt-1/artifact-html.html",
      mime_type: "text/html",
      byte_size: 100,
      original_filename: "simulation.html",
      openai_file_id: null,
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        sketchArtifactId: "artifact-html",
        description: "A parent cell separates into two daughter cells."
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, {} as any, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Simulation sketch artifact is not ready"
    });
    expect(claimSpy).not.toHaveBeenCalled();
  });

  it("skips duplicate readiness classification when generating HTML from a matching sketch", async () => {
    const description = "A plant grows taller when fertilizer is added to the soil for four weeks.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const client = {
      responses: {
        create: vi.fn()
      }
    } as any;
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue(client);
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Describe a real life case for a gas law and show how the gas law applies.",
        rubric: [],
        config: { minDescriptionChars: 40 }
      }
    } as any);
    const requireArtifactSpy = vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-1/sketch-1-simulation-sketch.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: "file-sketch",
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);
    const uploadFileSpy = vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch");
    const backgroundSpy = vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse").mockResolvedValue({
      responseId: "resp-html-1",
      status: "in_progress",
      modelUsed: "gpt-5.5",
      requestedModel: "openai:gpt-5.5"
    });
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();
    const insertedJobs: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from(bucket: string) {
          throw new Error(`Unexpected bucket ${bucket}`);
        }
      },
      from(table: string) {
        if (table === "attempt_artifacts") return artifactTable([], updatedArtifactRows);
        if (table === "simulation_generation_jobs") return simulationJobTable(insertedJobs);
        if (table === "attempts") return attemptsTable(updatedAttempts);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        sketchArtifactId: "sketch-1",
        description
      })
    });

    const result = await generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1");

    expect(result.jobId).toBe("job-1");
    expect(result.status).toBe("in_progress");
    expect(client.responses.create).not.toHaveBeenCalled();
    expect(requireArtifactSpy).toHaveBeenCalledTimes(1);
    expect(claimSpy).not.toHaveBeenCalled();
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(backgroundSpy).toHaveBeenCalledWith(client, expect.objectContaining({
      description,
      sketchFileId: "file-sketch",
      htmlReasoningEffort: "medium"
    }));
  });

  it("fails before starting OpenAI when simulation generation job storage is missing", async () => {
    const description = "A scuba tank gets hotter and the gas pressure rises because the tank volume stays constant.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    const uploadFileSpy = vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch");
    const backgroundSpy = vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse").mockResolvedValue({
      responseId: "resp-html-1",
      status: "queued",
      modelUsed: "gpt-5.5",
      requestedModel: "openai:gpt-5.5"
    });
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: { id: "assessment-1", type: "simulation", title: "Sim", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-1/sketch-1.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: null,
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);

    const db = {
      from(table: string) {
        if (table !== "simulation_generation_jobs") throw new Error(`Unexpected table ${table}`);
        return missingSimulationJobsTable();
      },
      storage: {
        from: vi.fn()
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        sketchArtifactId: "sketch-1",
        description
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1")).rejects.toMatchObject({
      status: 503,
      message: "Simulation generation job storage is not ready. Apply the latest Supabase database update and try again."
    });
    expect(openaiClientSpy).not.toHaveBeenCalled();
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(backgroundSpy).not.toHaveBeenCalled();
    expect(db.storage.from).not.toHaveBeenCalled();
  });

  it("rejects non-draft simulation attempts before sketch validation, HTML generation, or submission claim", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const openaiClientSpy = vi.spyOn(openaiLib, "openaiClient");
    const requireArtifactSpy = vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({} as any);
    const uploadFileSpy = vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch");
    const htmlSpy = vi.spyOn(openaiLib, "generateSimulationHtml").mockResolvedValue({
      html: "<!doctype html><html><body>simulation</body></html>",
      modelUsed: "gpt-5.5",
      requestedModel: "openai:gpt-5.5"
    });
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: { id: "attempt-stale", status: "error" } as any,
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const db = {
      storage: { from: vi.fn() },
      from: vi.fn()
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-stale",
        sketchArtifactId: "sketch-stale",
        description: "A scuba tank heats up in sunlight and the gas pressure rises inside the sealed tank."
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1")).rejects.toMatchObject({
      status: 409,
      message: "Attempt is no longer in draft state",
      details: { attemptId: "attempt-stale", status: "error" },
      code: undefined
    });
    expect(openaiClientSpy).not.toHaveBeenCalled();
    expect(requireArtifactSpy).not.toHaveBeenCalled();
    expect(uploadFileSpy).not.toHaveBeenCalled();
    expect(htmlSpy).not.toHaveBeenCalled();
    expect(claimSpy).not.toHaveBeenCalled();
    expect(db.storage.from).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rejects writing upload token reservation when mime is not allowed by assessment config", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: {
        id: "assessment-1",
        type: "writing",
        title: "Writing",
        prompt: "Prompt",
        rubric: [],
        config: {
          acceptedMime: ["application/pdf"],
          maxBytes: 1_024
        }
      }
    } as any);

    const db = {
      from: () => ({
        insert: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        kind: "writing",
        mimeType: "image/png",
        filename: "work.png",
        byteSize: 100
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Writing uploads must use one of: application/pdf"
    });
  });

  it("falls back to default writing mime list when assessment config mime list is malformed", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: {
        id: "assessment-1",
        type: "writing",
        title: "Writing",
        prompt: "Prompt",
        rubric: [],
        config: {
          acceptedMime: ["   "],
          maxBytes: 1_024
        }
      }
    } as any);
    vi.spyOn(cryptoLib, "signUploadToken").mockResolvedValue("upload-token");

    const insertedArtifacts: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        async insert(payload: Record<string, unknown>) {
          insertedArtifacts.push(payload);
          return { error: null };
        }
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        kind: "writing",
        mimeType: "image/png",
        filename: "work.png",
        byteSize: 100
      })
    });

    const result = await createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1");
    expect(result).toMatchObject({
      artifactId: expect.any(String),
      uploadToken: "upload-token"
    });
    expect(insertedArtifacts).toHaveLength(1);
    expect(insertedArtifacts[0]).toMatchObject({
      kind: "writing",
      mime_type: "image/png"
    });
  });

  it("rejects writing upload token reservation for non-writing attempts", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-voice"),
      assessment: {
        id: "assessment-voice",
        type: "voice",
        title: "Voice",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const db = {
      from: () => ({
        insert: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-voice",
        kind: "writing",
        mimeType: "application/pdf",
        filename: "work.pdf",
        byteSize: 100
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Attempt is not a writing assessment"
    });
  });

  it("rejects writing upload token reservation when byte size is zero", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: {
        id: "assessment-1",
        type: "writing",
        title: "Writing",
        prompt: "Prompt",
        rubric: [],
        config: {
          acceptedMime: ["application/pdf"],
          maxBytes: 1_024
        }
      }
    } as any);

    const db = {
      from: () => ({
        insert: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        kind: "writing",
        mimeType: "application/pdf",
        filename: "work.pdf",
        byteSize: 0
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Invalid byte size"
    });
  });

  it("rejects audio upload token reservation for non-voice attempts", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-writing"),
      assessment: {
        id: "assessment-writing",
        type: "writing",
        title: "Writing",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const db = {
      from: () => ({
        insert: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-writing",
        kind: "audio",
        mimeType: "audio/webm",
        filename: "voice.webm",
        byteSize: 100
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Attempt is not a voice assessment"
    });
  });

  it("rejects audio upload token reservation when size exceeds the server cap", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-voice"),
      assessment: {
        id: "assessment-voice",
        type: "voice",
        title: "Voice",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const insert = vi.fn();
    const db = {
      from: () => ({
        insert
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-voice",
        kind: "audio",
        mimeType: "audio/webm",
        filename: "voice.webm",
        byteSize: DEFAULT_AUDIO_MAX_BYTES + 1
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: `Audio upload exceeds max size of ${DEFAULT_AUDIO_MAX_BYTES} bytes`
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects client reservation for simulation-derived artifacts", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-sim"),
      assessment: {
        id: "assessment-sim",
        type: "simulation",
        title: "Simulation",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const db = {
      from: () => ({
        insert: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-sim",
        kind: "simulation-derived",
        mimeType: "text/html",
        filename: "simulation.html",
        byteSize: 100
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Simulation artifacts are generated server-side"
    });
  });

  it("rejects writing upload token reservation when size exceeds assessment max bytes", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-1"),
      assessment: {
        id: "assessment-1",
        type: "writing",
        title: "Writing",
        prompt: "Prompt",
        rubric: [],
        config: {
          acceptedMime: ["image/png"],
          maxBytes: 128
        }
      }
    } as any);

    const db = {
      from: () => ({
        insert: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/upload-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-1",
        kind: "writing",
        mimeType: "image/png",
        filename: "work.png",
        byteSize: 1_024
      })
    });

    await expect(createUploadToken(request, { WORKER_PUBLIC_BASE_URL: "https://worker.test" } as any, db, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Writing upload exceeds max size of 128 bytes"
    });
  });

  it("rejects too-short simulation descriptions before sketch image generation", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    const sketchSpy = vi.spyOn(openaiLib, "generateSimulationSketch").mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/png",
      modelUsed: "gpt-image-2",
      requestedModel: "gpt-image-2"
    });
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-short"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: { minDescriptionChars: 40 }
      }
    } as any);

    const request = new Request("https://worker.test/api/simulation/sketch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-short", description: "too short" })
    });

    await expect(generateSimulationSketch(request, { OPENAI_API_KEY: "key" } as any, {} as any, "student-1")).rejects.toMatchObject({
      status: 400,
      message: "Not enough student-provided detail to generate a sketch. No sketch was created."
    });
    expect(sketchSpy).not.toHaveBeenCalled();
  });

  it("rejects preview requests with invalid preview token", async () => {
    const db = {} as any;
    const request = new Request("https://worker.test/api/artifacts/a/preview?previewToken=bad-token");

    await expect(previewArtifact(request, {
      PIN_PEPPER: "pepper",
      ALLOWED_ORIGINS: "https://app.test"
    } as any, db, "student-1", "a")).rejects.toMatchObject({
      status: 403,
      message: "Invalid preview token"
    });
  });

  it("returns sandbox preview content for an owned uploaded simulation artifact", async () => {
    const expectedToken = await cryptoLib.signPreviewToken("artifact-1", "student-1", { PIN_PEPPER: "pepper" } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-derived",
      bucket: "simulation-derived",
      storage_key: "simulation-derived/student-1/attempt-1/artifact-1-simulation.html",
      mime_type: "text/html; charset=utf-8",
      byte_size: 32,
      original_filename: "simulation.html",
      openai_file_id: null,
      upload_state: "uploaded"
    } as any);

    const db = {
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(["<!doctype html><html><body>ok</body></html>"], { type: "text/html" }),
            error: null
          })
        })
      }
    } as any;

    const request = new Request(`https://worker.test/api/artifacts/artifact-1/preview?previewToken=${expectedToken}`, {
      headers: { Origin: "https://app.test" }
    });

    const response = await previewArtifact(request, {
      PIN_PEPPER: "pepper",
      ALLOWED_ORIGINS: "https://app.test"
    } as any, db, "student-1", "artifact-1");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.text()).resolves.toContain("<!doctype html>");
  });

  it("retries preview storage downloads for freshly generated simulation artifacts", async () => {
    const expectedToken = await cryptoLib.signPreviewToken("artifact-retry", "student-1", { PIN_PEPPER: "pepper" } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-retry",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-derived",
      bucket: "simulation-derived",
      storage_key: "simulation-derived/student-1/attempt-1/artifact-retry-simulation.html",
      mime_type: "text/html; charset=utf-8",
      byte_size: 32,
      original_filename: "simulation.html",
      openai_file_id: null,
      upload_state: "uploaded"
    } as any);

    const download = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "Object not found" } })
      .mockResolvedValueOnce({
        data: new Blob(["<!doctype html><html><body>ok</body></html>"], { type: "text/html" }),
        error: null
      });
    const db = {
      storage: {
        from: () => ({ download })
      }
    } as any;
    const request = new Request(`https://worker.test/api/artifacts/artifact-retry/preview?previewToken=${expectedToken}`);

    const response = await previewArtifact(request, {
      PIN_PEPPER: "pepper",
      ALLOWED_ORIGINS: "https://app.test"
    } as any, db, "student-1", "artifact-retry");

    expect(response.status).toBe(200);
    expect(download).toHaveBeenCalledTimes(2);
  });

  it("rejects replacement of completed evidence without deleting provider handles", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({ attempt: draftAttempt("attempt-1"), assessment: { type: "writing" } } as any);
    const client = {} as any;
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue(client);
    vi.spyOn(openaiLib, "deleteOpenAIFile").mockResolvedValue();
    vi.spyOn(cryptoLib, "verifyUploadToken").mockResolvedValue(true);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "writing",
      bucket: "writing",
      storage_key: "writing/student-1/attempt-1/artifact-1-work.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "work.png",
      openai_file_id: "file-old123",
      upload_state: "uploaded"
    } as any);

    const uploadedPayloads: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ error: null })
        })
      },
      from: (table: string) => {
        if (table !== "attempt_artifacts") throw new Error(`Unexpected table ${table}`);
        return {
          update(payload: Record<string, unknown>) {
            uploadedPayloads.push(payload);
            return eqChain({ error: null });
          }
        };
      }
    } as any;

    const request = new Request("https://worker.test/api/artifacts/artifact-1/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": "token" },
      body: "png-bytes"
    });

    await expect(uploadArtifact(request, { OPENAI_API_KEY: "key", PIN_PEPPER: "pepper" } as any, db, "student-1", "artifact-1")).rejects.toMatchObject({ status: 409 });
    expect(uploadedPayloads).toHaveLength(0);
    expect(openaiLib.deleteOpenAIFile).not.toHaveBeenCalled();
  });

  it("rejects artifact upload when uploaded bytes do not match the reservation", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({ attempt: draftAttempt("attempt-1"), assessment: { type: "writing" } } as any);
    vi.spyOn(cryptoLib, "verifyUploadToken").mockResolvedValue(true);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-2",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "writing",
      bucket: "writing",
      storage_key: "writing/student-1/attempt-1/artifact-2-work.png",
      mime_type: "image/png",
      byte_size: 1,
      original_filename: "work.png",
      openai_file_id: null,
      upload_state: "pending"
    } as any);

    const db = {
      storage: {
        from: () => ({
          upload: vi.fn()
        })
      },
      from: () => ({
        update: vi.fn()
      })
    } as any;

    const request = new Request("https://worker.test/api/artifacts/artifact-2/upload", {
      method: "PUT",
      headers: { "X-Upload-Token": "token" },
      body: "mismatch"
    });

    await expect(uploadArtifact(request, { PIN_PEPPER: "pepper" } as any, db, "student-1", "artifact-2")).rejects.toMatchObject({
      status: 400,
      message: "Uploaded byte size does not match artifact reservation"
    });
  });

  it("does not claim or mark error when simulation HTML generation fails before submission claim", async () => {
    const description = "A parent cell replicates DNA, aligns chromosomes, and separates into two daughter cells.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse").mockRejectedValue(new HttpError(502, "Provider failed"));
    vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch-err");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-err"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-err",
      attempt_id: "attempt-err",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-err/sketch-err.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: null,
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-err",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T12:00:00.000Z",
      submittedAfterDue: true,
      assignmentDueAt: "2026-05-01T11:59:59.000Z"
    });

    const updatedAttempts: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(["png-bytes"], { type: "image/png" }),
            error: null
          })
        })
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") {
          return {
            update() {
              return eqChain({ error: null });
            }
          };
        }
        if (table === "simulation_generation_jobs") return simulationJobTable([]);
        if (table !== "attempts") throw new Error(`Unexpected table ${table}`);
        return attemptsTable(updatedAttempts);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-err",
        sketchArtifactId: "sketch-err",
        description
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1")).rejects.toMatchObject({
      status: 502,
      message: "Provider failed"
    });

    expect(claimSpy).not.toHaveBeenCalled();
    expect(updatedAttempts).toHaveLength(1);
  });

  it("does not claim when generated HTML is started as a background job", async () => {
    const description = "A parent cell replicates DNA, aligns chromosomes, and separates into two daughter cells.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "startSimulationHtmlBackgroundResponse").mockResolvedValue({
      responseId: "resp-upload-deferred",
      status: "queued",
      modelUsed: "gpt-5.5",
      requestedModel: "openai:gpt-5.5"
    });
    vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch-upload-fail");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-upload-fail"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-upload-fail",
      attempt_id: "attempt-upload-fail",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-upload-fail/sketch-upload-fail.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: null,
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({} as any);

    const insertedJobs: Record<string, unknown>[] = [];
    const updatedArtifactRows: Record<string, unknown>[] = [];
    const updatedAttempts: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: (bucket: string) => {
          if (bucket === "simulation-sketch") {
            return {
              download: vi.fn().mockResolvedValue({
                data: new Blob(["png-bytes"], { type: "image/png" }),
                error: null
              })
            };
          }
          throw new Error(`Unexpected bucket ${bucket}`);
        }
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") return artifactTable([], updatedArtifactRows);
        if (table === "simulation_generation_jobs") return simulationJobTable(insertedJobs);
        if (table === "attempts") return attemptsTable(updatedAttempts);
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-upload-fail",
        sketchArtifactId: "sketch-upload-fail",
        description
      })
    });

    const result = await generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1");
    expect(result).toMatchObject({ jobId: "job-1", status: "queued", operation: "generate" });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(insertedJobs).toHaveLength(1);
    expect(updatedAttempts).toHaveLength(1);
  });

  it("claims submission only from the explicit simulation submit route", async () => {
    const description = "A parent cell replicates DNA, aligns chromosomes, and separates into two daughter cells.";
    vi.spyOn(dbLib, "logAudit").mockResolvedValue();
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-claim"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);
    const source_description_sha256 = await descriptionHash(description);
    vi.spyOn(dbLib, "requireArtifact").mockImplementation(async (_db, _userId, artifactId) => ({
      id: artifactId,
      attempt_id: "attempt-claim",
      student_id: "student-1",
      kind: artifactId === "sketch-claim" ? "simulation-sketch" : "simulation-derived",
      bucket: artifactId === "sketch-claim" ? "simulation-sketch" : "simulation-derived",
      storage_key: `${artifactId}.bin`,
      mime_type: artifactId === "sketch-claim" ? "image/png" : "text/html",
      byte_size: 9,
      original_filename: artifactId === "sketch-claim" ? "simulation-sketch.png" : "simulation.html",
      openai_file_id: null,
      source_description_sha256,
      upload_state: "uploaded"
    }) as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-claim",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T12:00:00.000Z",
      submittedAfterDue: false,
      assignmentDueAt: null
    });

    const updatedAttempts: Record<string, unknown>[] = [];
    const db = {
      from: (table: string) => {
        if (table === "attempts") return attemptsTable(updatedAttempts);
        if (table === "attempt_audit_logs") return { insert: vi.fn().mockResolvedValue({ error: null }) };
        throw new Error(`Unexpected table ${table}`);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-claim",
        sketchArtifactId: "sketch-claim",
        htmlArtifactId: "html-claim",
        description
      })
    });

    await expect(submitSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1")).resolves.toEqual({
      attemptId: "attempt-claim"
    });
    expect(claimSpy).toHaveBeenCalledWith(db, "student-1", "attempt-claim", expect.any(String), ["sketch-claim", "html-claim"], expect.objectContaining({ description }));
    expect(updatedAttempts).toHaveLength(0); // The claim RPC freezes the description with the manifest.
  });

  it("returns a public retry message for non-HTTP provider failures before submission claim", async () => {
    const description = "A parent cell replicates DNA, aligns chromosomes, and separates into two daughter cells.";
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "generateSimulationHtml").mockRejectedValue(new Error("Unknown parameter: input[1].content[0].detail"));
    vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-sketch-provider");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: draftAttempt("attempt-provider"),
      assessment: {
        id: "assessment-1",
        type: "simulation",
        title: "Sim",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "sketch-provider",
      attempt_id: "attempt-provider",
      student_id: "student-1",
      kind: "simulation-sketch",
      bucket: "simulation-sketch",
      storage_key: "simulation-sketch/student-1/attempt-provider/sketch-provider.png",
      mime_type: "image/png",
      byte_size: 9,
      original_filename: "simulation-sketch.png",
      openai_file_id: null,
      source_description_sha256: await descriptionHash(description),
      upload_state: "uploaded"
    } as any);
    const claimSpy = vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-provider",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T12:00:00.000Z",
      submittedAfterDue: false,
      assignmentDueAt: null
    });

    const updatedAttempts: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(["png-bytes"], { type: "image/png" }),
            error: null
          })
        })
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") {
          return {
            update() {
              return eqChain({ error: null });
            }
          };
        }
        if (table !== "attempts") throw new Error(`Unexpected table ${table}`);
        return attemptsTable(updatedAttempts);
      }
    } as any;

    const request = new Request("https://worker.test/api/simulation/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attemptId: "attempt-provider",
        sketchArtifactId: "sketch-provider",
        description
      })
    });

    await expect(generateSimulation(request, { OPENAI_API_KEY: "key" } as any, db, "student-1")).rejects.toMatchObject({
      status: 502,
      message: "Simulation generation failed. Please try again."
    });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(updatedAttempts).toHaveLength(0);
  });
});

function artifactTable(insertedArtifacts: Record<string, unknown>[], updatedArtifactRows: Record<string, unknown>[]) {
  return {
    select() {
      return {
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: null };
        }
      };
    },
    async insert(payload: Record<string, unknown>) {
      insertedArtifacts.push(payload);
      return { error: null };
    },
    update(payload: Record<string, unknown>) {
      updatedArtifactRows.push(payload);
      return eqChain({ error: null });
    }
  };
}

function artifactTableWithExisting(
  existing: Record<string, unknown>,
  insertedArtifacts: Record<string, unknown>[],
  updatedArtifactRows: Record<string, unknown>[]
) {
  return {
    select() {
      return {
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: existing, error: null };
        }
      };
    },
    async insert(payload: Record<string, unknown>) {
      insertedArtifacts.push(payload);
      return { error: null };
    },
    update(payload: Record<string, unknown>) {
      updatedArtifactRows.push(payload);
      return eqChain({ error: null });
    }
  };
}

function attemptsTable(updatedAttempts: Record<string, unknown>[]) {
  return {
    update(payload: Record<string, unknown>) {
      updatedAttempts.push(payload);
      return {
        eq() {
          return this;
        },
        then(resolve: (value: { error: null }) => void) {
          resolve({ error: null });
        }
      };
    }
  };
}

function simulationJobTable(insertedJobs: Record<string, unknown>[]) {
  return {
    update(payload: Record<string, unknown>) {
      const row = insertedJobs[0];
      if (row) Object.assign(row, payload);
      return {
        eq() { return this; }, in() { return this; }, select() { return this; },
        async single() { return { data: row, error: null }; },
        then(resolve: (value: { error: null }) => void) { resolve({ error: null }); }
      };
    },
    select() {
      return {
        eq() {
          return this;
        },
        in() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return { data: null, error: null };
        }
      };
    },
    insert(payload: Record<string, unknown>) {
      const row = {
        id: "job-1",
        provider: "openai",
        result_artifact_id: null,
        error_message: null,
        created_at: "2026-05-07T12:00:00.000Z",
        updated_at: "2026-05-07T12:00:00.000Z",
        completed_at: null,
        cancelled_at: null,
        ...payload
      };
      insertedJobs.push(row);
      return {
        select() {
          return {
            async single() {
              return { data: row, error: null };
            }
          };
        }
      };
    }
  };
}

function missingSimulationJobsTable() {
  return {
    select() {
      return {
        eq() {
          return this;
        },
        in() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        async maybeSingle() {
          return {
            data: null,
            error: {
              code: "PGRST205",
              message: "Could not find the table 'public.simulation_generation_jobs' in the schema cache"
            }
          };
        }
      };
    }
  };
}

function simulationJobStateTable(row: Record<string, unknown>) {
  return {
    select() {
      return {
        eq() {
          return this;
        },
        async maybeSingle() {
          return { data: row, error: null };
        }
      };
    },
    update(payload: Record<string, unknown>) {
      Object.assign(row, payload);
      return {
        eq() {
          return this;
        },
        in() { return this; },
        then(resolve: (value: { error: null }) => void) { resolve({ error: null }); },
        is() {
          return this;
        },
        select() {
          return {
            async single() {
              return { data: row, error: null };
            },
            async maybeSingle() {
              return { data: row, error: null };
            }
          };
        }
      };
    }
  };
}

function draftAttempt(id: string) {
  return { id, status: "draft" } as any;
}

function eqChain<T>(value: T) {
  return {
    eq() {
      return this;
    },
    then(resolve: (value: T) => void) {
      resolve(value);
    }
  };
}

async function descriptionHash(description: string): Promise<string> {
  const bytes = new TextEncoder().encode(description.trim());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("generation failure recovery", () => {
  it("makes invalid completed provider output terminal before the next poll", async () => {
    vi.restoreAllMocks();
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as never);
    const retrieve = vi.spyOn(openaiLib, "retrieveSimulationBackgroundResponse").mockResolvedValue({ status: "completed", model: "synthetic" } as never);
    vi.spyOn(openaiLib, "parseSimulationHtmlResponse").mockReturnValue('<!doctype html><html><body><img src=https://resource.invalid/leak></body></html>');
    const row = { id: "job-invalid", attempt_id: "attempt", student_id: "student", status: "in_progress", provider: "openai", provider_response_id: "response", expires_at: "2099-01-01T00:00:00Z" };
    const db = { from() { return simulationJobStateTable(row); } };
    await expect(getSimulationGenerationJob(new Request("https://worker.test"), {} as never, db as never, "student", "job-invalid")).rejects.toMatchObject({ status: 502 });
    expect(row.status).toBe("failed");
    expect((await getSimulationGenerationJob(new Request("https://worker.test"), {} as never, db as never, "student", "job-invalid")).status).toBe("failed");
    expect(retrieve).toHaveBeenCalledTimes(1);
  });
  it("rejects retained upload capabilities after submission before writing storage", async () => {
    vi.restoreAllMocks();
    vi.spyOn(cryptoLib, "verifyUploadToken").mockResolvedValue(true);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({ attempt_id: "attempt" } as never);
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({ attempt: { id: "attempt", status: "graded" } } as never);
    await expect(uploadArtifact(new Request("https://worker.test", { method: "PUT", body: "replacement" }), {} as never, {} as never, "student", "artifact")).rejects.toMatchObject({ status: 409 });
  });
});
