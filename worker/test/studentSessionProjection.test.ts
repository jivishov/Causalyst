import { describe, expect, it, vi } from "vitest";
import { listStudentCourseAssignments } from "../src/lib/db";

describe("student session projection", () => {
  it("projects lifecycle state, due state, latest attempt, and published final summary per assignment", async () => {
    try {
      vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-05-01T10:00:00.000Z"));
      const db = makeDb({
        classes: [{ id: "class-1", code: "BIO101", name: "Biology" }],
        assessments: [assessmentRow("assessment-1", "writing", "Lab write-up")],
        assessment_assignments: [
          assignmentRow("assignment-final", "class-1", "assessment-1", "2026-05-01T12:00:00.000Z"),
          assignmentRow("assignment-draft", "class-1", "assessment-1", "2026-05-02T00:00:00.000Z"),
          assignmentRow("assignment-overdue", "class-1", "assessment-1", "2020-05-02T12:00:00.000Z")
        ],
        class_memberships: [{ class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" }],
        roster_students: [],
        attempts: [
          {
            id: "attempt-final",
            assignment_id: "assignment-final",
            status: "graded",
            submitted_at: "2026-05-01T13:00:00.000Z",
            provisional_score: 94,
            submitted_after_due: false,
            created_at: "2026-05-01T13:00:00.000Z",
            student_id: "student-1"
          },
          {
            id: "attempt-draft",
            assignment_id: "assignment-draft",
            status: "draft",
            submitted_at: null,
            provisional_score: null,
            submitted_after_due: false,
            created_at: "2026-05-01T09:00:00.000Z",
            student_id: "student-1"
          }
        ],
        gradebook_entries: [
          {
            assignment_id: "assignment-final",
            roster_student_id: "roster-1",
            published_at: "2026-05-03T10:00:00.000Z",
            approved_score: 94,
            approved_feedback: {
              score: 94,
              overallComment: "Strong evidence",
              criteria: [],
              confidence: "high",
              reviewFlags: []
            },
            teacher_override_score: null,
            missing: false
          }
        ]
      });

      const courses = await listStudentCourseAssignments(db as never, "student-1");
      expect(courses).toHaveLength(1);

      const assignments = courses[0].assignments;
      const finalPublished = assignments.find((row) => row.assignmentId === "assignment-final");
      expect(finalPublished?.state).toBe("final_published");
      expect(finalPublished?.dueState).toBe("none");
      expect(finalPublished?.latestAttempt).toEqual(expect.objectContaining({
        attemptId: "attempt-final",
        status: "graded"
      }));
      expect(finalPublished?.publishedGrade).toEqual(expect.objectContaining({
        finalScore: 94,
        finalStatus: "approved_ai",
        publishedAt: "2026-05-03T10:00:00.000Z"
      }));

      const draft = assignments.find((row) => row.assignmentId === "assignment-draft");
      expect(draft?.state).toBe("draft");
      expect(draft?.dueState).toBe("due_soon");
      expect(draft?.latestAttempt?.attemptId).toBe("attempt-draft");

      const overdue = assignments.find((row) => row.assignmentId === "assignment-overdue");
      expect(overdue?.state).toBe("not_started");
      expect(overdue?.dueState).toBe("overdue");
      expect(overdue?.latestAttempt).toBeNull();
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("ignores historical blank-published rows in student payloads", async () => {
    const db = makeDb({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology" }],
      assessments: [assessmentRow("assessment-1", "voice", "Oral check")],
      assessment_assignments: [assignmentRow("assignment-1", "class-1", "assessment-1", "2026-05-01T12:00:00.000Z")],
      class_memberships: [{ class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" }],
      roster_students: [],
      attempts: [{
        id: "attempt-1",
        assignment_id: "assignment-1",
        status: "graded",
        submitted_at: "2026-05-01T12:30:00.000Z",
        provisional_score: 88,
        submitted_after_due: false,
        created_at: "2026-05-01T12:30:00.000Z",
        student_id: "student-1"
      }],
      gradebook_entries: [{
        assignment_id: "assignment-1",
        roster_student_id: "roster-1",
        published_at: "2026-05-03T10:00:00.000Z",
        approved_score: null,
        approved_feedback: null,
        teacher_override_score: null,
        missing: false
      }]
    });

    const courses = await listStudentCourseAssignments(db as never, "student-1");
    expect(courses[0].assignments[0].publishedGrade).toBeNull();
    expect(courses[0].assignments[0].state).toBe("provisional_ready");
  });

  it("marks late-submitted assignments from persisted late metadata", async () => {
    const db = makeDb({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology" }],
      assessments: [assessmentRow("assessment-1", "simulation", "Model process")],
      assessment_assignments: [assignmentRow("assignment-1", "class-1", "assessment-1", "2026-05-01T12:00:00.000Z")],
      class_memberships: [{ class_id: "class-1", student_id: "student-1", roster_student_id: "roster-1" }],
      roster_students: [],
      attempts: [{
        id: "attempt-late",
        assignment_id: "assignment-1",
        status: "submitted",
        submitted_at: "2026-05-01T12:05:00.000Z",
        provisional_score: null,
        submitted_after_due: true,
        created_at: "2026-05-01T12:05:00.000Z",
        student_id: "student-1"
      }],
      gradebook_entries: []
    });

    const courses = await listStudentCourseAssignments(db as never, "student-1");
    const assignment = courses[0].assignments[0];
    expect(assignment.state).toBe("submitted");
    expect(assignment.dueState).toBe("late_submitted");
  });
});

type Row = Record<string, any>;

interface State {
  classes: Row[];
  assessments: Row[];
  assessment_assignments: Row[];
  class_memberships: Row[];
  roster_students: Row[];
  attempts: Row[];
  gradebook_entries: Row[];
}

function makeDb(state: State) {
  return {
    from(table: keyof State) {
      return new Query(state, table);
    }
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];

  constructor(private state: State, private table: keyof State) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }

  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]));
    return this;
  }

  then(resolve: (value: { data: unknown; error: null }) => void) {
    resolve({ data: this.rows().map((row) => this.decorate(row)), error: null });
  }

  private rows(): Row[] {
    return this.state[this.table].filter((row) => this.filters.every((predicate) => predicate(row)));
  }

  private decorate(row: Row): Row {
    if (this.table !== "assessment_assignments") return row;

    const assessment = this.state.assessments.find((item) => item.id === row.assessment_id) ?? null;
    const course = this.state.classes.find((item) => item.id === row.class_id) ?? null;
    return {
      ...row,
      assessments: assessment,
      classes: course ? { code: course.code, name: course.name } : null
    };
  }
}

function assessmentRow(id: string, type: "voice" | "writing" | "simulation", title: string): Row {
  return {
    id,
    type,
    title,
    prompt: "Explain observations",
    expected_answer: null,
    rubric: [],
    config: {}
  };
}

function assignmentRow(id: string, classId: string, assessmentId: string, dueAt: string): Row {
  return {
    id,
    class_id: classId,
    assessment_id: assessmentId,
    opens_at: null,
    due_at: dueAt,
    archived_at: null
  };
}
