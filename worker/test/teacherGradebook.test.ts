import { reconcileFixture } from "./helpers/rpcFixtures";
import { describe, expect, it } from "vitest";
import { createTeacherAssignment, setTeacherAssignmentArchived } from "../src/routes/teacherAssessments";
import {
  approveTeacherAttemptScore,
  clearTeacherGradebookGrade,
  exportTeacherGradebook,
  getTeacherGradebookEntryById,
  listTeacherGradebook,
  markTeacherGradebookMissing,
  reconcileGradebookForCourse,
  setTeacherGradebookOverride,
  setTeacherGradebookPublished
} from "../src/routes/teacherGradebook";

type Row = Record<string, any>;

interface State {
  profiles: Row[];
  classes: Row[];
  assessments: Row[];
  assessment_assignments: Row[];
  roster_students: Row[];
  class_memberships: Row[];
  attempts: Row[];
  gradebook_entries: Row[];
  grade_exports: Row[];
}

describe("teacher gradebook reconciliation", () => {
  it("creates deterministic rows for active assignments x active roster and stays idempotent", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1" }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [
        { id: "assignment-a", class_id: "class-1", assessment_id: "assessment-1", archived_at: null },
        { id: "assignment-b", class_id: "class-1", assessment_id: "assessment-1", archived_at: null },
        { id: "assignment-archived", class_id: "class-1", assessment_id: "assessment-1", archived_at: "2026-04-01T00:00:00.000Z" }
      ],
      roster_students: [
        { id: "roster-1", class_id: "class-1", display_name: "A", claimed_by: null, deactivated_at: null },
        { id: "roster-2", class_id: "class-1", display_name: "B", claimed_by: null, deactivated_at: null },
        { id: "roster-inactive", class_id: "class-1", display_name: "C", claimed_by: null, deactivated_at: "2026-04-02T00:00:00.000Z" }
      ]
    });
    const db = createDb(state);

    const first = await reconcileGradebookForCourse(db as never, "teacher-1", "class-1");
    expect(first).toMatchObject({ insertedRows: 4, touchedAssignments: 2, touchedStudents: 2 });
    expect(state.gradebook_entries).toHaveLength(4);

    const second = await reconcileGradebookForCourse(db as never, "teacher-1", "class-1");
    expect(second.insertedRows).toBe(0);
    expect(state.gradebook_entries).toHaveLength(4);
  });

  it("triggers reconciliation when assignments are created and unarchived", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1", archived_at: null }],
      roster_students: [{ id: "roster-1", class_id: "class-1", display_name: "Student", claimed_by: null, deactivated_at: null }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", archived_at: "2026-04-01T00:00:00.000Z" }]
    });
    const db = createDb(state);

    await createTeacherAssignment(jsonRequest({ courseId: "class-1", assessmentId: "assessment-1" }), db as never, "teacher-1");
    expect(state.gradebook_entries.length).toBeGreaterThanOrEqual(1);

    await setTeacherAssignmentArchived(db as never, "teacher-1", "assignment-1", false);
    expect(state.gradebook_entries.some((row) => row.assignment_id === "assignment-1")).toBe(true);
  });
});

