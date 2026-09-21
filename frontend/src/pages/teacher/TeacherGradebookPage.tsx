import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleSlash,
  Download,
  Eraser,
  Hammer,
  ListChecks,
  RefreshCw,
  Send,
  Users
} from "lucide-react";
import { Link } from "react-router-dom";
import type { TeacherGradeExportFormat, TeacherGradebookEntry } from "@alt-assessment/shared";
import {
  clearTeacherGradebookGrade,
  exportTeacherGradebook,
  listTeacherGradebook,
  markTeacherGradebookMissing,
  publishTeacherGradebookEntry,
  rebuildTeacherGradebook,
  unpublishTeacherGradebookEntry
} from "../../lib/api";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";

export function TeacherGradebookPage() {
  const { courses, selectedCourseId, assignments, setError } = useTeacherWorkspaceData();
  const [courseFilter, setCourseFilter] = useState(selectedCourseId);
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [includeArchivedAssignments, setIncludeArchivedAssignments] = useState(false);
  const [includeInactiveStudents, setIncludeInactiveStudents] = useState(false);
  const [entries, setEntries] = useState<TeacherGradebookEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [entryActionId, setEntryActionId] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<TeacherGradeExportFormat>("long");
  const [exportIncludeUnpublished, setExportIncludeUnpublished] = useState(false);
  const [exportMissingAsZero, setExportMissingAsZero] = useState(false);
  const [exportAssignmentIds, setExportAssignmentIds] = useState<string[]>([]);
  const [columnOrderText, setColumnOrderText] = useState("");
  const [columnLabelsText, setColumnLabelsText] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewingExport, setPreviewingExport] = useState(false);
  const [downloadingExport, setDownloadingExport] = useState(false);
  const [availableColumnKeys, setAvailableColumnKeys] = useState<string[]>([]);
  const initializedCourseFilter = useRef(false);

  const assignmentOptions = useMemo(() => {
    return assignments.filter((assignment) => !courseFilter || assignment.classId === courseFilter);
  }, [assignments, courseFilter]);

  const localPreviewCount = useMemo(() => {
    const selectedSet = exportAssignmentIds.length > 0 ? new Set(exportAssignmentIds) : null;
    const filtered = entries
      .filter((entry) => !selectedSet || selectedSet.has(entry.assignmentId))
      .filter((entry) => exportIncludeUnpublished || Boolean(entry.publishedAt));
    if (exportFormat === "long") return filtered.length;
    return new Set(filtered.map((entry) => entry.rosterStudentId)).size;
  }, [entries, exportAssignmentIds, exportIncludeUnpublished, exportFormat]);

  const publishedCount = useMemo(
    () => entries.filter((entry) => Boolean(entry.publishedAt)).length,
    [entries]
  );

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
    setExportAssignmentIds((current) => current.filter((id) => assignmentOptions.some((assignment) => assignment.id === id)));
  }, [assignmentOptions]);

  useEffect(() => {
    setPreviewCount(null);
  }, [courseFilter, assignmentFilter, includeArchivedAssignments, includeInactiveStudents, exportFormat, exportIncludeUnpublished, exportMissingAsZero, exportAssignmentIds, columnOrderText, columnLabelsText]);

  useEffect(() => {
    if (!courseFilter && !assignmentFilter) {
      setEntries([]);
      return;
    }
    refreshGradebook().catch((err) => setError(err instanceof Error ? err.message : "Could not load gradebook"));
  }, [courseFilter, assignmentFilter, includeArchivedAssignments, includeInactiveStudents]);

  async function refreshGradebook() {
    if (!courseFilter && !assignmentFilter) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await listTeacherGradebook({
        courseId: courseFilter || undefined,
        assignmentId: assignmentFilter || undefined,
        includeArchivedAssignments,
        includeInactiveStudents
      });
      setEntries(response.entries);
    } finally {
      setLoading(false);
    }
  }

  async function rebuild() {
    if (!courseFilter) {
      setError("Choose a course before rebuilding the gradebook.");
      return;
    }
    setRebuilding(true);
    setError(null);
    try {
      await rebuildTeacherGradebook(courseFilter);
      await refreshGradebook();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not rebuild gradebook");
    } finally {
      setRebuilding(false);
    }
  }

  async function markMissing(entryId: string) {
    setEntryActionId(entryId);
    setError(null);
    try {
      await markTeacherGradebookMissing(entryId);
      await refreshGradebook();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark missing");
    } finally {
      setEntryActionId(null);
    }
  }

  async function clearGrade(entryId: string) {
    setEntryActionId(entryId);
    setError(null);
    try {
      await clearTeacherGradebookGrade(entryId);
      await refreshGradebook();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear grade");
    } finally {
      setEntryActionId(null);
    }
  }

  async function togglePublished(entry: TeacherGradebookEntry) {
    setEntryActionId(entry.id);
    setError(null);
    try {
      if (entry.publishedAt) {
        await unpublishTeacherGradebookEntry(entry.id);
      } else {
        await publishTeacherGradebookEntry(entry.id);
      }
      await refreshGradebook();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update publish state");
    } finally {
      setEntryActionId(null);
    }
  }

  function buildExportPayload(previewOnly: boolean) {
    const columns = parseColumnOrderText(columnOrderText);
    const columnLabels = parseColumnLabelsText(columnLabelsText);
    return {
      format: exportFormat,
      courseId: courseFilter,
      assignmentIds: exportAssignmentIds,
      includeUnpublished: exportIncludeUnpublished,
      missingMode: exportMissingAsZero ? "zero" as const : "blank" as const,
      columns,
      columnLabels,
      previewOnly
    };
  }

  async function previewExport() {
    if (!courseFilter) {
      setError("Choose a course before previewing export.");
      return;
    }
    setPreviewingExport(true);
    setError(null);
    try {
      const response = await exportTeacherGradebook(buildExportPayload(true));
      setPreviewCount(response.previewCount);
      setAvailableColumnKeys(response.columnKeys);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview export");
    } finally {
      setPreviewingExport(false);
    }
  }

  async function downloadExport() {
    if (!courseFilter) {
      setError("Choose a course before downloading export.");
      return;
    }
    setDownloadingExport(true);
    setError(null);
    try {
      const response = await exportTeacherGradebook(buildExportPayload(false));
      if (!response.csv) {
        throw new Error("Export returned no CSV data.");
      }

      setPreviewCount(response.previewCount);
      setAvailableColumnKeys(response.columnKeys);
      const blob = new Blob([response.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = response.filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not export gradebook");
    } finally {
      setDownloadingExport(false);
    }
  }

  return (
    <section className="gradebook-page">
      <div className="gradebook-header">
        <div>
          <h2>Gradebook</h2>
          <p>Review scores, publish status, and CSV export settings from one workspace.</p>
        </div>
        <div className="gradebook-summary" aria-label="Gradebook summary">
          <span><Users size={14} aria-hidden="true" /> {entries.length} rows</span>
          <span><CheckCircle2 size={14} aria-hidden="true" /> {publishedCount} published</span>
        </div>
      </div>

      <form className="gradebook-toolbar" onSubmit={(event) => event.preventDefault()}>
        <div className="gradebook-field">
          <label htmlFor="gradebook-course">Course</label>
          <select id="gradebook-course" value={courseFilter} onChange={(event) => setCourseFilter(event.target.value)}>
            <option value="">Choose a course</option>
            {courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code} · {course.name}
              </option>
            ))}
          </select>
        </div>
        <div className="gradebook-field">
          <label htmlFor="gradebook-assignment">Assignment</label>
          <select id="gradebook-assignment" value={assignmentFilter} onChange={(event) => setAssignmentFilter(event.target.value)}>
            <option value="">All assignments</option>
            {assignmentOptions.map((assignment) => (
              <option key={assignment.id} value={assignment.id}>
                {assignment.assessment.title} ({assignment.course.code})
              </option>
            ))}
          </select>
        </div>
        <div className="gradebook-toggles">
          <label className="gradebook-check">
            <input
              type="checkbox"
              checked={includeArchivedAssignments}
              onChange={(event) => setIncludeArchivedAssignments(event.target.checked)}
            />
            <span>Show archived assignments</span>
          </label>
          <label className="gradebook-check">
            <input
              type="checkbox"
              checked={includeInactiveStudents}
              onChange={(event) => setIncludeInactiveStudents(event.target.checked)}
            />
            <span>Show inactive students</span>
          </label>
        </div>
        <div className="gradebook-toolbar-actions">
          <button
            className="secondary-button gradebook-button"
            type="button"
            onClick={() => {
              refreshGradebook().catch((err) => setError(err instanceof Error ? err.message : "Could not load gradebook"));
            }}
            disabled={loading || (!courseFilter && !assignmentFilter)}
          >
            <RefreshCw size={16} aria-hidden="true" /> {loading ? "Loading" : "Refresh"}
          </button>
          <button className="secondary-button gradebook-button" type="button" onClick={rebuild} disabled={rebuilding || !courseFilter}>
            <Hammer size={16} aria-hidden="true" /> {rebuilding ? "Rebuilding" : "Rebuild"}
          </button>
        </div>
      </form>

      <div className="gradebook-export-panel">
        <div className="gradebook-export-heading">
          <div>
            <h3>Export</h3>
            <p>Choose rows, columns, and labels before downloading.</p>
          </div>
          <span className="gradebook-preview-count">Preview rows: {previewCount ?? localPreviewCount}</span>
        </div>
        <div className="gradebook-export-grid">
          <div className="gradebook-field">
            <label htmlFor="gradebook-export-format">Export format</label>
            <select id="gradebook-export-format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value as TeacherGradeExportFormat)}>
              <option value="long">Long (row per assignment)</option>
              <option value="wide">Wide (row per student)</option>
            </select>
          </div>
          <div className="gradebook-field gradebook-export-assignment">
            <label htmlFor="gradebook-export-assignments">Export assignments</label>
            <select
              id="gradebook-export-assignments"
              multiple
              size={Math.min(8, Math.max(3, assignmentOptions.length))}
              value={exportAssignmentIds}
              onChange={(event) => {
                const next = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
                setExportAssignmentIds(next);
              }}
            >
              {assignmentOptions.map((assignment) => (
                <option key={assignment.id} value={assignment.id}>
                  {assignment.assessment.title}
                </option>
              ))}
            </select>
          </div>
          <div className="gradebook-toggles gradebook-export-toggles">
            <label className="gradebook-check">
              <input
                type="checkbox"
                checked={exportIncludeUnpublished}
                onChange={(event) => setExportIncludeUnpublished(event.target.checked)}
              />
              <span>Include unpublished grades</span>
            </label>
            <label className="gradebook-check">
              <input
                type="checkbox"
                checked={exportMissingAsZero}
                onChange={(event) => setExportMissingAsZero(event.target.checked)}
              />
              <span>Missing as zero (default is blank)</span>
            </label>
          </div>
          <div className="gradebook-field">
            <label htmlFor="gradebook-column-order">Column order</label>
            <input
              id="gradebook-column-order"
              type="text"
              value={columnOrderText}
              onChange={(event) => setColumnOrderText(event.target.value)}
              placeholder="student_name,assignment_title,final_score"
            />
          </div>
          <div className="gradebook-field gradebook-column-labels">
            <label htmlFor="gradebook-column-labels">Column labels</label>
            <textarea
              id="gradebook-column-labels"
              className="compact-textarea"
              rows={4}
              value={columnLabelsText}
              onChange={(event) => setColumnLabelsText(event.target.value)}
              placeholder={"final_score=Score\nstudent_name=Student"}
            />
          </div>
        </div>
        <div className="gradebook-export-actions">
          <button className="secondary-button gradebook-button" type="button" onClick={previewExport} disabled={!courseFilter || previewingExport}>
            <ListChecks size={16} aria-hidden="true" />
            {previewingExport ? "Previewing..." : "Preview rows"}
          </button>
          <button className="primary-button gradebook-button" type="button" onClick={downloadExport} disabled={!courseFilter || downloadingExport}>
            <Download size={16} aria-hidden="true" /> {downloadingExport ? "Exporting..." : "Download CSV"}
          </button>
          {availableColumnKeys.length > 0 ? (
            <span className="gradebook-column-keys">Available columns: {availableColumnKeys.join(", ")}</span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <p className="status-line">Loading gradebook</p>
      ) : entries.length === 0 ? (
        <p className="status-line">No gradebook rows match the current filters.</p>
      ) : (
        <div className="roster-table gradebook-table">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Assessment</th>
                <th>Final</th>
                <th>Status</th>
                <th>Latest attempt</th>
                <th>Published</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.student.displayName}</td>
                  <td>{entry.assignment.assessmentTitle}</td>
                  <td>{typeof entry.finalScore === "number" ? entry.finalScore.toFixed(1) : "-"}</td>
                  <td>{entry.finalStatus}</td>
                  <td>
                    {entry.latestAttempt ? (
                      <Link className="text-button" to={`/teacher/review/${entry.latestAttempt.attemptId}`}>
                        {entry.latestAttempt.status}
                      </Link>
                    ) : "No attempt"}
                  </td>
                  <td>{entry.publishedAt ? new Date(entry.publishedAt).toLocaleDateString() : "No"}</td>
                  <td>
                    <div className="course-actions">
                      <button className="secondary-button gradebook-row-button missing" type="button" onClick={() => markMissing(entry.id)} disabled={entryActionId === entry.id}>
                        <CircleSlash size={15} aria-hidden="true" />
                        Missing
                      </button>
                      <button className="secondary-button gradebook-row-button clear" type="button" onClick={() => clearGrade(entry.id)} disabled={entryActionId === entry.id}>
                        <Eraser size={15} aria-hidden="true" />
                        Clear
                      </button>
                      <button className="secondary-button gradebook-row-button publish" type="button" onClick={() => togglePublished(entry)} disabled={entryActionId === entry.id}>
                        <Send size={15} aria-hidden="true" />
                        {entry.publishedAt ? "Unpublish" : "Publish"}
                      </button>
                    </div>
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

function parseColumnOrderText(text: string): string[] {
  return Array.from(new Set(
    text
      .split(/[,\n]/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
  ));
}

function parseColumnLabelsText(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt <= 0) continue;
    const key = trimmed.slice(0, splitAt).trim();
    const label = trimmed.slice(splitAt + 1).trim();
    if (!key || !label) continue;
    labels[key] = label;
  }
  return labels;
}
