import { describe, expect, it } from "vitest";
import { assertDraftAttemptStatus, claimAttemptSubmission } from "../src/lib/attemptLifecycle";

type Row = Record<string, any>;

interface State {
  attempts: Row[];
  assessment_assignments: Row[];
  forceArchiveBeforeClaim?: boolean;
}

type StateTable = "attempts" | "assessment_assignments";

describe("claimAttemptSubmission", () => {
  it("claims draft submissions atomically and computes on-time/late from current assignment due_at", async () => {
    const onTimeState = createState({
      attempts: [{ id: "attempt-1", student_id: "student-1", assignment_id: "assignment-1", status: "draft" }],
      assessment_assignments: [{ id: "assignment-1", due_at: "2026-05-01T12:00:00.000Z", archived_at: null }]
    });
    const onTimeDb = createDb(onTimeState);

    const onTime = await claimAttemptSubmission(onTimeDb as never, "student-1", "attempt-1", "2026-05-01T11:59:00.000Z");
    expect(onTime.submittedAfterDue).toBe(false);
    expect(onTimeState.attempts[0]).toMatchObject({
      status: "submitted",
      submitted_after_due: false,
      submitted_at: "2026-05-01T11:59:00.000Z"
    });

    const lateState = createState({
      attempts: [{ id: "attempt-2", student_id: "student-1", assignment_id: "assignment-2", status: "draft", due_at_snapshot: "2026-04-30T00:00:00.000Z" }],
      assessment_assignments: [{ id: "assignment-2", due_at: "2026-05-01T12:00:00.000Z", archived_at: null }]
    });
    const lateDb = createDb(lateState);

    const late = await claimAttemptSubmission(lateDb as never, "student-1", "attempt-2", "2026-05-01T12:01:00.000Z");
    expect(late.submittedAfterDue).toBe(true);
    expect(lateState.attempts[0]).toMatchObject({
      status: "submitted",
      submitted_after_due: true,
      submitted_at: "2026-05-01T12:01:00.000Z"
    });
  });

  it("honors due-date extensions present at claim time", async () => {
    const state = createState({
      attempts: [{ id: "attempt-ext", student_id: "student-1", assignment_id: "assignment-ext", status: "draft", due_at_snapshot: "2026-04-25T00:00:00.000Z" }],
      assessment_assignments: [{ id: "assignment-ext", due_at: "2026-05-10T00:00:00.000Z", archived_at: null }]
    });
    const db = createDb(state);

    const claimed = await claimAttemptSubmission(db as never, "student-1", "attempt-ext", "2026-05-01T12:00:00.000Z");
    expect(claimed.submittedAfterDue).toBe(false);
  });

  it("rejects archived assignments and non-draft attempts", async () => {
    const archivedState = createState({
      attempts: [{ id: "attempt-arch", student_id: "student-1", assignment_id: "assignment-arch", status: "draft" }],
      assessment_assignments: [{ id: "assignment-arch", due_at: null, archived_at: "2026-05-01T00:00:00.000Z" }]
    });
    const archivedDb = createDb(archivedState);

    await expect(
      claimAttemptSubmission(archivedDb as never, "student-1", "attempt-arch", "2026-05-01T01:00:00.000Z")
    ).rejects.toMatchObject({
      status: 409,
      message: "Assignment is no longer available"
    });
    expect(archivedState.attempts[0].status).toBe("draft");

    const nonDraftState = createState({
      attempts: [{ id: "attempt-sub", student_id: "student-1", assignment_id: "assignment-sub", status: "submitted" }],
      assessment_assignments: [{ id: "assignment-sub", due_at: null, archived_at: null }]
    });
    const nonDraftDb = createDb(nonDraftState);

    await expect(
      claimAttemptSubmission(nonDraftDb as never, "student-1", "attempt-sub", "2026-05-01T01:00:00.000Z")
    ).rejects.toMatchObject({
      status: 409,
      code: "already_submitted"
    });

    const errorState = createState({
      attempts: [{ id: "attempt-error", student_id: "student-1", assignment_id: "assignment-error", status: "error" }],
      assessment_assignments: [{ id: "assignment-error", due_at: null, archived_at: null }]
    });
    const errorDb = createDb(errorState);

    await expect(
      claimAttemptSubmission(errorDb as never, "student-1", "attempt-error", "2026-05-01T01:00:00.000Z")
    ).rejects.toMatchObject({
      status: 409,
      message: "Attempt is no longer in draft state",
      details: { attemptId: "attempt-error", status: "error" },
      code: undefined
    });
  });

  it("rejects a draft if the assignment is archived before the atomic claim update", async () => {
    const state = createState({
      forceArchiveBeforeClaim: true,
      attempts: [{ id: "attempt-late-archive", student_id: "student-1", assignment_id: "assignment-late-archive", status: "draft" }],
      assessment_assignments: [{ id: "assignment-late-archive", due_at: null, archived_at: null }]
    });
    const db = createDb(state);

    await expect(
      claimAttemptSubmission(db as never, "student-1", "attempt-late-archive", "2026-05-01T01:00:00.000Z")
    ).rejects.toMatchObject({
      status: 409,
      message: "Assignment is no longer available"
    });
    expect(state.attempts[0].status).toBe("draft");
    expect(state.assessment_assignments[0].archived_at).toBe("2026-05-01T00:00:00.000Z");
  });

  it("allows only one winner in double-submit races", async () => {
    const state = createState({
      attempts: [{ id: "attempt-race", student_id: "student-1", assignment_id: "assignment-race", status: "draft" }],
      assessment_assignments: [{ id: "assignment-race", due_at: null, archived_at: null }]
    });
    const db = createDb(state);

    const first = claimAttemptSubmission(db as never, "student-1", "attempt-race", "2026-05-01T01:00:00.000Z");
    const second = claimAttemptSubmission(db as never, "student-1", "attempt-race", "2026-05-01T01:00:01.000Z");
    const results = await Promise.allSettled([first, second]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(state.attempts[0].status).toBe("submitted");
  });
});

describe("assertDraftAttemptStatus", () => {
  it("uses the same non-draft lifecycle errors as the atomic claim path", () => {
    expect(() => assertDraftAttemptStatus("attempt-draft", "draft")).not.toThrow();
    expect(() => assertDraftAttemptStatus("attempt-submitted", "submitted")).toThrowError(expect.objectContaining({
      status: 409,
      message: "Attempt is no longer in draft state",
      details: { attemptId: "attempt-submitted", status: "submitted" },
      code: "already_submitted"
    }));
    expect(() => assertDraftAttemptStatus("attempt-error", "error")).toThrowError(expect.objectContaining({
      status: 409,
      message: "Attempt is no longer in draft state",
      details: { attemptId: "attempt-error", status: "error" },
      code: undefined
    }));
  });
});

function createState(input?: Partial<State>): State {
  return {
    attempts: [],
    assessment_assignments: [],
    ...input
  };
}

function createDb(state: State) {
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "claim_attempt_submission") throw new Error(`Unexpected rpc ${name}`);
      return new ClaimAttemptSubmissionRpc(state, args);
    },
    from(table: StateTable) {
      return new Query(table, state);
    }
  };
}