describe("teacher gradebook finalization", () => {
  it("keeps approved score stable after later attempts and respects precedence", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1" }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", archived_at: null }],
      roster_students: [{ id: "roster-1", class_id: "class-1", display_name: "Student", student_identifier: "S-1", email: null, section: null, claimed_by: "student-1", deactivated_at: null }],
      class_memberships: [{ class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" }],
      attempts: [{ id: "attempt-1", assignment_id: "assignment-1", student_id: "student-1", status: "graded", provisional_score: 88, provisional_feedback: { policyVersion: "rubric-v2" }, submitted_at: "2026-04-01T10:00:00.000Z", created_at: "2026-04-01T09:59:00.000Z" }]
    });
    const db = createDb(state);

    await reconcileGradebookForCourse(db as never, "teacher-1", "class-1");
    const approved = await approveTeacherAttemptScore(db as never, "teacher-1", "attempt-1");
    expect(approved.entry.finalStatus).toBe("approved_ai");
    expect(approved.entry.finalScore).toBe(88);

    state.attempts.push({
      id: "attempt-2",
      assignment_id: "assignment-1",
      student_id: "student-1",
      status: "graded",
      provisional_score: 99,
      provisional_feedback: { policyVersion: "rubric-v2" },
      submitted_at: "2026-04-02T10:00:00.000Z",
      created_at: "2026-04-02T09:59:00.000Z"
    });

    const entryAfterLaterAttempt = await getTeacherGradebookEntryById(db as never, "teacher-1", approved.entry.id);
    expect(entryAfterLaterAttempt.finalStatus).toBe("approved_ai");
    expect(entryAfterLaterAttempt.finalScore).toBe(88);
    expect(entryAfterLaterAttempt.latestAttempt?.attemptId).toBe("attempt-2");

    const overridden = await setTeacherGradebookOverride(jsonRequest({ score: 77, note: "Manual correction" }), db as never, "teacher-1", approved.entry.id);
    expect(overridden.entry.finalStatus).toBe("teacher_override");
    expect(overridden.entry.finalScore).toBe(77);

    const missing = await markTeacherGradebookMissing(db as never, "teacher-1", approved.entry.id);
    expect(missing.entry.finalStatus).toBe("missing");
    expect(missing.entry.finalScore).toBe(null);

    const cleared = await clearTeacherGradebookGrade(db as never, "teacher-1", approved.entry.id);
    expect(cleared.entry.finalStatus).toBe("blank");
    expect(cleared.entry.finalScore).toBe(null);

    await expect(
      setTeacherGradebookPublished(db as never, "teacher-1", approved.entry.id, true)
    ).rejects.toMatchObject({
      status: 409,
      code: "final_required"
    });

    const missingForPublish = await markTeacherGradebookMissing(db as never, "teacher-1", approved.entry.id);
    expect(missingForPublish.entry.finalStatus).toBe("missing");

    const published = await setTeacherGradebookPublished(db as never, "teacher-1", approved.entry.id, true);
    expect(typeof published.entry.publishedAt).toBe("string");

    await expect(
      clearTeacherGradebookGrade(db as never, "teacher-1", approved.entry.id)
    ).rejects.toMatchObject({
      status: 409,
      message: "Unpublish the grade before clearing the final value"
    });

    const republished = await setTeacherGradebookPublished(db as never, "teacher-1", approved.entry.id, true);
    expect(republished.entry.publishedAt).toBe(published.entry.publishedAt);

    const unpublished = await setTeacherGradebookPublished(db as never, "teacher-1", approved.entry.id, false);
    expect(unpublished.entry.publishedAt).toBe(null);
  });

  it("prefers latest graded attempt over newer non-graded attempts in latestAttempt projection", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1" }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", archived_at: null }],
      roster_students: [{ id: "roster-1", class_id: "class-1", display_name: "Student", student_identifier: "S-1", email: null, section: null, claimed_by: "student-1", deactivated_at: null }],
      class_memberships: [{ class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" }],
      attempts: [
        {
          id: "attempt-graded",
          assignment_id: "assignment-1",
          student_id: "student-1",
          status: "graded",
          provisional_score: 86,
          provisional_feedback: { policyVersion: "rubric-v2" },
          submitted_at: "2026-04-01T10:00:00.000Z",
          created_at: "2026-04-01T09:59:00.000Z"
        },
        {
          id: "attempt-submitted-newer",
          assignment_id: "assignment-1",
          student_id: "student-1",
          status: "submitted",
          provisional_score: null,
          provisional_feedback: null,
          submitted_at: "2026-04-02T10:00:00.000Z",
          created_at: "2026-04-02T09:59:00.000Z"
        }
      ]
    });
    const db = createDb(state);

    await reconcileGradebookForCourse(db as never, "teacher-1", "class-1");
    const listed = await listTeacherGradebook(new Request("https://worker.test/api/teacher/gradebook?courseId=class-1"), db as never, "teacher-1");
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0].latestAttempt?.attemptId).toBe("attempt-graded");
    expect(listed.entries[0].latestAttempt?.status).toBe("graded");
  });

  it("hides archived assignments by default and enforces course ownership", async () => {
    const state = createState({
      classes: [
        { id: "class-owned", code: "BIO101", name: "Biology", teacher_id: "teacher-1" },
        { id: "class-foreign", code: "CHEM101", name: "Chemistry", teacher_id: "teacher-2" }
      ],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [
        { id: "assignment-open", class_id: "class-owned", assessment_id: "assessment-1", archived_at: null },
        { id: "assignment-archived", class_id: "class-owned", assessment_id: "assessment-1", archived_at: "2026-04-10T00:00:00.000Z" }
      ],
      roster_students: [{ id: "roster-1", class_id: "class-owned", display_name: "Student", claimed_by: null, deactivated_at: null }]
    });
    const db = createDb(state);

    await reconcileGradebookForCourse(db as never, "teacher-1", "class-owned");
    const archivedEntryId = state.gradebook_entries.find((row) => row.assignment_id === "assignment-open")?.id;
    if (!archivedEntryId) throw new Error("Expected gradebook entry to exist");

    state.gradebook_entries.push({
      id: "manual-archived",
      assignment_id: "assignment-archived",
      roster_student_id: "roster-1",
      approved_attempt_id: null,
      approved_score: null,
      approved_feedback: null,
      teacher_override_score: null,
      teacher_override_note: null,
      missing: false,
      published_at: null,
      created_at: "2026-04-11T00:00:00.000Z",
      updated_at: "2026-04-11T00:00:00.000Z"
    });

    const defaultList = await listTeacherGradebook(new Request("https://worker.test/api/teacher/gradebook?courseId=class-owned"), db as never, "teacher-1");
    expect(defaultList.entries.every((entry) => entry.assignment.archivedAt === null)).toBe(true);

    const withArchived = await listTeacherGradebook(
      new Request("https://worker.test/api/teacher/gradebook?courseId=class-owned&includeArchivedAssignments=true"),
      db as never,
      "teacher-1"
    );
    expect(withArchived.entries.some((entry) => entry.assignment.id === "assignment-archived")).toBe(true);

    await expect(
      listTeacherGradebook(new Request("https://worker.test/api/teacher/gradebook?courseId=class-foreign"), db as never, "teacher-1")
    ).rejects.toMatchObject({ status: 403, message: "Teacher does not own this course" });
  });

  it("rejects gradebook override for another teacher's entry", async () => {
    const state = createState({
      profiles: [
        { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
        { id: "teacher-2", role: "teacher", display_name: "Teacher Two" }
      ],
      classes: [
        { id: "class-owned", code: "BIO101", name: "Biology", teacher_id: "teacher-1" },
        { id: "class-foreign", code: "CHEM101", name: "Chemistry", teacher_id: "teacher-2" }
      ],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-2" }],
      assessment_assignments: [{ id: "assignment-foreign", class_id: "class-foreign", assessment_id: "assessment-1", archived_at: null }],
      roster_students: [{ id: "roster-foreign", class_id: "class-foreign", display_name: "Student", claimed_by: null, deactivated_at: null }],
      gradebook_entries: [{
        id: "entry-foreign",
        assignment_id: "assignment-foreign",
        roster_student_id: "roster-foreign",
        approved_attempt_id: null,
        approved_score: null,
        approved_feedback: null,
        teacher_override_score: null,
        teacher_override_note: null,
        missing: false,
        published_at: null,
        created_at: "2026-04-20T12:00:00.000Z",
        updated_at: "2026-04-20T12:00:00.000Z"
      }]
    });
    const db = createDb(state);

    await expect(
      setTeacherGradebookOverride(jsonRequest({ score: 80, note: "Ownership test" }), db as never, "teacher-1", "entry-foreign")
    ).rejects.toMatchObject({
      status: 403,
      message: "Teacher does not own this assignment"
    });
  });
});

