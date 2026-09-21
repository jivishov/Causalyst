import { describe, expect, it } from "vitest";
import { LEGACY_SIMULATION_HTML_VIEWPORT, SIMULATION_HTML_VIEWPORT } from "@alt-assessment/shared";
import { attemptResult, publishedFinalResult, startAttempt } from "../src/routes/attempts";
import { requireAttempt } from "../src/lib/db";

describe("assignment-scoped attempts", () => {
  it("creates separate attempts for distinct assignment IDs, even with shared assessment", async () => {
    const state = makeState();
    const db = makeDb(state);

    const first = await startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1");
    const second = await startAttempt(jsonRequest({ assignmentId: "assignment-2" }), db as never, "student-1");

    expect(first.attemptId).not.toBe(second.attemptId);
    expect(state.attempts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        assignment_id: "assignment-1",
        assessment_id: "assessment-1",
        student_id: "student-1",
        due_at_snapshot: "2026-05-01T12:00:00.000Z"
      }),
      expect.objectContaining({
        assignment_id: "assignment-2",
        assessment_id: "assessment-1",
        student_id: "student-1",
        due_at_snapshot: "2026-05-15T12:00:00.000Z"
      })
    ]));
  });

  it("rejects starting attempts for assignments outside student memberships", async () => {
    const state = makeState();
    state.class_memberships = [{ class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" }];
    const db = makeDb(state);

    await expect(startAttempt(jsonRequest({ assignmentId: "assignment-2" }), db as never, "student-1")).rejects.toMatchObject({
      status: 403,
      message: "Assignment is not available to this student"
    });
  });

  it("rejects starting attempts for archived assessments", async () => {
    const state = makeState();
    state.assessments[0].archived_at = "2026-05-01T00:00:00.000Z";
    const db = makeDb(state);

    await expect(startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1")).rejects.toMatchObject({
      status: 403,
      message: "Assignment is not available to this student"
    });
  });

  it("loads legacy attempts when assignment_id is null", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-legacy",
      assignment_id: null,
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "graded",
      transcript: "legacy transcript",
      ocr_text: null,
      simulation_description: null,
      simulation_spec: null,
      provisional_score: 88,
      provisional_feedback: null,
      submitted_at: "2026-01-01T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      due_at_snapshot: null
    });
    const db = makeDb(state);

    const loaded = await requireAttempt(db as never, "student-1", "attempt-legacy");
    expect(loaded.assessment.id).toBe("assessment-1");
    expect(loaded.attempt.assignment_id).toBeNull();
  });
});

