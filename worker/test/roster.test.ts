import { reconcileFixture } from "./helpers/rpcFixtures";
import { describe, expect, it } from "vitest";
import type { Env } from "../src/lib/env";
import { hashPin } from "../src/lib/crypto";
import { parseRosterCsv } from "../src/lib/rosterCsv";
import { commitTeacherRosterImport, previewTeacherRosterImport } from "../src/routes/teacher";
import { studentLogin, studentSession } from "../src/routes/student";

const env: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OPENAI_API_KEY: "openai-key",
  PIN_PEPPER: "test-pepper",
  TEACHER_SETUP_CODE: "setup-code",
};

describe("roster import parser", () => {
  it("parses CSV rows and validates required fields", () => {
    const parsed = parseRosterCsv([
      "display_name,student_identifier,email,section",
      "\"Doe, Jane\",S-01,jane@example.com,1A",
      ",S-02,bad@example.com,1A"
    ].join("\n"));

    expect(parsed.rows).toEqual([
      {
        rowNumber: 2,
        displayName: "Doe, Jane",
        studentIdentifier: "S-01",
        email: "jane@example.com",
        section: "1A"
      }
    ]);
    expect(parsed.errors).toEqual([
      { rowNumber: 3, field: "display_name", message: "display_name is required" }
    ]);
  });
});