describe("teacher grade export", () => {
  it("exports every student and selects the latest grade when all collection responses are capped", async () => {
    const roster = Array.from({ length: 1201 }, (_, i) => ({ id: `roster-${i}`, class_id: "class-1", display_name: `Student ${i}`, claimed_by: `student-${i}`, deactivated_at: null }));
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1" }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", archived_at: null }],
      roster_students: roster,
      class_memberships: roster.map((r, i) => ({ id: `member-${i}`, class_id: "class-1", student_id: r.claimed_by, roster_student_id: r.id })),
      gradebook_entries: roster.map((r, i) => ({ id: `entry-${i}`, assignment_id: "assignment-1", roster_student_id: r.id, approved_score: 80, published_at: "2026-01-01T00:00:00Z" })),
      attempts: roster.flatMap((r, i) => [1, 2].map(day => ({ id: `attempt-${i}-${day}`, assignment_id: "assignment-1", student_id: r.claimed_by,
        status: "graded", provisional_score: 70 + day, submitted_at: `2026-01-0${day}T00:00:00Z`, created_at: `2026-01-0${day}T00:00:00Z` })))
    });
    const db = createDb(state, 73);
    const gradebook = await listTeacherGradebook(new Request("https://worker.test/api/teacher/gradebook?courseId=class-1"), db as never, "teacher-1");
    expect(gradebook.entries).toHaveLength(1201);
    expect(gradebook.entries.every(e => e.latestAttempt?.provisionalScore === 72)).toBe(true);
    const exported = await exportTeacherGradebook(jsonRequest({ format: "long", courseId: "class-1", columns: ["student_name", "final_score"] }), db as never, "teacher-1");
    expect(exported.rowCount).toBe(1201);
    expect(exported.csv?.trim().split(/\r?\n/)).toHaveLength(1202);
    expect(exported.csv).toContain("Student 1200");
  });

  it("exports long and wide CSV with options, escaping, and audit metadata only", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO,101", name: "Biology", teacher_id: "teacher-1" }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Lab \"Check\"\nOne", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", archived_at: null }],
      roster_students: [
        {
          id: "roster-1",
          class_id: "class-1",
          display_name: "Ada, \"Lovelace\"",
          student_identifier: "S-1",
          email: "ada@example.test",
          section: "A",
          claimed_by: "student-1",
          deactivated_at: null
        },
        {
          id: "roster-2",
          class_id: "class-1",
          display_name: "Grace Hopper",
          student_identifier: "S-2",
          email: "grace@example.test",
          section: "B",
          claimed_by: "student-2",
          deactivated_at: null
        }
      ],
      gradebook_entries: [
        {
          id: "entry-published-missing",
          assignment_id: "assignment-1",
          roster_student_id: "roster-1",
          approved_attempt_id: null,
          approved_score: null,
          approved_feedback: null,
          teacher_override_score: null,
          teacher_override_note: null,
          missing: true,
          published_at: "2026-04-20T12:00:00.000Z",
          created_at: "2026-04-20T12:00:00.000Z",
          updated_at: "2026-04-20T12:00:00.000Z"
        },
        {
          id: "entry-unpublished-score",
          assignment_id: "assignment-1",
          roster_student_id: "roster-2",
          approved_attempt_id: null,
          approved_score: 94,
          approved_feedback: null,
          teacher_override_score: null,
          teacher_override_note: null,
          missing: false,
          published_at: null,
          created_at: "2026-04-20T12:00:00.000Z",
          updated_at: "2026-04-20T12:00:00.000Z"
        }
      ]
    });
    const db = createDb(state);

    const preview = await exportTeacherGradebook(jsonRequest({
      format: "long",
      courseId: "class-1",
      missingMode: "zero",
      columns: ["student_name", "assignment_title", "final_score"],
      columnLabels: {
        student_name: "Student",
        final_score: "Score"
      },
      previewOnly: true
    }), db as never, "teacher-1");
    expect(preview.csv).toBe(null);
    expect(preview.previewCount).toBe(1);
    expect(preview.rowCount).toBe(1);
    expect(preview.columnKeys).toEqual(["student_name", "assignment_title", "final_score"]);
    expect(state.grade_exports).toHaveLength(0);

    const longExport = await exportTeacherGradebook(jsonRequest({
      format: "long",
      courseId: "class-1",
      missingMode: "zero",
      columns: ["student_name", "assignment_title", "final_score"],
      columnLabels: {
        student_name: "Student",
        final_score: "Score"
      }
    }), db as never, "teacher-1");
    expect(longExport.csv).toContain("Student,Assignment,Score");
    expect(longExport.csv).toContain("\"Ada, \"\"Lovelace\"\"\"");
    expect(longExport.csv).toContain("\"Lab \"\"Check\"\"\nOne\",0");
    expect(longExport.csv).not.toContain("Grace Hopper");
    expect(state.grade_exports).toHaveLength(1);
    expect(state.grade_exports[0]).toMatchObject({
      teacher_id: "teacher-1",
      course_id: "class-1",
      format: "long",
      include_unpublished: false,
      missing_mode: "zero",
      row_count: 1,
      column_count: 3
    });

    const wideExport = await exportTeacherGradebook(jsonRequest({
      format: "wide",
      courseId: "class-1",
      includeUnpublished: true
    }), db as never, "teacher-1");
    expect(wideExport.previewCount).toBe(2);
    expect(wideExport.csv).toContain("Student Name");
    expect(wideExport.csv).toContain("Grace Hopper");
    expect(wideExport.csv).toContain(",94");
    expect(state.grade_exports).toHaveLength(2);

    const forbidden = JSON.stringify({ csv: wideExport.csv, audit: state.grade_exports });
    expect(forbidden).not.toContain("storage_key");
    expect(forbidden).not.toContain("pin_hash");
    expect(forbidden).not.toContain("file_id");
    expect(forbidden).not.toContain("local_path");
    expect(forbidden).not.toContain("raw_provider");
  });

  it("rejects export for unowned course", async () => {
    const state = createState({
      classes: [
        { id: "class-owned", code: "BIO101", name: "Biology", teacher_id: "teacher-1" },
        { id: "class-foreign", code: "CHEM101", name: "Chemistry", teacher_id: "teacher-2" }
      ]
    });
    const db = createDb(state);

    await expect(exportTeacherGradebook(jsonRequest({
      format: "long",
      courseId: "class-foreign"
    }), db as never, "teacher-1")).rejects.toMatchObject({ status: 403, message: "Teacher does not own this course" });
  });

  it("excludes archived assignments by default and allows explicit archived selection", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1" }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", created_by: "teacher-1" }],
      assessment_assignments: [
        { id: "assignment-open", class_id: "class-1", assessment_id: "assessment-1", archived_at: null },
        { id: "assignment-archived", class_id: "class-1", assessment_id: "assessment-1", archived_at: "2026-04-05T00:00:00.000Z" }
      ],
      roster_students: [{ id: "roster-1", class_id: "class-1", display_name: "Student", claimed_by: null, deactivated_at: null }],
      gradebook_entries: [
        {
          id: "entry-open",
          assignment_id: "assignment-open",
          roster_student_id: "roster-1",
          approved_attempt_id: null,
          approved_score: 88,
          approved_feedback: null,
          teacher_override_score: null,
          teacher_override_note: null,
          missing: false,
          published_at: "2026-04-20T12:00:00.000Z",
          created_at: "2026-04-20T12:00:00.000Z",
          updated_at: "2026-04-20T12:00:00.000Z"
        },
        {
          id: "entry-archived",
          assignment_id: "assignment-archived",
          roster_student_id: "roster-1",
          approved_attempt_id: null,
          approved_score: 66,
          approved_feedback: null,
          teacher_override_score: null,
          teacher_override_note: null,
          missing: false,
          published_at: "2026-04-20T12:00:00.000Z",
          created_at: "2026-04-20T12:00:00.000Z",
          updated_at: "2026-04-20T12:00:00.000Z"
        }
      ]
    });
    const db = createDb(state);

    const defaultExport = await exportTeacherGradebook(jsonRequest({
      format: "long",
      courseId: "class-1",
      includeUnpublished: true
    }), db as never, "teacher-1");
    expect(defaultExport.csv).toContain("assignment-open");
    expect(defaultExport.csv).not.toContain("assignment-archived");

    const archivedOnlyExport = await exportTeacherGradebook(jsonRequest({
      format: "long",
      courseId: "class-1",
      includeUnpublished: true,
      assignmentIds: ["assignment-archived"]
    }), db as never, "teacher-1");
    expect(archivedOnlyExport.csv).toContain("assignment-archived");
    expect(archivedOnlyExport.csv).not.toContain("assignment-open");
  });
});

