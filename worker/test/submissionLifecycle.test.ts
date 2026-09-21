import { beforeEach, describe, expect, it, vi } from "vitest";
import * as attemptLifecycleLib from "../src/lib/attemptLifecycle";
import * as dbLib from "../src/lib/db";
import type { Env } from "../src/lib/env";
import { HttpError } from "../src/lib/http";
import * as openaiLib from "../src/lib/openai";
import { gradeVoiceAttempt } from "../src/routes/voice";
import { gradeWritingAttempt } from "../src/routes/writing";

describe("submission lifecycle routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("marks voice attempts as error when provider processing fails after claim", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "transcribeAudio").mockRejectedValue(new HttpError(502, "Transcription failed"));
    vi.spyOn(openaiLib, "gradeVoice").mockResolvedValue({} as any);
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: { id: "attempt-voice" } as any,
      assessment: { id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-voice",
      attempt_id: "attempt-voice",
      student_id: "student-1",
      kind: "audio",
      bucket: "audio",
      storage_key: "audio/student-1/file.webm",
      mime_type: "audio/webm",
      byte_size: 16,
      original_filename: "voice.webm",
      openai_file_id: null,
      upload_state: "uploaded"
    } as any);
    vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-voice",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T00:00:00.000Z",
      submittedAfterDue: false,
      assignmentDueAt: null
    });

    const attemptUpdates: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(["audio"], { type: "audio/webm" }),
            error: null
          })
        })
      },
      from: (table: string) => {
        if (table !== "attempts") throw new Error(`Unexpected table ${table}`);
        return attemptsTable(attemptUpdates);
      }
    } as any;

    const request = new Request("https://worker.test/api/voice/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-voice", artifactId: "artifact-voice" })
    });

    await expect(gradeVoiceAttempt(request, { OPENAI_API_KEY: "key" } as Env, db, "student-1")).rejects.toMatchObject({
      status: 502,
      message: "Transcription failed"
    });

    expect(attemptUpdates).toHaveLength(1);
    expect(attemptUpdates[0]).toMatchObject({ status: "error" });
  });

  it("marks writing attempts as error when provider grading fails after claim", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "gradeWriting").mockRejectedValue(new HttpError(502, "Writing grading failed"));
    vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-123");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: { id: "attempt-writing" } as any,
      assessment: { id: "assessment-1", type: "writing", title: "Writing", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-writing",
      attempt_id: "attempt-writing",
      student_id: "student-1",
      kind: "writing",
      bucket: "writing",
      storage_key: "writing/student-1/file.png",
      mime_type: "image/png",
      byte_size: 32,
      original_filename: "writing.png",
      openai_file_id: "file-existing",
      upload_state: "uploaded"
    } as any);
    vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-writing",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T00:00:00.000Z",
      submittedAfterDue: true,
      assignmentDueAt: "2026-04-30T23:59:59.000Z"
    });

    const attemptUpdates: Record<string, unknown>[] = [];
    const storageFrom = vi.fn().mockReturnValue({
      download: vi.fn().mockResolvedValue({
        data: new Blob(["image"], { type: "image/png" }),
        error: null
      })
    });
    const db = {
      storage: {
        from: storageFrom
      },
      from: (table: string) => {
        if (table !== "attempts") throw new Error(`Unexpected table ${table}`);
        return attemptsTable(attemptUpdates);
      }
    } as any;

    const request = new Request("https://worker.test/api/writing/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-writing", artifactId: "artifact-writing" })
    });

    await expect(gradeWritingAttempt(request, { OPENAI_API_KEY: "key" } as Env, db, "student-1")).rejects.toMatchObject({
      status: 502,
      message: "Writing grading failed"
    });

    expect(attemptUpdates).toHaveLength(1);
    expect(attemptUpdates[0]).toMatchObject({ status: "error" });
    expect(storageFrom).not.toHaveBeenCalled();
  });

  it("marks writing attempts as error when caching uploaded OpenAI file handle fails", async () => {
    vi.spyOn(openaiLib, "enforceModelConfirmation").mockImplementation(() => {});
    vi.spyOn(openaiLib, "openaiClient").mockReturnValue({} as any);
    vi.spyOn(openaiLib, "gradeWriting").mockResolvedValue({} as any);
    vi.spyOn(openaiLib, "uploadUserDataFile").mockResolvedValue("file-new");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: { id: "attempt-cache-fail" } as any,
      assessment: { id: "assessment-1", type: "writing", title: "Writing", prompt: "Prompt", rubric: [], config: {} }
    } as any);
    vi.spyOn(dbLib, "requireArtifact").mockResolvedValue({
      id: "artifact-cache-fail",
      attempt_id: "attempt-cache-fail",
      student_id: "student-1",
      kind: "writing",
      bucket: "writing",
      storage_key: "writing/student-1/file.png",
      mime_type: "image/png",
      byte_size: 32,
      original_filename: "writing.png",
      openai_file_id: null,
      upload_state: "uploaded"
    } as any);
    vi.spyOn(attemptLifecycleLib, "claimAttemptSubmission").mockResolvedValue({
      attemptId: "attempt-cache-fail",
      assignmentId: "assignment-1",
      submittedAt: "2026-05-01T00:00:00.000Z",
      submittedAfterDue: false,
      assignmentDueAt: null
    });

    const attemptUpdates: Record<string, unknown>[] = [];
    const db = {
      storage: {
        from: () => ({
          download: vi.fn().mockResolvedValue({
            data: new Blob(["image"], { type: "image/png" }),
            error: null
          })
        })
      },
      from: (table: string) => {
        if (table === "attempt_artifacts") {
          return {
            update() {
              return {
                eq() {
                  return this;
                },
                then(resolve: (value: { error: { message: string } }) => void) {
                  resolve({ error: { message: "cache write failed" } });
                }
              };
            }
          };
        }
        if (table !== "attempts") throw new Error(`Unexpected table ${table}`);
        return attemptsTable(attemptUpdates);
      }
    } as any;

    const request = new Request("https://worker.test/api/writing/grade", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attemptId: "attempt-cache-fail", artifactId: "artifact-cache-fail" })
    });

    await expect(gradeWritingAttempt(request, { OPENAI_API_KEY: "key" } as Env, db, "student-1")).rejects.toMatchObject({
      status: 500,
      message: "Failed to cache writing artifact file handle"
    });

    expect(attemptUpdates).toHaveLength(1);
    expect(attemptUpdates[0]).toMatchObject({ status: "error" });
  });
});

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
