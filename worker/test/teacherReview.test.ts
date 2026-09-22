import { reconcileFixture } from "./helpers/rpcFixtures";
import { describe, expect, it } from "vitest";
import { SIMULATION_HTML_VIEWPORT } from "@alt-assessment/shared";
import type { Env } from "../src/lib/env";
import { downloadTeacherArtifact, listTeacherAttempts, previewTeacherArtifact, teacherAttemptDetail } from "../src/routes/teacherReview";

type Row = Record<string, any>;

interface State {
  profiles: Row[];
  classes: Row[];
  assessments: Row[];
  assessment_assignments: Row[];
  roster_students: Row[];
  class_memberships: Row[];
  gradebook_entries: Row[];
  attempts: Row[];
  attempt_artifacts: Row[];
  attempt_realtime_sessions: Row[];
  attempt_realtime_events: Row[];
}

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OPENAI_API_KEY: "openai-key",
  PIN_PEPPER: "dev-pepper",
  ALLOWED_ORIGINS: "https://app.test"
};

describe("teacher review routes", () => {
  it("rejects unsupported status filters", async () => {
    const db = createDb(createState());
    const request = new Request("https://worker.test/api/teacher/attempts?status=finalized");
    await expect(listTeacherAttempts(request, db as never, "teacher-1")).rejects.toMatchObject({
      status: 400,
      message: "status must be one of: draft, submitted, graded, error"
    });
  });

  it("lists only owned attempts and supports status/student filters", async () => {
    const db = createDb(createState());
    const request = new Request("https://worker.test/api/teacher/attempts?status=graded&student=roster");
    const result = await listTeacherAttempts(request, db as never, "teacher-1");

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      attemptId: "attempt-owned",
      status: "graded",
      student: { displayName: "Roster Student" },
      course: { code: "BIO101" }
    });
    expect(result.attempts[0].reviewFlags).toEqual(["needs-human-check"]);
  });

  it("adds late review flag when an attempt was submitted after due", async () => {
    const db = createDb(createState());
    const request = new Request("https://worker.test/api/teacher/attempts?status=submitted&student=roster");
    const result = await listTeacherAttempts(request, db as never, "teacher-1");

    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      attemptId: "attempt-late",
      status: "submitted"
    });
    expect(result.attempts[0].reviewFlags).toEqual(["late"]);
  });

  it("rejects list filters for another teacher's course", async () => {
    const db = createDb(createState());
    const request = new Request("https://worker.test/api/teacher/attempts?courseId=class-foreign");
    await expect(listTeacherAttempts(request, db as never, "teacher-1")).rejects.toMatchObject({
      status: 403,
      message: "Teacher does not own this course"
    });
  });

  it("returns attempt detail with mediated artifact paths", async () => {
    const db = createDb(createState());
    const detail = await teacherAttemptDetail(db as never, "teacher-1", "attempt-owned");

    expect(detail.attempt.assessment.title).toBe("Voice Check");
    expect(detail.attempt.transcript).toContain("sample transcript");
    expect(detail.attempt.reviewFlags).toEqual(["needs-human-check"]);
    expect(detail.attempt.gradebookEntry?.finalStatus).toBe("approved_ai");
    expect(detail.attempt.artifacts[0]).toMatchObject({
      id: "artifact-owned",
      previewPath: "/teacher/artifacts/artifact-owned/preview",
      downloadPath: "/teacher/artifacts/artifact-owned/download",
      htmlViewport: SIMULATION_HTML_VIEWPORT
    });
  });

  it("includes late review flag in attempt detail when submitted after due", async () => {
    const db = createDb(createState());
    const detail = await teacherAttemptDetail(db as never, "teacher-1", "attempt-late");
    expect(detail.attempt.reviewFlags).toEqual(["late"]);
  });

  it("includes realtime trust score and session history in attempt detail", async () => {
    const state = createState();
    state.attempt_realtime_events.push(
      {
        id: "event-1",
        session_id: "session-owned",
        attempt_id: "attempt-owned",
        sequence: 0,
        event_type: "conversation.item.input_audio_transcription.completed",
        role: "student",
        text: "The cell absorbs water.",
        metadata: {},
        created_at: "2026-04-20T10:00:10.000Z"
      },
      {
        id: "event-2",
        session_id: "session-owned",
        attempt_id: "attempt-owned",
        sequence: 1,
        event_type: "response.audio_transcript.done",
        role: "assistant",
        text: "Explain why that happens.",
        metadata: {},
        created_at: "2026-04-20T10:00:15.000Z"
      }
    );
    const db = createDb(state);
    const detail = await teacherAttemptDetail(db as never, "teacher-1", "attempt-owned");

    expect(detail.attempt.realtimeTrust).toEqual(expect.objectContaining({
      level: "high"
    }));
    expect(detail.attempt.realtimeTrust?.history).toHaveLength(1);
    expect(detail.attempt.realtimeTrust?.history[0]).toEqual(expect.objectContaining({
      sessionId: "session-owned",
      eventCount: 2,
      studentTurnCount: 1,
      assistantTurnCount: 1
    }));
  });

  it("rejects cross-teacher attempt detail access", async () => {
    const db = createDb(createState());

    await expect(teacherAttemptDetail(db as never, "teacher-1", "attempt-foreign")).rejects.toMatchObject({
      status: 403,
      message: "Teacher does not own this assignment"
    });
  });

  it("mediates teacher artifact preview through ownership checks", async () => {
    const db = createDb(createState());
    const ownRequest = new Request("https://worker.test/api/teacher/artifacts/artifact-owned/preview", {
      headers: { Origin: "https://app.test" }
    });
    const ownResponse = await previewTeacherArtifact(ownRequest, env, db as never, "teacher-1", "artifact-owned");
    expect(ownResponse.status).toBe(200);
    expect(ownResponse.headers.get("Content-Type")).toContain("text/html");
    await expect(ownResponse.text()).resolves.toContain("teacher-preview-ok");

    const foreignRequest = new Request("https://worker.test/api/teacher/artifacts/artifact-foreign/preview", {
      headers: { Origin: "https://app.test" }
    });
    await expect(previewTeacherArtifact(foreignRequest, env, db as never, "teacher-1", "artifact-foreign")).rejects.toMatchObject({
      status: 403,
      message: "Teacher does not own this assignment"
    });
  });

  it("mediates teacher artifact download and returns attachment headers", async () => {
    const db = createDb(createState());
    const ownRequest = new Request("https://worker.test/api/teacher/artifacts/artifact-owned/download", {
      headers: { Origin: "https://app.test" }
    });
    const ownResponse = await downloadTeacherArtifact(ownRequest, env, db as never, "teacher-1", "artifact-owned");
    expect(ownResponse.status).toBe(200);
    expect(ownResponse.headers.get("Content-Disposition")).toContain("attachment;");
    await expect(ownResponse.text()).resolves.toContain("teacher-preview-ok");

    const foreignRequest = new Request("https://worker.test/api/teacher/artifacts/artifact-foreign/download", {
      headers: { Origin: "https://app.test" }
    });
    await expect(downloadTeacherArtifact(foreignRequest, env, db as never, "teacher-1", "artifact-foreign")).rejects.toMatchObject({
      status: 403,
      message: "Teacher does not own this assignment"
    });
  });
});

