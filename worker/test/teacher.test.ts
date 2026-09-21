import { afterEach, describe, expect, it, vi } from "vitest";
import { validateWorkerSecrets, type Env } from "../src/lib/env";
import { HttpError } from "../src/lib/http";
import {
  createTeacherCourse,
  listTeacherCourses,
  setTeacherCourseArchived,
  setupTeacher,
  teacherMe,
  teacherSetupStatus,
  updateTeacherCourse
} from "../src/routes/teacher";

const baseEnv: Env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  OPENAI_API_KEY: "openai-key",
  PIN_PEPPER: "dev-pepper",
  TEACHER_SETUP_CODE: "setup-code",
};

describe("teacher routes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports setup availability before a teacher exists", async () => {
    const db = makeDb([]);

    await expect(teacherSetupStatus(db as never)).resolves.toEqual({ setupAvailable: true });
  });

  it("rejects setup without the configured setup code", async () => {
    const db = makeDb([]);
    const request = jsonRequest({ setupCode: "wrong" });

    await expect(setupTeacher(request, baseEnv, db as never, "teacher-1", "token")).rejects.toMatchObject({
      status: 403,
      message: "Setup code was not accepted"
    });
  });

  it("creates only the first teacher profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email: "teacher@example.com" })));
    const db = makeDb([]);

    const first = await setupTeacher(jsonRequest({ setupCode: "setup-code", displayName: "Teacher One" }), baseEnv, db as never, "teacher-1", "token");
    expect(first.profile).toEqual({ id: "teacher-1", email: "teacher@example.com", displayName: "Teacher One" });

    await expect(setupTeacher(jsonRequest({ setupCode: "setup-code" }), baseEnv, db as never, "teacher-2", "token")).rejects.toMatchObject({
      status: 409,
      message: "Teacher setup has already been completed"
    });
  });

  it("allows only one concurrent first-teacher setup claim", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ email: "teacher@example.com" })));
    const db = makeDb([]);

    const results = await Promise.allSettled([
      setupTeacher(jsonRequest({ setupCode: "setup-code", displayName: "Teacher One" }), baseEnv, db as never, "teacher-1", "token"),
      setupTeacher(jsonRequest({ setupCode: "setup-code", displayName: "Teacher Two" }), baseEnv, db as never, "teacher-2", "token")
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({
      reason: expect.objectContaining({
        status: 409,
        message: "Teacher setup has already been completed"
      })
    });
  });

  it("rejects setup when the auth session has no teacher email", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    const db = makeDb([]);

    await expect(setupTeacher(jsonRequest({ setupCode: "setup-code" }), baseEnv, db as never, "teacher-1", "token")).rejects.toMatchObject({
      status: 403,
      message: "Teacher email session required"
    });
  });

  it("rejects non-teacher sessions for teacher me", async () => {
    const db = makeDb([{ id: "student-1", role: "student", display_name: "Student" }]);

    await expect(teacherMe(baseEnv, db as never, "student-1", "token")).rejects.toMatchObject({
      status: 403,
      message: "Teacher access required"
    });
  });

  it("lists only owned non-archived courses by default", async () => {
    const db = makeDb([
      { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
      { id: "teacher-2", role: "teacher", display_name: "Teacher Two" }
    ], [
      courseRow({ id: "course-1", teacher_id: "teacher-1", code: "BIO101", archived_at: null }),
      courseRow({ id: "course-2", teacher_id: "teacher-1", code: "BIO102", archived_at: "2026-01-01T00:00:00.000Z" }),
      courseRow({ id: "course-3", teacher_id: "teacher-2", code: "BIO103", archived_at: null })
    ]);

    await expect(listTeacherCourses(db as never, "teacher-1", false)).resolves.toEqual({
      courses: [expect.objectContaining({ id: "course-1", code: "BIO101" })]
    });
  });

  it("rejects updates to another teacher's course", async () => {
    const db = makeDb([
      { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
      { id: "teacher-2", role: "teacher", display_name: "Teacher Two" }
    ], [
      courseRow({ id: "course-1", teacher_id: "teacher-2", code: "BIO101", archived_at: null })
    ]);

    await expect(updateTeacherCourse(jsonRequest({ name: "New Name" }), db as never, "teacher-1", "course-1")).rejects.toMatchObject({
      status: 404,
      message: "Course not found"
    });
  });

  it("rejects archive changes to another teacher's course", async () => {
    const db = makeDb([
      { id: "teacher-1", role: "teacher", display_name: "Teacher One" },
      { id: "teacher-2", role: "teacher", display_name: "Teacher Two" }
    ], [
      courseRow({ id: "course-1", teacher_id: "teacher-2", code: "BIO101", archived_at: null })
    ]);

    await expect(setTeacherCourseArchived(db as never, "teacher-1", "course-1", true)).rejects.toMatchObject({
      status: 404,
      message: "Course not found"
    });
    await expect(listTeacherCourses(db as never, "teacher-2", false)).resolves.toEqual({
      courses: [expect.objectContaining({ id: "course-1", archivedAt: null })]
    });
  });

  it("archives and unarchives owned courses without deleting them", async () => {
    const db = makeDb([
      { id: "teacher-1", role: "teacher", display_name: "Teacher One" }
    ], [
      courseRow({ id: "course-1", teacher_id: "teacher-1", code: "BIO101", archived_at: null })
    ]);

    await expect(setTeacherCourseArchived(db as never, "teacher-1", "course-1", true)).resolves.toEqual({
      course: expect.objectContaining({ id: "course-1", archivedAt: expect.any(String) })
    });
    await expect(listTeacherCourses(db as never, "teacher-1", false)).resolves.toEqual({ courses: [] });
    await expect(listTeacherCourses(db as never, "teacher-1", true)).resolves.toEqual({
      courses: [expect.objectContaining({ id: "course-1", archivedAt: expect.any(String) })]
    });

    await expect(setTeacherCourseArchived(db as never, "teacher-1", "course-1", false)).resolves.toEqual({
      course: expect.objectContaining({ id: "course-1", archivedAt: null })
    });
    await expect(listTeacherCourses(db as never, "teacher-1", false)).resolves.toEqual({
      courses: [expect.objectContaining({ id: "course-1", archivedAt: null })]
    });
  });

  it("returns clear duplicate course-code conflicts", async () => {
    const db = makeDb([
      { id: "teacher-1", role: "teacher", display_name: "Teacher One" }
    ], [
      courseRow({ id: "course-1", teacher_id: "teacher-1", code: "BIO101", archived_at: null })
    ]);

    await expect(createTeacherCourse(jsonRequest({ code: "bio101", name: "Biology" }), db as never, "teacher-1")).rejects.toMatchObject({
      status: 409,
      message: "Course code is already taken. Try adding a term suffix such as BIO101-S26."
    });
  });

  it("requires course metadata migration when metadata columns are missing", async () => {
    const db = makeDb(
      [{ id: "teacher-1", role: "teacher", display_name: "Teacher One" }],
      [],
      { classesSelectError: { code: "42703", message: "column classes.section does not exist" } }
    );

    await expect(listTeacherCourses(db as never, "teacher-1", false)).rejects.toMatchObject({
      status: 409,
      message: "Course metadata requires database migration 0003_teacher_courses.sql"
    });
  });
});