describe("roster import workflow", () => {
  it("flags duplicate identifiers and emails in preview", async () => {
    const state = createState();
    state.roster_students.push(rosterRow({
      id: "roster-existing",
      displayName: "Existing Student",
      studentIdentifier: "A-001",
      email: "existing@example.com"
    }));
    const db = createDb(state);

    const preview = await previewTeacherRosterImport(
      jsonRequest({
        csvText: [
          "display_name,student_identifier,email,section",
          "Student A,A-002,a@example.com,1A",
          "Student B,A-002,b@example.com,1A",
          "Student C,A-003,existing@example.com,1A"
        ].join("\n")
      }),
      db as never,
      "teacher-1",
      "class-1"
    );

    expect(preview.acceptedRows).toHaveLength(0);
    expect(preview.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ rowNumber: 2, field: "student_identifier" }),
      expect.objectContaining({ rowNumber: 3, field: "student_identifier" }),
      expect.objectContaining({ rowNumber: 4, field: "email" })
    ]));
  });

  it("returns plaintext PINs once while persisting only PIN hashes", async () => {
    const state = createState();
    const db = createDb(state);
    const csvText = [
      "display_name,student_identifier,email,section",
      "Student A,A-100,a100@example.com,1A"
    ].join("\n");

    const committed = await commitTeacherRosterImport(jsonRequest({ csvText }), env, db as never, "teacher-1", "class-1");

    expect(committed.createdCount).toBe(1);
    expect(committed.pins).toHaveLength(1);
    expect(committed.pins[0].pin).toMatch(/^\d{6}$/);
    expect(state.student_access_codes).toHaveLength(1);
    expect(state.student_access_codes[0].pin_hash).not.toBe(committed.pins[0].pin);
    await expect(hashPin(committed.pins[0].pin, env)).resolves.toBe(state.student_access_codes[0].pin_hash);
  });

  it("claims roster-linked PINs with a matching Google email", async () => {
    const state = createState();
    const db = createDb(state);
    const csvText = [
      "display_name,student_identifier,email,section",
      "Student One,S-1,student1@example.com,2B"
    ].join("\n");
    const committed = await commitTeacherRosterImport(jsonRequest({ csvText }), env, db as never, "teacher-1", "class-1");

    const result = await studentLogin(
      jsonRequest({
        classCode: "bio101",
        pin: committed.pins[0].pin
      }),
      env,
      db as never,
      "student-1",
      "student1@example.com"
    );

    expect(result.profile.displayName).toBe("Student One");
    expect(result.profile.email).toBe("student1@example.com");
    expect(state.class_memberships).toEqual([
      expect.objectContaining({
        class_id: "class-1",
        student_id: "student-1",
        roster_student_id: committed.pins[0].rosterStudentId
      })
    ]);
    expect(state.student_access_codes[0].claimed_by).toBe("student-1");
    expect(state.roster_students[0].claimed_by).toBe("student-1");
  });

  it("normalizes spaced student course codes the same way teacher course writes do", async () => {
    const state = createState();
    const db = createDb(state);
    const csvText = [
      "display_name,student_identifier,email,section",
      "Student One,S-1,student1@example.com,2B"
    ].join("\n");
    const committed = await commitTeacherRosterImport(jsonRequest({ csvText }), env, db as never, "teacher-1", "class-1");

    const result = await studentLogin(
      jsonRequest({
        classCode: " bio 101 ",
        pin: committed.pins[0].pin
      }),
      env,
      db as never,
      "student-1",
      "student1@example.com"
    );

    expect(result.profile.classCode).toBe("BIO101");
    expect(state.student_access_codes[0].claimed_by).toBe("student-1");
  });

  it("reconciles every session through the verified-email transaction", async () => {
    const calls: unknown[] = [];
    const db = { async rpc(name: string, args: unknown) {
      calls.push({ name, args });
      return { data: { profile: null, status: "no_roster_match" }, error: null };
    } };
    await studentSession(db as never, "student-google", "untrusted@example.com");
    await studentSession(db as never, "student-google", "untrusted@example.com");
    expect(calls).toEqual(Array(2).fill({ name: "enroll_student_by_email", args: { p_user_id: "student-google" } }));
  });

  it("reports an enrollment transaction failure without returning a matched session", async () => {
    const db = { async rpc() { return { data: null, error: { code: "23514", message: "Claim conflict" } }; } };
    await expect(studentSession(db as never, "student-google")).rejects.toMatchObject({ status: 409 });
  });

  it("claims legacy class PINs without roster rows with the signed-in Google account", async () => {
    const state = createState();
    const db = createDb(state);
    await addAccessCode(state, {
      id: "legacy-code",
      classId: "class-2",
      pin: "333333",
      studentLabel: "Legacy Student"
    });

    const result = await studentLogin(
      jsonRequest({
        classCode: "CHEM101",
        pin: "333333"
      }),
      env,
      db as never,
      "student-google",
      "student@example.com"
    );

    expect(result.profile).toMatchObject({
      id: "student-google",
      displayName: "Legacy Student",
      email: "student@example.com",
      className: "Chemistry",
      classCode: "CHEM101"
    });
    expect(state.profiles).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "student-google",
        role: "student",
        display_name: "Legacy Student",
        email: "student@example.com"
      })
    ]));
    expect(state.class_memberships).toEqual([
      expect.objectContaining({
        class_id: "class-2",
        student_id: "student-google",
        display_name: "Legacy Student",
        roster_student_id: null
      })
    ]);
    expect(state.student_access_codes[0].claimed_by).toBe("student-google");
  });

  it("does not expose migration or procedure names when student login setup is unavailable", async () => {
    const db = {
      rpc: async () => ({
        data: null,
        error: {
          code: "PGRST202",
          message: "Could not find the function public.claim_student_google_login"
        }
      })
    };

    await expect(studentLogin(
      jsonRequest({ classCode: "BIO101", pin: "111111" }),
      env,
      db as never,
      "student-1",
      "student1@example.com"
    )).rejects.toMatchObject({
      status: 503,
      code: "student_login_unavailable",
      message: "Student login is temporarily unavailable. Ask your teacher to contact support."
    });
  });
});

