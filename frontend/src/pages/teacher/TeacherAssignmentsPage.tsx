import { FormEvent, useEffect, useMemo, useState } from "react";
import { Archive, CalendarRange, Pencil, RotateCcw } from "lucide-react";
import type { AssessmentType, TeacherAssignment } from "@alt-assessment/shared";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";

export function TeacherAssignmentsPage() {
  const {
    courses,
    selectedCourseId,
    assessments,
    assignments,
    includeArchivedAssignments,
    setIncludeArchivedAssignments,
    loadingAssignments,
    createAssignment,
    updateAssignmentById,
    setAssignmentArchived,
    setError
  } = useTeacherWorkspaceData();
  const activeAssessments = useMemo(
    () => assessments.filter((assessment) => !assessment.archivedAt),
    [assessments]
  );
  const [editingAssignmentId, setEditingAssignmentId] = useState<string | null>(null);
  const [assignmentAssessmentId, setAssignmentAssessmentId] = useState("");
  const [assignmentCourseId, setAssignmentCourseId] = useState("");
  const [assignmentOpensAt, setAssignmentOpensAt] = useState("");
  const [assignmentDueAt, setAssignmentDueAt] = useState("");
  const [assignmentSaving, setAssignmentSaving] = useState(false);

  useEffect(() => {
    if (activeAssessments.length === 0) {
      if (assignmentAssessmentId) setAssignmentAssessmentId("");
      return;
    }
    const activeIds = new Set(activeAssessments.map((item) => item.id));
    if (!assignmentAssessmentId || !activeIds.has(assignmentAssessmentId)) {
      setAssignmentAssessmentId(activeAssessments[0].id);
    }
  }, [assignmentAssessmentId, activeAssessments]);

  useEffect(() => {
    if (courses.length === 0) {
      if (assignmentCourseId) setAssignmentCourseId("");
      return;
    }
    const courseIds = new Set(courses.map((course) => course.id));
    if (assignmentCourseId && !courseIds.has(assignmentCourseId)) {
      setAssignmentCourseId(selectedCourseId || courses[0]?.id || "");
      return;
    }
    if (!assignmentCourseId) {
      setAssignmentCourseId(selectedCourseId || courses[0]?.id || "");
      return;
    }
    if (!editingAssignmentId && selectedCourseId && selectedCourseId !== assignmentCourseId && courseIds.has(selectedCourseId)) {
      setAssignmentCourseId(selectedCourseId);
    }
  }, [assignmentCourseId, courses, selectedCourseId, editingAssignmentId]);

  function beginEditAssignment(assignment: TeacherAssignment) {
    setEditingAssignmentId(assignment.id);
    setAssignmentAssessmentId(assignment.assessmentId);
    setAssignmentCourseId(assignment.classId);
    setAssignmentOpensAt(toDateTimeLocalValue(assignment.opensAt));
    setAssignmentDueAt(toDateTimeLocalValue(assignment.dueAt));
  }

  function resetAssignmentForm() {
    setEditingAssignmentId(null);
    setAssignmentAssessmentId(activeAssessments[0]?.id ?? "");
    setAssignmentCourseId(selectedCourseId || courses[0]?.id || "");
    setAssignmentOpensAt("");
    setAssignmentDueAt("");
  }

  async function submitAssignment(event: FormEvent) {
    event.preventDefault();
    setAssignmentSaving(true);
    setError(null);
    try {
      if (!assignmentAssessmentId) {
        throw new Error("Choose an assessment.");
      }
      if (!assignmentCourseId) {
        throw new Error("Choose a course.");
      }
      const payload = {
        assessmentId: assignmentAssessmentId,
        courseId: assignmentCourseId,
        opensAt: assignmentOpensAt ? new Date(assignmentOpensAt).toISOString() : null,
        dueAt: assignmentDueAt ? new Date(assignmentDueAt).toISOString() : null
      };
      if (editingAssignmentId) {
        await updateAssignmentById(editingAssignmentId, payload);
      } else {
        await createAssignment(payload);
      }
      resetAssignmentForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save assignment");
    } finally {
      setAssignmentSaving(false);
    }
  }

  async function toggleAssignmentArchived(assignmentId: string, archived: boolean) {
    const assignment = assignments.find((item) => item.id === assignmentId);
    if (!assignment) return;
    setError(null);
    try {
      await setAssignmentArchived(assignment, archived);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update assignment archive state");
    }
  }

  return (
    <section className="course-list-panel">
      <div className="course-list-header">
        <h2>Assignment Builder</h2>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={includeArchivedAssignments}
            onChange={(event) => setIncludeArchivedAssignments(event.target.checked)}
          />
          Show archived
        </label>
      </div>
      <form className="assignment-form" onSubmit={submitAssignment}>
        <label>
          Assessment
          <select value={assignmentAssessmentId} onChange={(event) => setAssignmentAssessmentId(event.target.value)} required>
            {activeAssessments.length === 0 ? (
              <option value="">Create an assessment first</option>
            ) : (
              activeAssessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>
                  {assessment.title} ({formatAssessmentTypeLabel(assessment.type)})
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          Course
          <select value={assignmentCourseId} onChange={(event) => setAssignmentCourseId(event.target.value)} required>
            {courses.length === 0 ? (
              <option value="">Create a course first</option>
            ) : (
              courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} · {course.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label>
          Opens at
          <input type="datetime-local" value={assignmentOpensAt} onChange={(event) => setAssignmentOpensAt(event.target.value)} />
        </label>
        <label>
          Due at
          <input type="datetime-local" value={assignmentDueAt} onChange={(event) => setAssignmentDueAt(event.target.value)} />
        </label>
        <div className="control-row">
          <button className="primary-button" type="submit" disabled={assignmentSaving || courses.length === 0 || activeAssessments.length === 0}>
            <CalendarRange size={16} /> {assignmentSaving ? "Saving" : editingAssignmentId ? "Save assignment" : "Create assignment"}
          </button>
          {editingAssignmentId && (
            <button className="secondary-button" type="button" onClick={resetAssignmentForm}>
              Cancel edit
            </button>
          )}
        </div>
      </form>

      {loadingAssignments ? (
        <p className="status-line">Loading assignments</p>
      ) : assignments.length === 0 ? (
        <p className="status-line">No assignments yet.</p>
      ) : (
        <div className="course-list">
          {assignments.map((assignment) => (
            <article key={assignment.id} className="course-row">
              <div>
                <strong>{assignment.assessment.title}</strong>
                <p>{assignment.course.code} · {assignment.course.name}</p>
                <p>
                  {assignment.opensAt ? `Opens ${new Date(assignment.opensAt).toLocaleString()}` : "Opens immediately"}
                  {" · "}
                  {assignment.dueAt ? `Due ${new Date(assignment.dueAt).toLocaleString()}` : "No due date"}
                </p>
                {assignment.archivedAt && <span className="archive-badge">Archived</span>}
              </div>
              <div className="course-actions">
                <button className="secondary-button" type="button" onClick={() => beginEditAssignment(assignment)}>
                  <Pencil size={16} /> Edit
                </button>
                {assignment.archivedAt ? (
                  <button className="secondary-button" type="button" onClick={() => toggleAssignmentArchived(assignment.id, false)}>
                    <RotateCcw size={16} /> Unarchive
                  </button>
                ) : (
                  <button className="secondary-button" type="button" onClick={() => toggleAssignmentArchived(assignment.id, true)}>
                    <Archive size={16} /> Archive
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatAssessmentTypeLabel(type: AssessmentType): string {
  if (type === "voice") return "Voice Message";
  if (type === "voice_realtime") return "Live Voice Assessment";
  if (type === "writing") return "Writing";
  return "Simulation";
}

function toDateTimeLocalValue(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
