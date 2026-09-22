// Route-test boundary fixtures only. Transaction semantics and grants are tested
// against PostgreSQL in scripts/test-db, not by this in-memory fixture.
type Row = Record<string, any>;
export function reconcileFixture(state: Record<string, any>, args: Row) {
  const assignments = (state.assessment_assignments ?? []).filter((a: Row) => a.class_id === args.p_course_id && !a.archived_at);
  const students = (state.roster_students ?? []).filter((r: Row) => r.class_id === args.p_course_id && !r.deactivated_at);
  let insertedRows = 0;
  state.gradebook_entries ??= [];
  for (const a of assignments) for (const r of students) {
    if (state.gradebook_entries.some((e: Row) => e.assignment_id === a.id && e.roster_student_id === r.id)) continue;
    state.gradebook_entries.push({ id: `grade-${state.gradebook_entries.length}`, assignment_id: a.id, roster_student_id: r.id,
      approved_attempt_id: null, approved_score: null, approved_feedback: null, teacher_override_score: null, teacher_override_note: null,
      missing: false, published_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
    insertedRows++;
  }
  return { data: { insertedRows, touchedAssignments: assignments.length, touchedStudents: students.length }, error: null };
}
