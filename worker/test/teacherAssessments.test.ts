import { describe, expect, it } from "vitest";
import { listStudentCourseAssignments, requireAssignedAssignment } from "../src/lib/db";
import { createTeacherAssessment, createTeacherAssignment, setTeacherAssignmentArchived } from "../src/routes/teacherAssessments";

describe("teacher assessment assignments", () => {
  it("defaults simulation assessments to the OpenAI simulation code model", async () => {
    const state = createState();
    const db = createDb(state);

    const result = await createTeacherAssessment(jsonRequest({
      type: "simulation",
      title: "Simulation",
      prompt: "Describe a process.",
      rubric: [{ name: "Accuracy", maxPoints: 5, description: "Accurate process" }],
      config: { minDescriptionChars: 55 }
    }), db as never, "teacher-1");

    expect(result.assessment.config).toMatchObject({
      minDescriptionChars: 55,
      simulationCodeModelId: "openai:gpt-5.5"
    });
    expect(state.assessments[0].config).toMatchObject({
      minDescriptionChars: 55,
      simulationCodeModelId: "openai:gpt-5.5"
    });
  });

  it("accepts sketch-aware open source simulation code models and rejects blocked ids", async () => {
    const db = createDb(createState());

    const result = await createTeacherAssessment(jsonRequest({
      type: "simulation",
      title: "Simulation",
      prompt: "Describe a process.",
      rubric: [{ name: "Accuracy", maxPoints: 5, description: "Accurate process" }],
      config: { simulationCodeModelId: "zai:glm-5v-turbo" }
    }), db as never, "teacher-1");

    expect(result.assessment.config).toMatchObject({
      minDescriptionChars: 40,
      simulationCodeModelId: "zai:glm-5v-turbo"
    });
    await expect(createTeacherAssessment(jsonRequest({
      type: "simulation",
      title: "Blocked",
      prompt: "Describe a process.",
      rubric: [{ name: "Accuracy", maxPoints: 5, description: "Accurate process" }],
      config: { simulationCodeModelId: "openai:gpt-5.4-pro" }
    }), db as never, "teacher-1")).rejects.toMatchObject({
      status: 400,
      message: "config.simulationCodeModelId must be an allowed simulation code model"
    });
  });

  it("rejects archiving another teacher's assignment", async () => {
    const db = createDb(createState({
      profiles: [
        { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
        { id: "teacher-2", role: "teacher", display_name: "Teacher Two" }
      ],
      classes: [{ id: "class-2", code: "CHEM101", name: "Chemistry", teacher_id: "teacher-2", archived_at: null }],
      assessments: [{ id: "assessment-2", type: "voice", title: "Foreign", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-2", archived_at: null }],
      assessment_assignments: [{ id: "assignment-2", class_id: "class-2", assessment_id: "assessment-2", opens_at: null, due_at: null, archived_at: null }]
    }));

    await expect(setTeacherAssignmentArchived(db as never, "teacher-1", "assignment-2", true)).rejects.toMatchObject({
      status: 404
    });
  });

  it("rejects assigning another teacher's assessment", async () => {
    const db = createDb(createState({
      profiles: [
        { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
        { id: "teacher-2", role: "teacher", display_name: "Teacher Two" }
      ],
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [{ id: "assessment-2", type: "voice", title: "Shared", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-2", archived_at: null }]
    }));

    await expect(
      createTeacherAssignment(jsonRequest({
        courseId: "class-1",
        assessmentId: "assessment-2"
      }), db as never, "teacher-1")
    ).rejects.toMatchObject({
      status: 404,
      message: "Assessment not found"
    });
  });

  it("validates assignment opens/due date ordering", async () => {
    const db = createDb(createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: null }]
    }));

    await expect(
      createTeacherAssignment(jsonRequest({
        courseId: "class-1",
        assessmentId: "assessment-1",
        opensAt: "2026-03-01T00:00:00.000Z",
        dueAt: "2026-02-01T00:00:00.000Z"
      }), db as never, "teacher-1")
    ).rejects.toMatchObject({
      status: 400,
      message: "dueAt must be later than or equal to opensAt"
    });
  });

  it("allows archive and reassign for same assessment-course pair", async () => {
    const state = createState({
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: null }]
    });
    const db = createDb(state);

    const first = await createTeacherAssignment(jsonRequest({
      courseId: "class-1",
      assessmentId: "assessment-1"
    }), db as never, "teacher-1");

    await setTeacherAssignmentArchived(db as never, "teacher-1", first.assignment.id, true);

    const second = await createTeacherAssignment(jsonRequest({
      courseId: "class-1",
      assessmentId: "assessment-1"
    }), db as never, "teacher-1");

    expect(second.assignment.id).not.toBe(first.assignment.id);
    expect(state.assessment_assignments.filter((row) => row.archived_at === null)).toHaveLength(1);
  });
});