describe("worker secret validation", () => {
  it("rejects weak production PIN_PEPPER values", () => {
    expect(() => validateWorkerSecrets({
      APP_ENV: "production",
      PIN_PEPPER: "dev-pepper",
      TEACHER_SETUP_CODE: "long-enough-setup-code",
      ALLOWED_ORIGINS: "https://app.example"
    })).toThrow(/PIN_PEPPER/);
  });

  it("rejects weak production TEACHER_SETUP_CODE values", () => {
    expect(() => validateWorkerSecrets({
      APP_ENV: "production",
      PIN_PEPPER: "production-pin-pepper-with-enough-entropy",
      TEACHER_SETUP_CODE: "change-me",
      ALLOWED_ORIGINS: "https://app.example"
    })).toThrow(/TEACHER_SETUP_CODE/);
  });

  it("rejects missing or blank production ALLOWED_ORIGINS", () => {
    const env = {
      APP_ENV: "prod",
      PIN_PEPPER: "production-pin-pepper-with-enough-entropy",
      TEACHER_SETUP_CODE: "teacher-setup-code-with-entropy"
    };

    expect(() => validateWorkerSecrets(env)).toThrow(/ALLOWED_ORIGINS/);
    expect(() => validateWorkerSecrets({ ...env, ALLOWED_ORIGINS: "   " })).toThrow(/ALLOWED_ORIGINS/);
  });

  it("allows production when strong secrets and ALLOWED_ORIGINS are configured", () => {
    expect(() => validateWorkerSecrets({
      APP_ENV: "production",
      PIN_PEPPER: "production-pin-pepper-with-enough-entropy",
      TEACHER_SETUP_CODE: "teacher-setup-code-with-entropy",
      ALLOWED_ORIGINS: "https://app.example"
    })).not.toThrow();
  });

  it("allows development PIN_PEPPER defaults", () => {
    expect(() => validateWorkerSecrets({ APP_ENV: "development", PIN_PEPPER: "dev-pepper" })).not.toThrow();
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("https://worker.test/api/teacher/setup", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" }
  });
}

function makeDb(
  initialRows: Array<{ id: string; role: string; display_name: string }>,
  initialCourses: CourseTestRow[] = [],
  options?: { classesSelectError?: { code?: string; message?: string; details?: string } }
) {
  const rows = [...initialRows];
  const courses = [...initialCourses];
  return {
    rpc(name: string, args: Record<string, unknown>) {
      if (name !== "claim_first_teacher") throw new Error(`Unexpected rpc ${name}`);
      return new ClaimFirstTeacherRpc(rows, args);
    },
    from(tableName: string) {
      if (tableName === "classes") return new ClassesQuery(courses, options?.classesSelectError ?? null);
      if (tableName !== "profiles") throw new HttpError(500, `Unexpected table ${tableName}`);
      return new ProfilesQuery(rows);
    }
  };
}

class ClaimFirstTeacherRpc {
  constructor(
    private rows: Array<{ id: string; role: string; display_name: string }>,
    private args: Record<string, unknown>
  ) {}

  async single() {
    if (this.rows.some((row) => row.role === "teacher")) {
      return { data: null, error: { code: "23505", message: "Teacher setup has already been completed" } };
    }
    const row = {
      id: this.args.p_user_id as string,
      role: "teacher",
      display_name: this.args.p_display_name as string
    };
    const existingIndex = this.rows.findIndex((item) => item.id === row.id);
    if (existingIndex >= 0) {
      this.rows[existingIndex] = { ...this.rows[existingIndex], ...row };
    } else {
      this.rows.push(row);
    }
    return { data: { id: row.id, display_name: row.display_name }, error: null };
  }
}

class ProfilesQuery {
  private filters: Array<[string, unknown]> = [];
  private maxRows: number | null = null;

  constructor(private rows: Array<{ id: string; role: string; display_name: string }>) {}

  select() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }

  async limit(maxRows: number) {
    this.maxRows = maxRows;
    return { data: this.matchingRows(), error: null };
  }

  async maybeSingle() {
    return { data: this.matchingRows()[0] ?? null, error: null };
  }

  async upsert(row: { id: string; role: string; display_name: string }) {
    const existingIndex = this.rows.findIndex((item) => item.id === row.id);
    if (existingIndex >= 0) {
      this.rows[existingIndex] = { ...this.rows[existingIndex], ...row };
    } else {
      this.rows.push(row);
    }
    return { error: null };
  }

  private matchingRows() {
    const matched = this.rows.filter((row) => this.filters.every(([key, value]) => row[key as keyof typeof row] === value));
    return this.maxRows === null ? matched : matched.slice(0, this.maxRows);
  }
}

interface CourseTestRow {
  id: string;
  teacher_id: string;
  code: string;
  name: string;
  section: string | null;
  term: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function courseRow(input: Partial<CourseTestRow> & Pick<CourseTestRow, "id" | "teacher_id" | "code" | "archived_at">): CourseTestRow {
  return {
    name: "Biology",
    section: null,
    term: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...input
  };
}

class ClassesQuery {
  private filters: Array<[string, unknown]> = [];
  private nullFilters: string[] = [];
  private pendingInsert: Partial<CourseTestRow> | null = null;
  private pendingUpdate: Partial<CourseTestRow> | null = null;

  constructor(
    private rows: CourseTestRow[],
    private classesSelectError: { code?: string; message?: string; details?: string } | null = null
  ) {}

  select() {
    return this;
  }

  order() {
    return this;
  }

  eq(key: string, value: unknown) {
    this.filters.push([key, value]);
    return this;
  }

  is(key: string, value: unknown) {
    if (value === null) this.nullFilters.push(key);
    return this;
  }

  insert(row: Partial<CourseTestRow>) {
    this.pendingInsert = row;
    return this;
  }

  update(row: Partial<CourseTestRow>) {
    this.pendingUpdate = row;
    return this;
  }

  async single() {
    if (!this.pendingInsert) return { data: null, error: null };
    if (this.rows.some((row) => row.code === this.pendingInsert?.code)) {
      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    const inserted = courseRow({
      id: `course-${this.rows.length + 1}`,
      teacher_id: this.pendingInsert.teacher_id as string,
      code: this.pendingInsert.code as string,
      name: this.pendingInsert.name as string,
      section: this.pendingInsert.section as string | null,
      term: this.pendingInsert.term as string | null,
      archived_at: null,
      updated_at: this.pendingInsert.updated_at as string
    });
    this.rows.push(inserted);
    return { data: inserted, error: null };
  }

  async maybeSingle() {
    const match = this.matchingRows()[0];
    if (!match || !this.pendingUpdate) return { data: match ?? null, error: null };
    if (this.pendingUpdate.code && this.rows.some((row) => row.id !== match.id && row.code === this.pendingUpdate?.code)) {
      return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    }
    Object.assign(match, this.pendingUpdate);
    return { data: match, error: null };
  }

  then(resolve: (value: { data: CourseTestRow[] | null; error: { code?: string; message?: string; details?: string } | null }) => void) {
    if (this.classesSelectError) {
      resolve({ data: null, error: this.classesSelectError });
      return;
    }
    resolve({ data: this.matchingRows(), error: null });
  }

  private matchingRows() {
    return this.rows.filter((row) => {
      return this.filters.every(([key, value]) => row[key as keyof CourseTestRow] === value)
        && this.nullFilters.every((key) => row[key as keyof CourseTestRow] === null);
    });
  }
}