describe("attempt start precedence", () => {
  it("returns existing draft and backfills missing due snapshot", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-draft",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "draft",
      created_at: "2026-04-30T10:00:00.000Z",
      updated_at: "2026-04-30T10:00:00.000Z",
      due_at_snapshot: null
    });
    const db = makeDb(state);

    const started = await startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1");
    expect(started.attemptId).toBe("attempt-draft");
    expect(state.attempts.find((row) => row.id === "attempt-draft")?.due_at_snapshot).toBe("2026-05-01T12:00:00.000Z");
  });

  it("loads existing drafts when submitted_after_due is not available yet", async () => {
    const state = makeState();
    state.forceMissingSubmittedAfterDueOnAttemptSelect = true;
    state.attempts.push({
      id: "attempt-draft",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "draft",
      created_at: "2026-04-30T10:00:00.000Z",
      updated_at: "2026-04-30T10:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    const db = makeDb(state);

    const started = await startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1");

    expect(started.attemptId).toBe("attempt-draft");
    expect(state.attempts.filter((row) => row.assignment_id === "assignment-1" && row.status === "draft")).toHaveLength(1);
  });

  it("requires the lifecycle migration when due_at_snapshot is missing", async () => {
    const state = makeState();
    state.forceMissingDueAtSnapshotOnAttemptSelect = true;
    const db = makeDb(state);

    await expect(startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1")).rejects.toMatchObject({
      status: 409,
      message: "Attempt lifecycle requires a database update before submissions can run.",
      code: "attempt_lifecycle_migration_required"
    });
  });

  it("blocks when a published final grade exists, including missing-only finals", async () => {
    const state = makeState();
    state.gradebook_entries.push({
      id: "entry-1",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: null,
      approved_score: null,
      teacher_override_score: null,
      missing: true,
      published_at: "2026-04-30T09:00:00.000Z"
    });
    const db = makeDb(state);

    await expect(startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1")).rejects.toMatchObject({
      status: 409,
      code: "final_published",
      details: { assignmentId: "assignment-1", attemptId: null }
    });
  });

  it("creates a new retry draft even when submitted/graded attempts already exist", async () => {
    const state = makeState();
    state.attempts.push(
      {
        id: "attempt-submitted-old",
        assignment_id: "assignment-1",
        assessment_id: "assessment-1",
        student_id: "student-1",
        status: "submitted",
        created_at: "2026-04-29T10:00:00.000Z",
        updated_at: "2026-04-29T10:00:00.000Z",
        due_at_snapshot: "2026-05-01T12:00:00.000Z"
      },
      {
        id: "attempt-graded-new",
        assignment_id: "assignment-1",
        assessment_id: "assessment-1",
        student_id: "student-1",
        status: "graded",
        created_at: "2026-04-30T10:00:00.000Z",
        updated_at: "2026-04-30T10:00:00.000Z",
        due_at_snapshot: "2026-05-01T12:00:00.000Z"
      }
    );
    const db = makeDb(state);

    const started = await startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1");
    expect(started.attemptId).not.toBe("attempt-submitted-old");
    expect(started.attemptId).not.toBe("attempt-graded-new");
    expect(state.attempts.filter((row) => row.assignment_id === "assignment-1" && row.status === "draft")).toHaveLength(1);
  });

  it("creates a retry draft when the latest attempt is error and no submitted/graded/final exists", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-error",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "error",
      created_at: "2026-04-30T11:00:00.000Z",
      updated_at: "2026-04-30T11:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    const db = makeDb(state);

    const started = await startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1");
    expect(started.attemptId).not.toBe("attempt-error");
    expect(state.attempts.filter((row) => row.assignment_id === "assignment-1" && row.status === "draft")).toHaveLength(1);
  });

  it("returns existing draft after unique-conflict race on draft insert", async () => {
    const state = makeState();
    state.forceNextDraftInsertConflict = true;
    state.attempts.push({
      id: "attempt-race",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "draft",
      created_at: "2026-04-30T12:00:00.000Z",
      updated_at: "2026-04-30T12:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    const db = makeDb(state);

    const started = await startAttempt(jsonRequest({ assignmentId: "assignment-1" }), db as never, "student-1");
    expect(started.attemptId).toBe("attempt-race");
    expect(state.attempts.filter((row) => row.assignment_id === "assignment-1" && row.status === "draft")).toHaveLength(1);
  });
});