describe("student visibility", () => {
  it("returns only open and active assignments", async () => {
    const now = Date.now();
    const state = createState({
      class_memberships: [{ class_id: "class-1", student_id: "student-1" }],
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [
        { id: "assessment-open", type: "voice", title: "Open", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: null },
        { id: "assessment-future", type: "voice", title: "Future", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: null },
        { id: "assessment-archived", type: "voice", title: "Archived", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: null },
        { id: "assessment-archived-parent", type: "voice", title: "Archived Parent", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: new Date(now).toISOString() }
      ],
      assessment_assignments: [
        { id: "assignment-open", class_id: "class-1", assessment_id: "assessment-open", opens_at: new Date(now - 60_000).toISOString(), due_at: null, archived_at: null },
        { id: "assignment-future", class_id: "class-1", assessment_id: "assessment-future", opens_at: new Date(now + 3600_000).toISOString(), due_at: null, archived_at: null },
        { id: "assignment-archived", class_id: "class-1", assessment_id: "assessment-archived", opens_at: null, due_at: null, archived_at: new Date(now).toISOString() },
        { id: "assignment-archived-parent", class_id: "class-1", assessment_id: "assessment-archived-parent", opens_at: null, due_at: null, archived_at: null }
      ]
    });
    const db = createDb(state);

    const courses = await listStudentCourseAssignments(db as never, "student-1");
    expect(courses).toHaveLength(1);
    expect(courses[0].assignments).toHaveLength(1);
    expect(courses[0].assignments[0].assignmentId).toBe("assignment-open");
  });

  it("blocks attempt start on archived assignments", async () => {
    const state = createState({
      class_memberships: [{ class_id: "class-1", student_id: "student-1" }],
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: null }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", opens_at: null, due_at: null, archived_at: new Date().toISOString() }]
    });
    const db = createDb(state);

    await expect(requireAssignedAssignment(db as never, "student-1", "assignment-1")).rejects.toMatchObject({
      status: 403,
      message: "Assignment is not available to this student"
    });
  });

  it("blocks direct assignment access when the assessment is archived", async () => {
    const state = createState({
      class_memberships: [{ class_id: "class-1", student_id: "student-1" }],
      classes: [{ id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", archived_at: null }],
      assessments: [{ id: "assessment-1", type: "voice", title: "Voice", prompt: "Prompt", expected_answer: null, rubric: [], config: {}, created_by: "teacher-1", archived_at: new Date().toISOString() }],
      assessment_assignments: [{ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1", opens_at: null, due_at: null, archived_at: null }]
    });
    const db = createDb(state);

    await expect(requireAssignedAssignment(db as never, "student-1", "assignment-1")).rejects.toMatchObject({
      status: 403,
      message: "Assignment is not available to this student"
    });
  });
});

type Row = Record<string, any>;

interface State {
  profiles: Row[];
  classes: Row[];
  assessments: Row[];
  assessment_assignments: Row[];
  class_memberships: Row[];
  roster_students: Row[];
  attempts: Row[];
  gradebook_entries: Row[];
}

function createState(input?: Partial<State>): State {
  return {
    profiles: [{ id: "teacher-1", role: "teacher", display_name: "Teacher One" }],
    classes: [],
    assessments: [],
    assessment_assignments: [],
    class_memberships: [],
    roster_students: [],
    attempts: [],
    gradebook_entries: [],
    ...input
  };
}

function createDb(state: State) {
  return {
    from(table: keyof State) {
      return new Query(table, state);
    }
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private inFilters: Array<(row: Row) => boolean> = [];
  private isFilters: Array<(row: Row) => boolean> = [];
  private pendingInsert: Row | null = null;
  private pendingUpdate: Row | null = null;
  private selected = "";
  private orderKey = "";
  private orderAscending = true;

  constructor(private table: keyof State, private state: State) {}

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
    this.orderKey = key;
    this.orderAscending = options?.ascending !== false;
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
    if (!this.pendingInsert) return { data: null, error: null };
    const table = this.tableData();
    if (this.table === "assessment_assignments") {
      const duplicate = table.find((row) =>
        row.assessment_id === this.pendingInsert?.assessment_id
        && row.class_id === this.pendingInsert?.class_id
        && row.archived_at === null
      );
      if (duplicate) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint idx_assignment_active_unique" } };
      }
    }
    const inserted = {
      id: this.pendingInsert.id ?? `${this.table}-${table.length + 1}`,
      created_at: this.pendingInsert.created_at ?? "2026-01-01T00:00:00.000Z",
      updated_at: this.pendingInsert.updated_at ?? "2026-01-01T00:00:00.000Z",
      archived_at: this.pendingInsert.archived_at ?? null,
      ...this.pendingInsert
    };
    table.push(inserted);
    return { data: this.decorate(inserted), error: null };
  }

  async maybeSingle() {
    const table = this.tableData();
    const match = this.matchRows(table)[0];
    if (!match) return { data: null, error: null };
    if (this.pendingUpdate) {
      Object.assign(match, this.pendingUpdate);
    }
    return { data: this.decorate(match), error: null };
  }

  then(resolve: (value: { data: unknown; error: null }) => void) {
    const table = this.tableData();
    const rows = this.applyOrder(this.matchRows(table)).map((row) => this.decorate(row));
    resolve({ data: rows, error: null });
  }

  private applyOrder(rows: Row[]): Row[] {
    if (!this.orderKey) return rows;
    const sorted = [...rows].sort((a, b) => {
      const left = String(a[this.orderKey] ?? "");
      const right = String(b[this.orderKey] ?? "");
      return left.localeCompare(right);
    });
    return this.orderAscending ? sorted : sorted.reverse();
  }

  private decorate(row: Row): Row {
    if (this.table !== "assessment_assignments") return row;
    const includeClasses = this.selected.includes("classes(");
    const includeAssessments = this.selected.includes("assessments(");
    if (!includeClasses && !includeAssessments) return row;
    const classes = this.state.classes.find((item) => item.id === row.class_id) ?? null;
    const assessment = this.state.assessments.find((item) => item.id === row.assessment_id) ?? null;
    return {
      ...row,
      classes: includeClasses && classes ? { code: classes.code, name: classes.name } : null,
      assessments: includeAssessments ? assessment : null
    };
  }

  private matchRows(rows: Row[]): Row[] {
    return rows.filter((row) => {
      return this.filters.every((check) => check(row))
        && this.inFilters.every((check) => check(row))
        && this.isFilters.every((check) => check(row));
    });
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