describe("student Google login identity guard matrix", () => {
  it("keeps same-user same-pin same-course login idempotent", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(rosterRow({
      id: "roster-claimed",
      displayName: "Student One",
      studentIdentifier: "S-1",
      email: "student1@example.com",
      claimedBy: "student-1"
    }));
    await addAccessCode(state, { id: "code-claimed", classId: "class-1", pin: "111111", claimedBy: "student-1", rosterStudentId: "roster-claimed", studentLabel: "Student One" });
    state.class_memberships.push(membershipRow("membership-1", "class-1", "student-1", "Student One", "roster-claimed"));

    const result = await studentLogin(jsonRequest({ classCode: "BIO101", pin: "111111" }), env, db as never, "student-1", "student1@example.com");

    expect(result.profile.displayName).toBe("Student One");
    expect(state.class_memberships).toHaveLength(1);
    expect(state.student_access_codes).toHaveLength(1);
    expect(state.student_access_codes[0].claimed_by).toBe("student-1");
  });

  it("requires administrative reconciliation for a conflicting historical roster identity", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(rosterRow({
      id: "roster-claimed",
      displayName: "Student One",
      studentIdentifier: "S-1",
      email: "student1@example.com",
      claimedBy: "student-1"
    }));
    await addAccessCode(state, { id: "code-claimed", classId: "class-1", pin: "111111", claimedBy: "student-1", rosterStudentId: "roster-claimed", studentLabel: "Student One" });
    state.class_memberships.push(membershipRow("membership-stale", "class-1", "anon-1", "Student One", "roster-claimed"));
    state.profiles.push({ id: "anon-1", role: "student", display_name: "Student One", email: null });
    state.assessment_assignments.push({ id: "assignment-1", class_id: "class-1", assessment_id: "assessment-1" });
    state.attempts.push({ id: "attempt-1", student_id: "anon-1", assignment_id: "assignment-1", assessment_id: "assessment-1", updated_at: nowIso() });

    const before = snapshotGuardTables(state);
    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "111111" }), env, db as never, "student-1", "student1@example.com")).rejects.toMatchObject({ status: 409 });
    expect(snapshotGuardTables(state)).toEqual(before);
  });

  it("rejects same-user different-pin same-course login with structured conflict code and no mutations", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(
      rosterRow({ id: "roster-a", displayName: "Student A", studentIdentifier: "A-1", email: "a1@example.com", claimedBy: "student-1" }),
      rosterRow({ id: "roster-b", displayName: "Student B", studentIdentifier: "A-2", email: "a2@example.com" })
    );
    await addAccessCode(state, { id: "code-a", classId: "class-1", pin: "111111", claimedBy: "student-1", rosterStudentId: "roster-a", studentLabel: "Student A" });
    await addAccessCode(state, { id: "code-b", classId: "class-1", pin: "222222", rosterStudentId: "roster-b", studentLabel: "Student B" });
    state.class_memberships.push(membershipRow("membership-a", "class-1", "student-1", "Student A", "roster-a"));

    const before = snapshotGuardTables(state);

    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "222222" }), env, db as never, "student-1", "a2@example.com")).rejects.toMatchObject({
      status: 409,
      code: "same_course_identity_conflict"
    });

    expect(snapshotGuardTables(state)).toEqual(before);
  });

  it("rejects same-user different-pin same-course login even when roster identity matches", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(rosterRow({ id: "roster-a", displayName: "Student A", studentIdentifier: "A-1", email: "a1@example.com", claimedBy: "student-1" }));
    await addAccessCode(state, { id: "code-a", classId: "class-1", pin: "111111", claimedBy: "student-1", rosterStudentId: "roster-a", studentLabel: "Student A" });
    await addAccessCode(state, { id: "code-b", classId: "class-1", pin: "222222", rosterStudentId: "roster-a", studentLabel: "Student A" });
    state.class_memberships.push(membershipRow("membership-a", "class-1", "student-1", "Student A", "roster-a"));

    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "222222" }), env, db as never, "student-1", "a1@example.com")).rejects.toMatchObject({
      status: 409,
      code: "same_course_identity_conflict"
    });
  });

  it("rejects a Google email that does not match the roster email without mutations", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(rosterRow({ id: "roster-1", displayName: "Student One", studentIdentifier: "S-1", email: "student1@example.com", claimedBy: "student-1" }));
    await addAccessCode(state, { id: "code-claimed", classId: "class-1", pin: "111111", claimedBy: "student-1", rosterStudentId: "roster-1", studentLabel: "Student One" });

    const before = snapshotGuardTables(state);

    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "111111" }), env, db as never, "student-2", "other@example.com")).rejects.toMatchObject({
      status: 403,
      code: "roster_email_mismatch"
    });
    expect(snapshotGuardTables(state)).toEqual(before);
  });

  it("preserves historical evidence ownership when a different account presents a used PIN", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(
      rosterRow({ id: "roster-bio", classId: "class-1", displayName: "Student One", studentIdentifier: "S-1", email: "student1@example.com", claimedBy: "anon-1" }),
      rosterRow({ id: "roster-chem", classId: "class-2", displayName: "Student One", studentIdentifier: "S-1", email: "student1@example.com", claimedBy: "anon-1" })
    );
    await addAccessCode(state, { id: "bio-code", classId: "class-1", pin: "111111", claimedBy: "anon-1", rosterStudentId: "roster-bio", studentLabel: "Student One" });
    await addAccessCode(state, { id: "chem-code", classId: "class-2", pin: "333333", claimedBy: "anon-1", rosterStudentId: "roster-chem", studentLabel: "Student One" });
    state.class_memberships.push(
      membershipRow("membership-bio", "class-1", "anon-1", "Student One", "roster-bio"),
      membershipRow("membership-chem", "class-2", "anon-1", "Student One", "roster-chem")
    );
    state.assessment_assignments.push(
      { id: "assignment-bio", class_id: "class-1" },
      { id: "assignment-chem", class_id: "class-2" }
    );
    state.attempts.push(
      { id: "attempt-bio", assignment_id: "assignment-bio", student_id: "anon-1", updated_at: nowIso() },
      { id: "attempt-chem", assignment_id: "assignment-chem", student_id: "anon-1", updated_at: nowIso() }
    );
    state.attempt_artifacts.push(
      { id: "artifact-bio", attempt_id: "attempt-bio", student_id: "anon-1" },
      { id: "artifact-chem", attempt_id: "attempt-chem", student_id: "anon-1" }
    );
    state.attempt_realtime_sessions.push(
      { id: "session-bio", attempt_id: "attempt-bio", student_id: "anon-1", updated_at: nowIso() },
      { id: "session-chem", attempt_id: "attempt-chem", student_id: "anon-1", updated_at: nowIso() }
    );
    state.attempt_realtime_events.push(
      { id: "event-bio", attempt_id: "attempt-bio", student_id: "anon-1" },
      { id: "event-chem", attempt_id: "attempt-chem", student_id: "anon-1" }
    );

    const before = snapshotGuardTables(state);
    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "111111" }), env, db as never, "student-google", "student1@example.com")).rejects.toMatchObject({ status: 409 });
    expect(snapshotGuardTables(state)).toEqual(before);
  });

  it("allows the same Google user to claim an unclaimed PIN in a new course", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(
      rosterRow({ id: "roster-bio", classId: "class-1", displayName: "Student One", email: "student1@example.com", claimedBy: "student-1" }),
      rosterRow({ id: "roster-chem", classId: "class-2", displayName: "Student One", email: "student1@example.com" })
    );
    await addAccessCode(state, { id: "bio-code", classId: "class-1", pin: "111111", claimedBy: "student-1", rosterStudentId: "roster-bio", studentLabel: "Student One" });
    await addAccessCode(state, { id: "chem-code", classId: "class-2", pin: "444444", rosterStudentId: "roster-chem", studentLabel: "Student One" });
    state.class_memberships.push(membershipRow("membership-bio", "class-1", "student-1", "Student One", "roster-bio"));

    await studentLogin(jsonRequest({ classCode: "CHEM101", pin: "444444" }), env, db as never, "student-1", "student1@example.com");

    expect(state.class_memberships).toEqual(expect.arrayContaining([
      expect.objectContaining({ class_id: "class-1", student_id: "student-1" }),
      expect.objectContaining({ class_id: "class-2", student_id: "student-1" })
    ]));
    expect(state.student_access_codes.find((row) => row.id === "chem-code")?.claimed_by).toBe("student-1");
  });

  it("rejects roster PINs without an email until the roster is updated", async () => {
    const state = createState();
    const db = createDb(state);
    state.roster_students.push(rosterRow({ id: "roster-no-email", displayName: "Student One", email: null }));
    await addAccessCode(state, { id: "bio-code", classId: "class-1", pin: "111111", rosterStudentId: "roster-no-email", studentLabel: "Student One" });

    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "111111" }), env, db as never, "student-1", "student1@example.com")).rejects.toMatchObject({
      status: 403,
      code: "roster_email_required"
    });
  });

  it("does not downgrade an existing teacher profile during student Google login", async () => {
    const state = createState();
    const db = createDb(state);
    state.profiles.push({ id: "teacher-user", role: "teacher", display_name: "Teacher User", email: "teacher@example.com" });
    state.roster_students.push(rosterRow({ id: "roster-1", displayName: "Student One", email: "student1@example.com" }));
    await addAccessCode(state, { id: "bio-code", classId: "class-1", pin: "111111", rosterStudentId: "roster-1", studentLabel: "Student One" });

    await expect(studentLogin(jsonRequest({ classCode: "BIO101", pin: "111111" }), env, db as never, "teacher-user", "student1@example.com")).rejects.toMatchObject({
      status: 403,
      message: "Student Google sign-in required"
    });

    expect(state.profiles.find((row) => row.id === "teacher-user")).toEqual({
      id: "teacher-user",
      role: "teacher",
      display_name: "Teacher User",
      email: "teacher@example.com"
    });
    expect(state.class_memberships).toHaveLength(0);
    expect(state.student_access_codes.find((row) => row.id === "bio-code")?.claimed_by).toBeNull();
  });
});