describe("attempt result lifecycle projection", () => {
  it("returns published approved-ai grade summary and re-signed simulation preview metadata", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-1",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "submitted",
      transcript: null,
      ocr_text: null,
      simulation_description: "Sim output",
      simulation_spec: null,
      provisional_score: 84,
      provisional_feedback: null,
      submitted_at: "2026-04-30T11:00:00.000Z",
      created_at: "2026-04-30T11:00:00.000Z",
      updated_at: "2026-04-30T11:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    state.gradebook_entries.push({
      id: "entry-1",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: "attempt-1",
      approved_score: 91,
      approved_feedback: {
        score: 91,
        overallComment: "Solid explanation",
        criteria: [],
        confidence: "high",
        reviewFlags: []
      },
      teacher_override_score: null,
      missing: false,
      published_at: "2026-04-30T12:00:00.000Z"
    });
    state.attempt_artifacts.push({
      id: "artifact-sim",
      attempt_id: "attempt-1",
      student_id: "student-1",
      kind: "simulation-derived",
      upload_state: "uploaded",
      original_filename: "simulation.html",
      simulation_html_viewport_width: SIMULATION_HTML_VIEWPORT.width,
      simulation_html_viewport_height: SIMULATION_HTML_VIEWPORT.height,
      created_at: "2026-04-30T11:05:00.000Z"
    });
    state.simulation_generation_jobs.push({
      id: "job-sim",
      attempt_id: "attempt-1",
      student_id: "student-1",
      result_artifact_id: "artifact-sim",
      reasoning_effort: "low",
      completed_at: "2026-04-30T11:06:00.000Z",
      created_at: "2026-04-30T11:04:00.000Z"
    });
    const db = makeDb(state);

    const result = await attemptResult(db as never, { PIN_PEPPER: "pepper" } as never, "student-1", "attempt-1");

    expect(result.publishedGrade).toEqual(expect.objectContaining({
      finalScore: 91,
      finalStatus: "approved_ai",
      publishedAt: "2026-04-30T12:00:00.000Z"
    }));
    expect(result.publishedGrade?.feedback).toEqual(expect.objectContaining({ score: 91 }));
    expect(result.simulationPreview).toEqual(expect.objectContaining({
      artifactId: "artifact-sim",
      previewPath: "/artifacts/artifact-sim/preview",
      outputKind: "html",
      generationSource: "model",
      htmlReasoningEffort: "low",
      htmlViewport: SIMULATION_HTML_VIEWPORT
    }));
    expect(typeof result.simulationPreview?.previewToken).toBe("string");
    expect(result.simulationPreview?.previewToken.length).toBeGreaterThan(10);
  });

  it("marks restored fallback simulation previews as structured fallback", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-fallback",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "submitted",
      transcript: null,
      ocr_text: null,
      simulation_description: "Fallback sim output",
      simulation_spec: null,
      provisional_score: null,
      provisional_feedback: null,
      submitted_at: "2026-04-30T11:00:00.000Z",
      created_at: "2026-04-30T11:00:00.000Z",
      updated_at: "2026-04-30T11:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    state.attempt_artifacts.push({
      id: "artifact-fallback",
      attempt_id: "attempt-fallback",
      student_id: "student-1",
      kind: "simulation-derived",
      upload_state: "uploaded",
      original_filename: "simulation-fallback.html",
      created_at: "2026-04-30T11:05:00.000Z"
    });

    const result = await attemptResult(makeDb(state) as never, { PIN_PEPPER: "pepper" } as never, "student-1", "attempt-fallback");

    expect(result.simulationPreview).toEqual(expect.objectContaining({
      artifactId: "artifact-fallback",
      outputKind: "html",
      generationSource: "structured_fallback",
      htmlViewport: LEGACY_SIMULATION_HTML_VIEWPORT
    }));
  });

  it("ignores historical blank published grade rows", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-blank",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "submitted",
      transcript: null,
      ocr_text: null,
      simulation_description: null,
      simulation_spec: null,
      provisional_score: null,
      provisional_feedback: null,
      submitted_at: "2026-04-30T11:00:00.000Z",
      created_at: "2026-04-30T11:00:00.000Z",
      updated_at: "2026-04-30T11:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    state.gradebook_entries.push({
      id: "entry-blank",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: null,
      approved_score: null,
      approved_feedback: null,
      teacher_override_score: null,
      missing: false,
      published_at: "2026-04-30T12:00:00.000Z"
    });
    const db = makeDb(state);

    const result = await attemptResult(db as never, { PIN_PEPPER: "pepper" } as never, "student-1", "attempt-blank");
    expect(result.publishedGrade).toBeNull();
  });

  it("drops malformed feedback payloads from result contracts", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-malformed",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "submitted",
      transcript: null,
      ocr_text: null,
      simulation_description: null,
      simulation_spec: null,
      provisional_score: 72,
      provisional_feedback: { score: 72, criteria: "bad-shape" },
      submitted_at: "2026-04-30T11:00:00.000Z",
      created_at: "2026-04-30T11:00:00.000Z",
      updated_at: "2026-04-30T11:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    state.gradebook_entries.push({
      id: "entry-malformed",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: "attempt-malformed",
      approved_score: 72,
      approved_feedback: { overallComment: 42 },
      teacher_override_score: null,
      missing: false,
      published_at: "2026-04-30T12:00:00.000Z"
    });
    const db = makeDb(state);

    const result = await attemptResult(db as never, { PIN_PEPPER: "pepper" } as never, "student-1", "attempt-malformed");
    expect(result.provisionalFeedback).toBeNull();
    expect(result.publishedGrade?.finalStatus).toBe("approved_ai");
    expect(result.publishedGrade?.feedback).toBeNull();
  });
});

