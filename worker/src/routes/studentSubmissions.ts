import type { AssessmentSummary, StudentSubmissionSummary } from "@alt-assessment/shared";
import type { AppDatabaseClient } from "../lib/database";
import { loadPublishedGradeByAssignmentId } from "../lib/db";
import { HttpError } from "../lib/http";

const PAGE_SIZE = 500;
const SUBMITTED_FILTER = "status.eq.submitted,status.eq.graded,submitted_at.not.is.null";

interface SubmissionRow {
  id: string;
  assignment_id: string | null;
  status: StudentSubmissionSummary["status"];
  submitted_at: string | null;
  provisional_score: number | null;
  submitted_after_due?: boolean | null;
  created_at: string;
  assessment_versions: { definition: unknown } | null;
  assessments: StudentSubmissionSummary["assessment"];
  assessment_assignments: { id: string; class_id: string; classes: { code: string; name: string } | null } | null;
}

// Submission history belongs to the student, independently of active assignments
// and the latest draft. Never use an assignment or course filter for this query.
export async function listStudentSubmissions(db: AppDatabaseClient, userId: string): Promise<{ submissions: StudentSubmissionSummary[] }> {
  const rows: SubmissionRow[] = [];
  let includeLateMetadata = true;
  for (let offset = 0; ;) {
    const select = [
      "id", "assignment_id", "status", "submitted_at", "provisional_score", "created_at",
      ...(includeLateMetadata ? ["submitted_after_due"] : []),
      "assessment_versions(definition)", "assessments(id,type,title)",
      "assessment_assignments(id,class_id,classes(code,name))"
    ].join(",");
    const { data, error } = await db.from("attempts")
      .select(select)
      .eq("student_id", userId)
      .neq("status", "draft")
      .or(SUBMITTED_FILTER)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (includeLateMetadata && /submitted_after_due/.test(error.message)) {
        includeLateMetadata = false;
        continue;
      }
      throw new HttpError(500, "Could not load saved submissions. Please try again.", error.message);
    }
    const page = (data ?? []) as unknown as SubmissionRow[];
    rows.push(...page);
    // Hosted projects may cap PostgREST below the requested page size. Advance
    // by the rows actually returned, and stop only at an empty page.
    if (page.length === 0) break;
    offset += page.length;
  }

  const assignments = new Map<string, { id: string; class_id: string }>();
  for (const row of rows) {
    if (row.assessment_assignments) assignments.set(row.assessment_assignments.id, row.assessment_assignments);
  }
  const publishedGrades = await loadPublishedGradeByAssignmentId(db, userId, [...assignments.values()]);
  return {
    submissions: rows.map(row => {
      const assignment = row.assessment_assignments;
      return {
        attemptId: row.id,
        assignmentId: row.assignment_id,
        classId: assignment?.class_id ?? null,
        classCode: assignment?.classes?.code ?? null,
        className: assignment?.classes?.name ?? null,
        createdAt: row.created_at,
        status: row.status,
        submittedAt: row.submitted_at,
        provisionalScore: row.provisional_score,
        submittedAfterDue: row.submitted_after_due === true,
        assessment: submissionAssessment(row.assessment_versions?.definition) ?? submissionAssessment(row.assessments),
        publishedGrade: row.assignment_id ? publishedGrades.get(row.assignment_id) ?? null : null
      };
    })
  };
}

function submissionAssessment(value: unknown): StudentSubmissionSummary["assessment"] {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.title !== "string"
    || !["simulation", "writing", "voice", "voice_realtime"].includes(String(row.type))) return null;
  // Frozen definitions can contain an expected answer. Return only display fields.
  return { id: row.id, title: row.title, type: row.type as AssessmentSummary["type"] };
}