function createState(): State {
  return {
    profiles: [
      { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
      { id: "teacher-2", role: "teacher", display_name: "Teacher Two" },
      { id: "student-1", role: "student", display_name: "Roster Student" }
    ],
    classes: [
      { id: "class-owned", code: "BIO101", name: "Biology", teacher_id: "teacher-1" },
      { id: "class-foreign", code: "CHEM101", name: "Chemistry", teacher_id: "teacher-2" }
    ],
    assessments: [
      {
        id: "assessment-1",
        type: "voice",
        title: "Voice Check",
        prompt: "Prompt",
        expected_answer: null,
        rubric: [{ name: "Accuracy", description: "Correctness", maxPoints: 5 }],
        config: {}
      }
    ],
    assessment_assignments: [
      {
        id: "assignment-owned",
        class_id: "class-owned",
        assessment_id: "assessment-1",
        opens_at: null,
        due_at: null
      },
      {
        id: "assignment-foreign",
        class_id: "class-foreign",
        assessment_id: "assessment-1",
        opens_at: null,
        due_at: null
      }
    ],
    roster_students: [
      {
        id: "roster-1",
        class_id: "class-owned",
        display_name: "Roster Student",
        student_identifier: "S-100",
        email: null,
        section: null,
        claimed_by: "student-1",
        deactivated_at: null
      }
    ],
    class_memberships: [
      {
        class_id: "class-owned",
        student_id: "student-1",
        roster_student_id: "roster-1"
      }
    ],
    gradebook_entries: [
      {
        id: "gb-1",
        assignment_id: "assignment-owned",
        roster_student_id: "roster-1",
        approved_attempt_id: "attempt-owned",
        approved_score: 92,
        approved_feedback: null,
        teacher_override_score: null,
        teacher_override_note: null,
        missing: false,
        published_at: null,
        created_at: "2026-04-21T10:00:00.000Z",
        updated_at: "2026-04-21T10:00:00.000Z"
      }
    ],
    attempts: [
      {
        id: "attempt-owned",
        assignment_id: "assignment-owned",
        student_id: "student-1",
        status: "graded",
        submitted_after_due: false,
        provisional_score: 92,
        provisional_feedback: {
          score: 92,
          overallComment: "Strong work",
          criteria: [],
          confidence: "medium",
          reviewFlags: ["needs-human-check"]
        },
        transcript: "sample transcript",
        ocr_text: null,
        simulation_description: null,
        simulation_spec: null,
        submitted_at: "2026-04-20T10:00:00.000Z",
        created_at: "2026-04-20T09:59:00.000Z"
      },
      {
        id: "attempt-late",
        assignment_id: "assignment-owned",
        student_id: "student-1",
        status: "submitted",
        submitted_after_due: true,
        provisional_score: null,
        provisional_feedback: null,
        transcript: null,
        ocr_text: null,
        simulation_description: null,
        simulation_spec: null,
        submitted_at: "2026-04-20T11:00:00.000Z",
        created_at: "2026-04-20T10:59:00.000Z"
      },
      {
        id: "attempt-foreign",
        assignment_id: "assignment-foreign",
        student_id: "student-1",
        status: "submitted",
        submitted_after_due: false,
        provisional_score: null,
        provisional_feedback: null,
        transcript: null,
        ocr_text: null,
        simulation_description: null,
        simulation_spec: null,
        submitted_at: "2026-04-21T10:00:00.000Z",
        created_at: "2026-04-21T09:59:00.000Z"
      }
    ],
    attempt_artifacts: [
      {
        id: "artifact-owned",
        attempt_id: "attempt-owned",
        kind: "simulation-derived",
        bucket: "simulation-derived",
        storage_key: "simulation-derived/student-1/attempt-owned/sim.html",
        mime_type: "text/html; charset=utf-8",
        byte_size: 120,
        original_filename: "simulation.html",
        upload_state: "uploaded", frozen_at: "2026-05-01T12:00:00.000Z",
        simulation_html_viewport_width: SIMULATION_HTML_VIEWPORT.width,
        simulation_html_viewport_height: SIMULATION_HTML_VIEWPORT.height
      },
      {
        id: "artifact-foreign",
        attempt_id: "attempt-foreign",
        kind: "writing",
        bucket: "writing",
        storage_key: "writing/student-1/attempt-foreign/file.png",
        mime_type: "image/png",
        byte_size: 90,
        original_filename: "work.png",
        upload_state: "uploaded"
      }
    ],
    attempt_realtime_sessions: [
      {
        id: "session-owned",
        attempt_id: "attempt-owned",
        status: "finalized",
        started_at: "2026-04-20T10:00:00.000Z",
        ended_at: "2026-04-20T10:02:00.000Z",
        expires_at: "2026-04-20T10:10:00.000Z",
        continuity_diagnostics: {
          gapCount: 0,
          duplicateCount: 0,
          flags: []
        },
        finalized_at: "2026-04-20T10:02:01.000Z",
        finalize_error: null
      }
    ],
    attempt_realtime_events: []
  };
}

function createDb(state: State) {
  return {
    async rpc(_name: string, args: Record<string, any>) { return reconcileFixture(state, args); },
    storage: {
      from(bucket: string) {
        return {
          async download(storageKey: string) {
            return {
              error: null,
              data: new Blob([`teacher-preview-ok:${bucket}:${storageKey}`], { type: "text/plain" })
            };
          }
        };
      }
    },
    from(table: keyof State) {
      return new Query(table, state);
    }
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private inFilters: Array<(row: Row) => boolean> = [];
  private isFilters: Array<(row: Row) => boolean> = [];
  private pageFrom = 0;
  private pageTo = Infinity;
  range(from: number, to: number) { this.pageFrom = from; this.pageTo = to; return this; }
  private orderKey = "";
  private orderAscending = true;

  constructor(private table: keyof State, private state: State) {}

  select(_columns = "") {
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

  is(key: string, value: unknown) {
    this.isFilters.push((row) => row[key] === value);
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderKey = key;
    this.orderAscending = options?.ascending !== false;
    return this;
  }

  async maybeSingle() {
    const match = this.matchRows(this.tableData())[0];
    return { data: match ? this.decorate(match) : null, error: null };
  }

  then(resolve: (value: { data: unknown[]; error: null }) => void) {
    const rows = this.applyOrder(this.matchRows(this.tableData())).map((row) => this.decorate(row));
    resolve({ data: rows.slice(this.pageFrom, this.pageTo + 1), error: null });
  }

  private decorate(row: Row): Row {
    if (this.table === "attempts") {
      const assignment = this.state.assessment_assignments.find((a) => a.id === row.assignment_id);
      const assessment = this.state.assessments.find((a) => a.id === assignment?.assessment_id);
      return { ...row, assessment_versions: { definition: structuredClone(assessment), legacy_capture: false } };
    }
    if (this.table === "assessment_assignments") {
      const course = this.state.classes.find((item) => item.id === row.class_id) ?? null;
      const assessment = this.state.assessments.find((item) => item.id === row.assessment_id) ?? null;
      return {
        ...row,
        classes: course ? { id: course.id, code: course.code, name: course.name, teacher_id: course.teacher_id } : null,
        assessments: assessment ?? null
      };
    }
    return row;
  }

  private applyOrder(rows: Row[]): Row[] {
    if (!this.orderKey) return rows;
    const sorted = [...rows].sort((left, right) => {
      const a = String(left[this.orderKey] ?? "");
      const b = String(right[this.orderKey] ?? "");
      return a.localeCompare(b);
    });
    return this.orderAscending ? sorted : sorted.reverse();
  }

  private matchRows(rows: Row[]): Row[] {
    return rows.filter((row) =>
      this.filters.every((check) => check(row))
      && this.inFilters.every((check) => check(row))
      && this.isFilters.every((check) => check(row))
    );
  }

  private tableData(): Row[] {
    return this.state[this.table];
  }
}