describe("published final result route", () => {
  it("returns approved-ai finals with latest attempt context", async () => {
    const state = makeState();
    state.attempts.push({
      id: "attempt-final",
      assignment_id: "assignment-1",
      assessment_id: "assessment-1",
      student_id: "student-1",
      status: "graded",
      provisional_score: 91,
      submitted_at: "2026-04-30T11:00:00.000Z",
      submitted_after_due: false,
      created_at: "2026-04-30T11:00:00.000Z",
      updated_at: "2026-04-30T11:00:00.000Z",
      due_at_snapshot: "2026-05-01T12:00:00.000Z"
    });
    state.gradebook_entries.push({
      id: "entry-final",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: "attempt-final",
      approved_score: 91,
      approved_feedback: { score: 91, overallComment: "Solid", criteria: [], confidence: "high", reviewFlags: [] },
      teacher_override_score: null,
      missing: false,
      published_at: "2026-04-30T12:00:00.000Z"
    });
    const db = makeDb(state);

    const result = await publishedFinalResult(db as never, "student-1", "assignment-1");

    expect(result.assignmentId).toBe("assignment-1");
    expect(result.publishedGrade).toEqual(expect.objectContaining({
      finalStatus: "approved_ai",
      finalScore: 91
    }));
    expect(result.latestAttempt).toEqual(expect.objectContaining({
      attemptId: "attempt-final",
      status: "graded"
    }));
    expect(JSON.stringify(result)).not.toContain("approved_attempt_id");
    expect(JSON.stringify(result)).not.toContain("entry-final");
  });

  it("returns missing finals even when no attempt exists", async () => {
    const state = makeState();
    state.gradebook_entries.push({
      id: "entry-missing",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: null,
      approved_score: null,
      approved_feedback: null,
      teacher_override_score: null,
      missing: true,
      published_at: "2026-04-30T12:00:00.000Z"
    });
    const db = makeDb(state);

    const result = await publishedFinalResult(db as never, "student-1", "assignment-1");

    expect(result.publishedGrade).toEqual({
      finalScore: null,
      finalStatus: "missing",
      publishedAt: "2026-04-30T12:00:00.000Z"
    });
    expect(result.latestAttempt).toBeNull();
  });

  it("returns teacher override finals without exposing gradebook internals", async () => {
    const state = makeState();
    state.gradebook_entries.push({
      id: "entry-override",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: null,
      approved_score: null,
      approved_feedback: null,
      teacher_override_score: 87,
      missing: false,
      published_at: "2026-04-30T12:00:00.000Z"
    });
    const db = makeDb(state);

    const result = await publishedFinalResult(db as never, "student-1", "assignment-1");

    expect(result.publishedGrade).toEqual({
      finalScore: 87,
      finalStatus: "teacher_override",
      publishedAt: "2026-04-30T12:00:00.000Z"
    });
    expect(JSON.stringify(result)).not.toContain("teacher_override_score");
  });

  it("rejects unpublished or unassigned final result requests", async () => {
    const unpublished = makeState();
    unpublished.gradebook_entries.push({
      id: "entry-unpublished",
      assignment_id: "assignment-1",
      roster_student_id: "roster-1",
      approved_attempt_id: null,
      approved_score: 80,
      approved_feedback: null,
      teacher_override_score: null,
      missing: false,
      published_at: null
    });
    await expect(publishedFinalResult(makeDb(unpublished) as never, "student-1", "assignment-1")).rejects.toMatchObject({
      status: 404,
      message: "Published final grade not found"
    });

    const unassigned = makeState();
    unassigned.class_memberships = [];
    await expect(publishedFinalResult(makeDb(unassigned) as never, "student-1", "assignment-1")).rejects.toMatchObject({
      status: 403,
      message: "No class membership found for student"
    });
  });
});

type Row = Record<string, any>;

interface State {
  class_memberships: Row[];
  assessment_assignments: Row[];
  assessments: Row[];
  classes: Row[];
  attempts: Row[];
  attempt_artifacts: Row[];
  simulation_generation_jobs: Row[];
  gradebook_entries: Row[];
  roster_students: Row[];
  forceNextDraftInsertConflict?: boolean;
  forceMissingSubmittedAfterDueOnAttemptSelect?: boolean;
  forceMissingDueAtSnapshotOnAttemptSelect?: boolean;
}