type Row = Record<string, any>;

interface InMemoryState {
  profiles: Row[];
  classes: Row[];
  roster_students: Row[];
  student_access_codes: Row[];
  class_memberships: Row[];
  assessment_assignments: Row[];
  attempts: Row[];
  attempt_artifacts: Row[];
  attempt_realtime_sessions: Row[];
  attempt_realtime_events: Row[];
  gradebook_entries: Row[];
}

function createState(): InMemoryState {
  return {
    profiles: [{ id: "teacher-1", role: "teacher", display_name: "Teacher One", email: "teacher@example.com" }],
    classes: [
      { id: "class-1", code: "BIO101", name: "Biology", teacher_id: "teacher-1", created_at: nowIso(), updated_at: nowIso(), archived_at: null },
      { id: "class-2", code: "CHEM101", name: "Chemistry", teacher_id: "teacher-1", created_at: nowIso(), updated_at: nowIso(), archived_at: null }
    ],
    roster_students: [],
    student_access_codes: [],
    class_memberships: [],
    assessment_assignments: [],
    attempts: [],
    attempt_artifacts: [],
    attempt_realtime_sessions: [],
    attempt_realtime_events: [],
    gradebook_entries: []
  };
}

async function addAccessCode(
  state: InMemoryState,
  input: {
    id: string;
    classId: string;
    pin: string;
    claimedBy?: string | null;
    rosterStudentId?: string | null;
    studentLabel?: string | null;
  }
) {
  state.student_access_codes.push({
    id: input.id,
    class_id: input.classId,
    student_label: input.studentLabel ?? null,
    pin_hash: await hashPin(input.pin, env),
    claimed_by: input.claimedBy ?? null,
    claimed_at: input.claimedBy ? nowIso() : null,
    roster_student_id: input.rosterStudentId ?? null,
    created_at: nowIso(),
    updated_at: nowIso()
  });
}

