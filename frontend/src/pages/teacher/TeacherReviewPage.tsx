import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { FileSearch, Filter } from "lucide-react";
import { Link } from "react-router-dom";
import type { TeacherAttemptReviewListItem } from "@alt-assessment/shared";
import { listTeacherAttempts } from "../../lib/api";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";

export function TeacherReviewPage() {
  const { courses, selectedCourseId, assignments, setError } = useTeacherWorkspaceData();
  const [courseFilter, setCourseFilter] = useState(selectedCourseId);
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | "draft" | "submitted" | "graded" | "error">("");
  const [studentFilter, setStudentFilter] = useState("");
  const [attempts, setAttempts] = useState<TeacherAttemptReviewListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const initializedCourseFilter = useRef(false);

  const assignmentOptions = useMemo(() => {
    return assignments.filter((assignment) => !courseFilter || assignment.classId === courseFilter);
  }, [assignments, courseFilter]);

  useEffect(() => {
    if (courseFilter && !courses.some((course) => course.id === courseFilter)) {
      setCourseFilter("");
    }
  }, [courseFilter, courses]);

  useEffect(() => {
    if (initializedCourseFilter.current) return;
    initializedCourseFilter.current = true;
    if (!courseFilter && selectedCourseId) {
      setCourseFilter(selectedCourseId);
    }
  }, [courseFilter, selectedCourseId]);

  useEffect(() => {
    if (assignmentFilter && !assignmentOptions.some((assignment) => assignment.id === assignmentFilter)) {
      setAssignmentFilter("");
    }
  }, [assignmentFilter, assignmentOptions]);

  useEffect(() => {
    refreshAttemptList().catch((err) => setError(err instanceof Error ? err.message : "Could not load attempts"));
  }, [courseFilter, assignmentFilter, statusFilter]);

  async function refreshAttemptList() {
    setLoading(true);
    setError(null);
    try {
      const response = await listTeacherAttempts({
        courseId: courseFilter || undefined,
        assignmentId: assignmentFilter || undefined,
        status: statusFilter || undefined,
        student: studentFilter.trim() || undefined
      });
      setAttempts(response.attempts);
    } catch (err) {
      setAttempts([]);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  async function submitFilters(event: FormEvent) {
    event.preventDefault();
    try {
      await refreshAttemptList();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load attempts");
    }
  }

  return (
    <section className="course-list-panel">
      <div className="course-list-header">
        <h2>Response Review</h2>
      </div>

      <form className="review-filters" onSubmit={submitFilters}>
        <label>
          Course
          <select value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
            <option value="">All owned courses</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} · {course.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assignment
          <select value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}>
            <option value="">All assignments</option>
            {assignmentOptions.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.assessment.title} ({assignment.course.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="graded">Graded</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label>
          Student
          <input
            value={studentFilter}
            onChange={(event) => setStudentFilter(event.target.value)}
            placeholder="Name or student ID"
          />
        </label>
        <div className="control-row">
          <button className="secondary-button" type="submit" disabled={loading}>
            <Filter size={16} /> {loading ? "Loading" : "Apply filters"}
          </button>
        </div>
      </form>

      {loading ? (
        <p className="status-line">Loading attempts</p>
      ) : attempts.length === 0 ? (
        <div className="empty-state">
          <div>
            <FileSearch size={28} />
            <p>No attempts match the current filters.</p>
          </div>
        </div>
      ) : (
        <div className="roster-table">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Assessment</th>
                <th>Course</th>
                <th>Status</th>
                <th>Score</th>
                <th>Flags</th>
                <th>Submitted</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.attemptId}>
                  <td>{attempt.student.displayName}</td>
                  <td>{attempt.assessmentTitle}</td>
                  <td>{attempt.course.code}</td>
                  <td>{attempt.status}</td>
                  <td>{typeof attempt.provisionalScore === "number" ? Math.round(attempt.provisionalScore) : "-"}</td>
                  <td>{attempt.reviewFlags.length > 0 ? attempt.reviewFlags.join(", ") : "-"}</td>
                  <td>{attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : "Not submitted"}</td>
                  <td>
                    <Link className="text-button" to={`/teacher/review/${attempt.attemptId}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