function createState(input?: Partial<State>): State {
  return {
    profiles: [{ id: "teacher-1", role: "teacher", display_name: "Teacher One" }],
    classes: [],
    assessments: [],
    assessment_assignments: [],
    roster_students: [],
    class_memberships: [],
    attempts: [],
    gradebook_entries: [],
    grade_exports: [],
    ...input
  };
}

function createDb(state: State, apiCap = Infinity) {
  return {
    async rpc(name: string, args: Record<string, any>) {
      if (name === "reconcile_course_gradebook") return reconcileFixture(state, args);
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table: keyof State) {
      return new Query(table, state, apiCap);
    }
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private inFilters: Array<(row: Row) => boolean> = [];
  private isFilters: Array<(row: Row) => boolean> = [];
  private orderKeys: Array<{ key: string; ascending: boolean }> = [];
  private pendingInsert: Row[] | null = null;
  private pendingUpdate: Row | null = null;
  private selected = "";
  private pageFrom = 0;
  private pageTo = Infinity;

  range(from: number, to: number) { this.pageFrom = from; this.pageTo = to; return this; }

  constructor(private table: keyof State, private state: State, private apiCap: number) {}

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

  is(key: string, value: unknown) {
    this.isFilters.push((row) => row[key] === value);
    return this;
  }

  order(key: string, options?: { ascending?: boolean }) {
    this.orderKeys.push({ key, ascending: options?.ascending !== false });
    return this;
  }

  insert(payload: Row | Row[]) {
    this.pendingInsert = Array.isArray(payload) ? payload.map((row) => ({ ...row })) : [{ ...payload }];
    return this;
  }

  update(payload: Row) {
    this.pendingUpdate = { ...payload };
    return this;
  }

  async single() {
    const inserted = this.commitInsert();
    if (inserted.length > 0) {
      if (this.table === "assessment_assignments") {
        const row = inserted[0];
        const table = this.tableData();
        const duplicates = table.filter((item) => item.id !== row.id && item.assessment_id === row.assessment_id && item.class_id === row.class_id && item.archived_at === null);
        if (duplicates.length > 0) {
          return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint idx_assignment_active_unique" } };
        }
      }
      return { data: this.decorate(inserted[0]), error: null };
    }

    const rows = this.matchRows(this.tableData());
    if (rows.length === 0) return { data: null, error: null };
    this.applyUpdate(rows);
    return { data: this.decorate(rows[0]), error: null };
  }

  async maybeSingle() {
    const inserted = this.commitInsert();
    if (inserted.length > 0) return { data: this.decorate(inserted[0]), error: null };
    const rows = this.matchRows(this.tableData());
    if (rows.length === 0) return { data: null, error: null };
    this.applyUpdate(rows);
    return { data: this.decorate(rows[0]), error: null };
  }

  then(resolve: (value: { data: unknown; error: null }) => void) {
    const inserted = this.commitInsert();
    if (inserted.length > 0) {
      resolve({ data: inserted.map((row) => this.decorate(row)), error: null });
      return;
    }

    const rows = this.applyOrder(this.matchRows(this.tableData()));
    this.applyUpdate(rows);
    resolve({ data: rows.slice(this.pageFrom, Math.min(this.pageTo + 1, this.pageFrom + this.apiCap)).map((row) => this.decorate(row)), error: null });
  }

  private commitInsert(): Row[] {
    if (!this.pendingInsert) return [];
    const rows = this.pendingInsert.map((payload, index) => {
      const row = {
        id: payload.id ?? `${this.table}-${this.tableData().length + index + 1}`,
        created_at: payload.created_at ?? "2026-01-01T00:00:00.000Z",
        updated_at: payload.updated_at ?? "2026-01-01T00:00:00.000Z",
        ...payload
      };
      this.tableData().push(row);
      return row;
    });
    this.pendingInsert = null;
    return rows;
  }

  private applyUpdate(rows: Row[]): void {
    if (!this.pendingUpdate) return;
    for (const row of rows) {
      Object.assign(row, this.pendingUpdate);
    }
    this.pendingUpdate = null;
  }

  private decorate(row: Row): Row {
    if (this.table !== "assessment_assignments") return row;
    const includeClasses = this.selected.includes("classes(");
    const includeAssessments = this.selected.includes("assessments(");
    const classRow = this.state.classes.find((item) => item.id === row.class_id) ?? null;
    const assessmentRow = this.state.assessments.find((item) => item.id === row.assessment_id) ?? null;
    return {
      ...row,
      classes: includeClasses ? classRow : undefined,
      assessments: includeAssessments ? assessmentRow : undefined
    };
  }

  private applyOrder(rows: Row[]): Row[] {
    if (this.orderKeys.length === 0) return rows;
    const sorted = [...rows];
    sorted.sort((a, b) => {
      for (const key of this.orderKeys) {
        const left = String(a[key.key] ?? "");
        const right = String(b[key.key] ?? "");
        const compared = left.localeCompare(right);
        if (compared !== 0) return key.ascending ? compared : -compared;
      }
      return 0;
    });
    return sorted;
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

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/mock", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
}