class ClaimAttemptSubmissionRpc {
  constructor(private state: State, private args: Record<string, unknown>) {}

  async single() {
    const userId = this.args.p_user_id;
    const attemptId = this.args.p_attempt_id;
    const submittedAt = this.args.p_submitted_at as string;
    const attempt = this.state.attempts.find((row) => row.id === attemptId && row.student_id === userId);
    if (!attempt) {
      return { data: rpcRow("not_found"), error: null };
    }

    const assignment = attempt.assignment_id
      ? this.state.assessment_assignments.find((row) => row.id === attempt.assignment_id) ?? null
      : null;
    if (!attempt.assignment_id || !assignment) {
      return { data: rpcRow("missing_assignment", attempt), error: null };
    }

    if (this.state.forceArchiveBeforeClaim) {
      assignment.archived_at = "2026-05-01T00:00:00.000Z";
      this.state.forceArchiveBeforeClaim = false;
    }

    if (attempt.status !== "draft") {
      return { data: rpcRow("not_draft", attempt, assignment), error: null };
    }
    if (assignment.archived_at) {
      return { data: rpcRow("archived_assignment", attempt, assignment), error: null };
    }

    const submittedAfterDue = typeof assignment.due_at === "string" && Date.parse(submittedAt) > Date.parse(assignment.due_at);
    Object.assign(attempt, {
      status: "submitted",
      submitted_at: submittedAt,
      submitted_after_due: submittedAfterDue,
      updated_at: submittedAt
    });
    return {
      data: rpcRow("success", attempt, assignment),
      error: null
    };
  }
}

function rpcRow(status: string, attempt?: Row | null, assignment?: Row | null) {
  return {
    claim_status: status,
    attempt_id: attempt?.id ?? null,
    assignment_id: attempt?.assignment_id ?? null,
    submitted_at: status === "success" ? attempt?.submitted_at ?? null : null,
    submitted_after_due: status === "success" ? attempt?.submitted_after_due ?? false : null,
    assignment_due_at: assignment?.due_at ?? null,
    current_attempt_status: attempt?.status ?? null
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private pendingUpdate: Row | null = null;
  private selected = "";

  constructor(private table: StateTable, private state: State) {}

  select(columns = "") {
    this.selected = columns;
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }

  update(payload: Row) {
    this.pendingUpdate = { ...payload };
    return this;
  }

  async maybeSingle() {
    const rows = this.matchRows(this.tableData());
    if (this.pendingUpdate) {
      if (rows.length === 0) return { data: null, error: null };
      const row = rows[0];
      Object.assign(row, this.pendingUpdate);
      this.pendingUpdate = null;
      return { data: this.decorate(row), error: null };
    }

    if (rows.length === 0) return { data: null, error: null };
    return { data: this.decorate(rows[0]), error: null };
  }

  private decorate(row: Row): Row {
    if (this.table !== "attempts") return row;
    if (!this.selected.includes("assessment_assignments(")) return row;

    const assignment = row.assignment_id
      ? this.state.assessment_assignments.find((candidate) => candidate.id === row.assignment_id) ?? null
      : null;
    return {
      ...row,
      assessment_assignments: assignment
    };
  }

  private matchRows(rows: Row[]): Row[] {
    return rows.filter((row) => this.filters.every((filter) => filter(row)));
  }

  private tableData(): Row[] {
    return this.state[this.table];
  }
}