function rosterRow(input: {
  id: string;
  classId?: string;
  displayName: string;
  studentIdentifier?: string | null;
  email?: string | null;
  claimedBy?: string | null;
}): Row {
  return {
    id: input.id,
    class_id: input.classId ?? "class-1",
    display_name: input.displayName,
    student_identifier: input.studentIdentifier ?? null,
    email: input.email ?? null,
    email_normalized: normalizeEmail(input.email),
    section: null,
    claimed_by: input.claimedBy ?? null,
    claimed_at: input.claimedBy ? nowIso() : null,
    created_at: nowIso(),
    updated_at: nowIso()
  };
}

function membershipRow(id: string, classId: string, studentId: string, displayName: string, rosterStudentId: string | null): Row {
  return {
    id,
    class_id: classId,
    student_id: studentId,
    display_name: displayName,
    roster_student_id: rosterStudentId,
    created_at: nowIso()
  };
}

function snapshotGuardTables(state: InMemoryState) {
  return JSON.parse(JSON.stringify({
    profiles: state.profiles,
    class_memberships: state.class_memberships,
    student_access_codes: state.student_access_codes,
    roster_students: state.roster_students,
    attempts: state.attempts,
    attempt_artifacts: state.attempt_artifacts,
    attempt_realtime_sessions: state.attempt_realtime_sessions,
    attempt_realtime_events: state.attempt_realtime_events
  }));
}

