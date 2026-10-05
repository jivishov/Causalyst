import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { Database } from "../src/lib/database";
import { listStudentSubmissions } from "../src/routes/studentSubmissions";

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, student_id: "student-1", assignment_id: "archived-assignment",
    status: "submitted", submitted_at: "2026-10-01T12:00:00Z", provisional_score: null,
    submitted_after_due: false, created_at: "2026-10-01T10:00:00Z",
    assessment_versions: { definition: { id: "assessment-1", type: "simulation", title: "Original assessment title",
      expected_answer: "PRIVATE-ANSWER", config: { secret: "PRIVATE-CONFIG" } } },
    assessments: { id: "assessment-1", type: "simulation", title: "Edited assessment title" },
    assessment_assignments: { id: "archived-assignment", class_id: "class-1", archived_at: "2026-10-02T10:00:00Z",
      classes: { name: "Chemistry", code: "CHEM" } }, ...overrides
  };
}

function fixture(rows: ReturnType<typeof row>[], cap = 500) {
  const queries: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    queries.push(url);
    const table = url.pathname.split("/").pop();
    let data: unknown[] = [];
    if (table === "attempts") {
      expect(url.searchParams.get("student_id")).toBe("eq.student-1");
      expect(url.searchParams.get("status")).toBe("neq.draft");
      expect(url.searchParams.get("or")).toBe("(status.eq.submitted,status.eq.graded,submitted_at.not.is.null)");
      expect(url.searchParams.get("order")).toBe("created_at.desc,id.desc");
      expect(url.searchParams.has("assignment_id")).toBe(false);
      const matching = rows.filter(item => item.student_id === "student-1" && item.status !== "draft"
        && (item.status === "submitted" || item.status === "graded" || item.submitted_at !== null));
      const offset = Number(url.searchParams.get("offset") ?? 0);
      data = matching.slice(offset, offset + Math.min(cap, Number(url.searchParams.get("limit") ?? cap)));
    } else if (table === "class_memberships") {
      expect(url.searchParams.get("student_id")).toBe("eq.student-1");
      data = [{ class_id: "class-1", roster_student_id: "roster-1" }];
    } else if (table === "gradebook_entries") {
      data = [{ assignment_id: "archived-assignment", roster_student_id: "roster-1",
        published_at: "2026-10-03T10:00:00Z", approved_score: null, approved_feedback: null,
        teacher_override_score: 90, missing: false }];
    }
    return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
  });
  const db = createClient<Database>("https://database.test", "synthetic", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch }
  });
  return { db, queries };
}

describe("student submission history", () => {
  it("keeps earlier and archived submissions, frozen titles and legacy attempts while excluding drafts and other students", async () => {
    const { db } = fixture([
      row("older"), row("newer"),
      row("draft", { status: "draft", submitted_at: null }),
      row("unsubmitted-error", { status: "error", submitted_at: null }),
      row("submitted-error", { status: "error" }),
      row("other-student", { student_id: "student-2" }),
      row("legacy", { assignment_id: null, assessment_assignments: null }),
      row("legacy-without-timestamp", { submitted_at: null })
    ]);
    const result = await listStudentSubmissions(db, "student-1");
    expect(result.submissions.map(item => item.attemptId)).toEqual(["older", "newer", "submitted-error", "legacy", "legacy-without-timestamp"]);
    expect(result.submissions[0]).toMatchObject({
      assessment: { title: "Original assessment title" }, className: "Chemistry",
      publishedGrade: { finalScore: 90, finalStatus: "teacher_override" }
    });
    expect(result.submissions.find(item => item.attemptId === "legacy")).toMatchObject({ assignmentId: null, classId: null, publishedGrade: null });
    expect(JSON.stringify(result)).not.toContain("PRIVATE-");
    expect(JSON.stringify(result)).not.toContain("student_id");
  });

  it("reads every page when the database caps responses below the requested page size", async () => {
    const { db, queries } = fixture(Array.from({ length: 8 }, (_, i) => row("saved-" + i)), 3);
    const result = await listStudentSubmissions(db, "student-1");
    expect(result.submissions).toHaveLength(8);
    expect(queries.filter(url => url.pathname.endsWith("/attempts")).map(url => url.searchParams.get("offset"))).toEqual(["0", "3", "6", "8"]);
  });

  it("reports a failed history query instead of returning an empty history", async () => {
    const db = createClient<Database>("https://database.test", "synthetic", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => new Response(JSON.stringify({ message: "Database unavailable" }), {
        status: 403, headers: { "Content-Type": "application/json" }
      }) }
    });
    await expect(listStudentSubmissions(db, "student-1")).rejects.toMatchObject({ status: 500 });
  });
});