type StateTable = keyof Omit<
  State,
  "forceNextDraftInsertConflict" | "forceMissingSubmittedAfterDueOnAttemptSelect" | "forceMissingDueAtSnapshotOnAttemptSelect"
>;

function makeState(): State {
  return {
    class_memberships: [
      { class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" },
      { class_id: "class-2", student_id: "student-1", roster_student_id: "roster-2" }
    ],
    assessments: [
      {
        id: "assessment-1",
        type: "voice",
        title: "Voice assessment",
        prompt: "Explain the concept.",
        expected_answer: null,
        rubric: [],
        config: {}
      }
    ],
    classes: [
      { id: "class-1", code: "BIO101", name: "Biology" },
      { id: "class-2", code: "BIO102", name: "Biology 2" }
    ],
    assessment_assignments: [
      { id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", opens_at: null, due_at: "2026-05-01T12:00:00.000Z", archived_at: null },
      { id: "assignment-2", class_id: "class-2", assessment_id: "assessment-1", opens_at: null, due_at: "2026-05-15T12:00:00.000Z", archived_at: null }
    ],
    attempts: [],
    attempt_artifacts: [],
    simulation_generation_jobs: [],
    gradebook_entries: [],
    roster_students: [
      { id: "roster-1", class_id: "class-1", claimed_by: "student-1" },
      { id: "roster-2", class_id: "class-2", claimed_by: "student-1" }
    ]
  };
}

function makeDb(state: State) {
  return {
    from(table: string) {
      return new Query(state, table as StateTable);
    }
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private inFilters: Array<(row: Row) => boolean> = [];
  private orderKeys: Array<{ key: string; ascending: boolean }> = [];
  private pendingInsert: Row | null = null;
  private pendingUpdate: Row | null = null;
  private selected = "";
  private limitValue: number | null = null;

  constructor(private state: State, private table: StateTable) {}

  select(columns = "") {
    this.selected = columns;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }

  in(key: string, values: unknown[]) {
    this.inFilters.push((row) => values.includes(row[key]));
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderKeys.push({ key, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitValue = count;
    return this;
  }

  insert(payload: Row) {
    this.pendingInsert = { ...payload };
    return this;
  }

  update(payload: Row) {
    this.pendingUpdate = { ...payload };
    return this;
  }

  async single() {
    const inserted = this.commitInsert();
    if (inserted.error) return { data: null, error: inserted.error };
    if (inserted.data) return { data: this.decorate(inserted.data), error: null };

    const matched = this.applyOrder(this.matchRows(this.tableData()));
    if (matched.length === 0) return { data: null, error: null };
    this.applyUpdate(matched);
    return { data: this.decorate(matched[0]), error: null };
  }

  async maybeSingle() {
    const inserted = this.commitInsert();
    if (inserted.error) return { data: null, error: inserted.error };
    if (inserted.data) return { data: this.decorate(inserted.data), error: null };

    const matched = this.applyOrder(this.matchRows(this.tableData()));
    if (matched.length === 0) return { data: null, error: null };
    this.applyUpdate(matched);
    return { data: this.decorate(matched[0]), error: null };
  }

  then(resolve: (value: { data: unknown; error: Row | null }) => void) {
    const inserted = this.commitInsert();
    if (inserted.error) {
      resolve({ data: null, error: inserted.error });
      return;
    }
    if (inserted.data) {
      resolve({ data: [this.decorate(inserted.data)], error: null });
      return;
    }

    const selectError = this.selectSchemaError();
    if (selectError) {
      resolve({ data: null, error: selectError });
      return;
    }

    const matched = this.applyOrder(this.matchRows(this.tableData()));
    this.applyUpdate(matched);
    resolve({ data: matched.map((row) => this.decorate(row)), error: null });
  }

  private commitInsert(): { data: Row | null; error: Row | null } {
    if (!this.pendingInsert) return { data: null, error: null };
    const payload = { ...this.pendingInsert };
    this.pendingInsert = null;

    if (this.table === "attempts") {
      const hasDraftConflict = payload.status === "draft"
        && typeof payload.assignment_id === "string"
        && this.state.attempts.some((row) =>
          row.status === "draft"
          && row.assignment_id === payload.assignment_id
          && row.student_id === payload.student_id
        );

      if (this.state.forceNextDraftInsertConflict || hasDraftConflict) {
        this.state.forceNextDraftInsertConflict = false;
        return {
          data: null,
          error: {
            code: "23505",
            message: "duplicate key value violates unique constraint idx_attempts_unique_student_assignment_draft"
          }
        };
      }
    }

    const now = "2026-04-30T00:00:00.000Z";
    const inserted = {
      id: payload.id ?? `${this.table}-${this.tableData().length + 1}`,
      created_at: payload.created_at ?? now,
      updated_at: payload.updated_at ?? now,
      ...payload
    };
    this.tableData().push(inserted);
    return { data: inserted, error: null };
  }

  private selectSchemaError(): Row | null {
    if (this.table !== "attempts") return null;
    if (this.state.forceMissingDueAtSnapshotOnAttemptSelect && this.selected.includes("due_at_snapshot")) {
      return {
        code: "PGRST204",
        message: "Could not find the 'due_at_snapshot' column of 'attempts' in the schema cache"
      };
    }
    if (this.state.forceMissingSubmittedAfterDueOnAttemptSelect && this.selected.includes("submitted_after_due")) {
      return {
        code: "PGRST204",
        message: "Could not find the 'submitted_after_due' column of 'attempts' in the schema cache"
      };
    }
    return null;
  }

  private applyUpdate(rows: Row[]) {
    if (!this.pendingUpdate) return;
    for (const row of rows) {
      Object.assign(row, this.pendingUpdate);
    }
    this.pendingUpdate = null;
  }

  private decorate(row: Row) {
    if (this.table === "assessment_assignments") {
      const assessment = this.state.assessments.find((item) => item.id === row.assessment_id) ?? null;
      const course = this.state.classes.find((item) => item.id === row.class_id) ?? null;
      return {
        ...row,
        assessments: assessment,
        classes: course ? { code: course.code, name: course.name } : null
      };
    }

    if (this.table === "attempts") {
      const directAssessment = this.state.assessments.find((item) => item.id === row.assessment_id) ?? null;
      const assignment = row.assignment_id
        ? this.state.assessment_assignments.find((item) => item.id === row.assignment_id) ?? null
        : null;
      const assignmentAssessment = assignment
        ? this.state.assessments.find((item) => item.id === assignment.assessment_id) ?? null
        : null;
      const course = assignment
        ? this.state.classes.find((item) => item.id === assignment.class_id) ?? null
        : null;
      return {
        ...row,
        assessments: directAssessment,
        assessment_assignments: assignment
          ? {
              ...assignment,
              assessments: assignmentAssessment,
              classes: course ? { code: course.code, name: course.name } : null
            }
          : null
      };
    }

    return row;
  }

  private applyOrder(rows: Row[]) {
    const limit = this.limitValue;
    if (this.orderKeys.length === 0) {
      return limit !== null && Number.isFinite(limit) ? rows.slice(0, limit) : rows;
    }
    const sorted = [...rows];
    sorted.sort((left, right) => {
      for (const key of this.orderKeys) {
        const leftValue = left[key.key];
        const rightValue = right[key.key];
        const compared = compareValues(leftValue, rightValue);
        if (compared !== 0) return key.ascending ? compared : -compared;
      }
      return 0;
    });
    if (limit !== null && Number.isFinite(limit)) {
      return sorted.slice(0, limit);
    }
    return sorted;
  }

  private matchRows(rows: Row[]) {
    return rows.filter((row) =>
      this.filters.every((check) => check(row))
      && this.inFilters.every((check) => check(row))
    );
  }

  private tableData(): Row[] {
    return this.state[this.table];
  }
}

function compareValues(left: unknown, right: unknown): number {
  const leftText = left === null || left === undefined ? "" : String(left);
  const rightText = right === null || right === undefined ? "" : String(right);
  return leftText.localeCompare(rightText);
}

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/attempts/start", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
}