function createDb(state: InMemoryState) {
  return {
    from(table: keyof InMemoryState | "roster_students") {
      return new Query(table as string, state);
    },
    async rpc(name: string, args: Row) {
      if (name === "reconcile_course_gradebook") return reconcileFixture(state, args);
      if (name === "import_course_roster") {
        for (const row of args.p_rows) {
          state.roster_students.push(rosterRow({ id: row.id, classId: args.p_course_id, displayName: row.displayName, studentIdentifier: row.studentIdentifier, email: row.email }));
          state.student_access_codes.push({ id: `access-${state.student_access_codes.length}`, class_id: args.p_course_id, roster_student_id: row.id, student_label: row.displayName, pin_hash: row.pinHash, claimed_by: null, claimed_at: null });
        }
        return { data: args.p_rows.length, error: null };
      }
      if (name !== "claim_student_google_login") {
        return { data: null, error: { code: "PGRST202", message: `Unsupported RPC: ${name}` } };
      }
      return claimStudentGoogleLogin(state, args);
    }
  };
}

function claimStudentGoogleLogin(state: InMemoryState, args: Row): { data: Row[]; error: null } {
  const classRow = state.classes.find((row) => normalizeUpper(row.code) === normalizeUpper(args.p_class_code));
  if (!classRow) return claimResult("invalid_credentials");

  const access = state.student_access_codes.find((row) => row.class_id === classRow.id && row.pin_hash === args.p_pin_hash);
  if (!access) return claimResult("invalid_credentials");
  if (!access.roster_student_id) return claimResult("roster_email_required", classRow);

  const roster = state.roster_students.find((row) => row.id === access.roster_student_id);
  if (!roster || roster.class_id !== classRow.id) return claimResult("invalid_credentials");
  if (!roster.email) return claimResult("roster_email_required", classRow, roster);
  if (normalizeEmail(roster.email) !== normalizeEmail(args.p_email)) return claimResult("roster_email_mismatch", classRow, roster);

  const userId = args.p_user_id as string;
  const existingProfile = state.profiles.find((row) => row.id === userId);
  if (existingProfile?.role === "teacher") return claimResult("teacher_profile", classRow, roster);

  const sameCourseMembershipConflict = state.class_memberships.some((row) =>
    row.class_id === classRow.id &&
    row.student_id === userId &&
    row.roster_student_id !== roster.id
  );
  const sameCourseClaimConflict = state.student_access_codes.some((row) =>
    row.class_id === classRow.id &&
    row.claimed_by === userId &&
    row.id !== access.id
  );
  if (sameCourseMembershipConflict || sameCourseClaimConflict) {
    return claimResult("same_course_identity_conflict", classRow, roster);
  }

  const conflictingRosterMembership = state.class_memberships.find((row) =>
    row.class_id === classRow.id &&
    row.roster_student_id === roster.id &&
    row.student_id !== userId
  );
  const previousUserId = [access.claimed_by, roster.claimed_by, conflictingRosterMembership?.student_id]
    .find((value) => value && value !== userId) ?? null;
  if (previousUserId) return claimResult("same_course_identity_conflict", classRow, roster);

  if (existingProfile) {
    Object.assign(existingProfile, { role: "student", display_name: roster.display_name, email: normalizeEmail(args.p_email), updated_at: nowIso() });
  } else {
    state.profiles.push({ id: userId, role: "student", display_name: roster.display_name, email: normalizeEmail(args.p_email), created_at: nowIso(), updated_at: nowIso() });
  }

  const existingMembership = state.class_memberships.find((row) => row.class_id === classRow.id && row.student_id === userId);
  if (existingMembership) {
    Object.assign(existingMembership, { display_name: roster.display_name, roster_student_id: roster.id });
  } else {
    state.class_memberships.push(membershipRow(`membership-${state.class_memberships.length + 1}`, classRow.id, userId, roster.display_name, roster.id));
  }

  access.claimed_by = userId;
  access.claimed_at = access.claimed_at ?? nowIso();
  roster.claimed_by = userId;
  roster.claimed_at = roster.claimed_at ?? nowIso();
  roster.updated_at = nowIso();

  return claimResult("success", classRow, roster, previousUserId);
}

function claimResult(status: string, classRow?: Row, roster?: Row, previousUserId?: string | null): { data: Row[]; error: null } {
  return {
    data: [{
      claim_status: status,
      class_id: classRow?.id ?? null,
      class_code: classRow?.code ?? null,
      class_name: classRow?.name ?? null,
      roster_student_id: roster?.id ?? null,
      display_name: roster?.display_name ?? null,
      previous_user_id: previousUserId ?? null
    }],
    error: null
  };
}

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private insertPayload: Row | null = null;
  private updatePayload: Row | null = null;
  private includeNotNull: string[] = [];
  private executed = false;

  constructor(private table: string, private state: InMemoryState) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }

  ilike(key: string, value: string) {
    this.filters.push((row) => normalizeEmail(row[key]) === normalizeEmail(value));
    return this;
  }

  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]));
    return this;
  }

  not(key: string, operator: string, value: unknown) {
    if (operator === "is" && value === null) {
      this.includeNotNull.push(key);
    }
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return Promise.resolve({ data: this.rows().slice(0, 1), error: null });
  }

  insert(payload: Row) {
    this.insertPayload = { ...payload };
    return this;
  }

  update(payload: Row) {
    this.updatePayload = { ...payload };
    return this;
  }

  async upsert(payload: Row, options?: { onConflict?: string }) {
    const table = this.tableData();
    if (this.table === "class_memberships" && options?.onConflict === "class_id,student_id") {
      const existing = table.find((row) => row.class_id === payload.class_id && row.student_id === payload.student_id);
      if (existing) {
        Object.assign(existing, payload);
      } else {
        table.push({ ...payload, id: `membership-${table.length + 1}`, created_at: nowIso() });
      }
      return { error: null };
    }

    const existing = table.find((row) => row.id === payload.id);
    if (existing) {
      Object.assign(existing, payload);
    } else {
      table.push({ ...payload });
    }
    return { error: null };
  }

  async maybeSingle() {
    if (this.updatePayload) {
      const match = this.rows()[0];
      if (!match) return { data: null, error: null };
      Object.assign(match, this.updatePayload);
      return { data: match, error: null };
    }
    return { data: this.rows()[0] ?? null, error: null };
  }

  async single() {
    if (this.insertPayload) {
      const inserted = this.insertRow();
      if ("error" in inserted) return inserted;
      return { data: inserted.data, error: null };
    }
    return { data: this.rows()[0] ?? null, error: null };
  }

  then(resolve: (value: { data: unknown; error: any }) => void) {
    if (this.updatePayload) {
      this.rows().forEach((row) => Object.assign(row, this.updatePayload));
      resolve({ data: null, error: null });
      return;
    }

    if (this.insertPayload) {
      if (this.executed) {
        resolve({ data: null, error: null });
        return;
      }
      this.executed = true;
      const inserted = this.insertRow();
      if ("error" in inserted) {
        resolve({ data: null, error: inserted.error });
      } else {
        resolve({ data: null, error: null });
      }
      return;
    }

    resolve({ data: this.rows().map((row) => this.decorate(row)), error: null });
  }

  private insertRow(): { data: Row } | { error: { code: string; message: string } } {
    const table = this.tableData();
    const payload = this.insertPayload as Row;

    if (this.table === "roster_students") {
      const duplicateIdentifier = payload.student_identifier && table.some((row) =>
        row.class_id === payload.class_id &&
        normalizeUpper(row.student_identifier) === normalizeUpper(payload.student_identifier)
      );
      if (duplicateIdentifier) {
        return { error: { code: "23505", message: "duplicate identifier" } };
      }

      const duplicateEmail = payload.email && table.some((row) =>
        row.class_id === payload.class_id &&
        normalizeEmail(row.email) === normalizeEmail(payload.email)
      );
      if (duplicateEmail) {
        return { error: { code: "23505", message: "duplicate email" } };
      }
    }

    if (this.table === "student_access_codes") {
      const duplicatePinHash = table.some((row) => row.class_id === payload.class_id && row.pin_hash === payload.pin_hash);
      if (duplicatePinHash) {
        return { error: { code: "23505", message: "student_access_codes_class_id_pin_hash_key" } };
      }
      const duplicateRosterRow = payload.roster_student_id && table.some((row) => row.roster_student_id === payload.roster_student_id);
      if (duplicateRosterRow) {
        return { error: { code: "23505", message: "duplicate roster student" } };
      }
    }

    const inserted = {
      ...payload,
      id: payload.id ?? `${this.table}-${table.length + 1}`,
      email_normalized: this.table === "roster_students" ? normalizeEmail(payload.email) : payload.email_normalized,
      created_at: payload.created_at ?? nowIso(),
      updated_at: payload.updated_at ?? nowIso()
    };
    table.push(inserted);
    return { data: inserted };
  }

  private rows(): Row[] {
    const table = this.tableData();
    return table.filter((row) => {
      return this.filters.every((predicate) => predicate(row))
        && this.includeNotNull.every((key) => row[key] !== null && row[key] !== undefined);
    });
  }

  private decorate(row: Row): Row {
    if (this.table !== "assessment_assignments") return row;
    const course = this.state.classes.find((item) => item.id === row.class_id) ?? null;
    return {
      ...row,
      classes: course ? { code: course.code, name: course.name } : null,
      assessments: row.assessments ?? null
    };
  }

  private tableData(): Row[] {
    switch (this.table) {
      case "profiles":
        return this.state.profiles;
      case "classes":
        return this.state.classes;
      case "roster_students":
        return this.state.roster_students;
      case "student_access_codes":
        return this.state.student_access_codes;
      case "class_memberships":
        return this.state.class_memberships;
      case "assessment_assignments":
        return this.state.assessment_assignments;
      case "attempts":
        return this.state.attempts;
      case "attempt_artifacts":
        return this.state.attempt_artifacts;
      case "attempt_realtime_sessions":
        return this.state.attempt_realtime_sessions;
      case "attempt_realtime_events":
        return this.state.attempt_realtime_events;
      case "gradebook_entries":
        return this.state.gradebook_entries;
      default:
        throw new Error(`Unsupported table in test DB: ${this.table}`);
    }
  }
}

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/mock", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
}

function nowIso(): string {
  return "2026-01-01T00:00:00.000Z";
}

function normalizeUpper(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
