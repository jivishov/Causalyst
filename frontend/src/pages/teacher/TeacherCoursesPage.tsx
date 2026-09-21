import { FormEvent, useEffect, useState } from "react";
import { Archive, BookOpen, ClipboardCheck, Download, Pencil, RotateCcw, Save, Trash2, Upload, Users } from "lucide-react";
import type { TeacherRosterImportCommitResponse, TeacherRosterImportPreviewResponse, TeacherRosterResponse } from "@alt-assessment/shared";
import { commitTeacherRosterImport, deleteTeacherRoster, listTeacherRoster, previewTeacherRosterImport } from "../../lib/api";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";

export function TeacherCoursesPage() {
  const {
    courses,
    selectedCourse,
    selectedCourseId,
    setSelectedCourseId,
    includeArchivedCourses,
    setIncludeArchivedCourses,
    loadingCourses,
    createCourse,
    updateCourseById,
    setCourseArchived,
    setError
  } = useTeacherWorkspaceData();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [section, setSection] = useState("");
  const [term, setTerm] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [rosterPreview, setRosterPreview] = useState<TeacherRosterImportPreviewResponse | null>(null);
  const [rosterCommit, setRosterCommit] = useState<TeacherRosterImportCommitResponse | null>(null);
  const [roster, setRoster] = useState<TeacherRosterResponse | null>(null);
  const [previewingRoster, setPreviewingRoster] = useState(false);
  const [committingRoster, setCommittingRoster] = useState(false);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [deletingRoster, setDeletingRoster] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const [showDeleteRosterPanel, setShowDeleteRosterPanel] = useState(false);
  const [rosterActionStatus, setRosterActionStatus] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const [exportFallbackCsv, setExportFallbackCsv] = useState<string | null>(null);
  const deleteConfirmationPhrase = selectedCourse ? `DELETE ${selectedCourse.code}` : "";

  useEffect(() => {
    if (!selectedCourseId) {
      setRoster(null);
      return;
    }
    refreshRoster(selectedCourseId).catch((err) => setError(err instanceof Error ? err.message : "Could not load roster"));
  }, [selectedCourseId]);

  async function refreshRoster(courseId: string) {
    setLoadingRoster(true);
    try {
      const rosterData = await listTeacherRoster(courseId);
      setRoster(rosterData);
    } finally {
      setLoadingRoster(false);
    }
  }

  async function submitCourse(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateCourseById(editingId, {
          code,
          name,
          section: section || null,
          term: term || null
        });
      } else {
        await createCourse({
          code,
          name,
          section: section || undefined,
          term: term || undefined
        });
      }
      resetCourseForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save course");
    } finally {
      setSaving(false);
    }
  }

  async function setArchived(courseId: string, archived: boolean) {
    const course = courses.find((item) => item.id === courseId);
    if (!course) return;
    setError(null);
    try {
      await setCourseArchived(course, archived);
      if (selectedCourseId === course.id) {
        await refreshRoster(course.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update course");
    }
  }

  function editCourse(courseId: string) {
    const course = courses.find((item) => item.id === courseId);
    if (!course) return;
    setEditingId(course.id);
    setCode(course.code);
    setName(course.name);
    setSection(course.section ?? "");
    setTerm(course.term ?? "");
  }

  function resetCourseForm() {
    setEditingId(null);
    setCode("");
    setName("");
    setSection("");
    setTerm("");
  }

  async function readCsvFile(file: File) {
    const content = await file.text();
    setCsvText(content);
    setCsvFileName(file.name);
    setRosterPreview(null);
    setRosterCommit(null);
    setExportStatus(null);
    setExportFallbackCsv(null);
    setRosterActionStatus(null);
    setShowDeleteRosterPanel(false);
  }

  async function previewRosterImport() {
    if (!selectedCourseId || !csvText.trim()) return;
    setPreviewingRoster(true);
    setError(null);
    try {
      const preview = await previewTeacherRosterImport(selectedCourseId, csvText);
      setRosterPreview(preview);
      setRosterCommit(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not preview roster import");
    } finally {
      setPreviewingRoster(false);
    }
  }

  async function commitRosterImport() {
    if (!selectedCourseId || !csvText.trim()) return;
    setCommittingRoster(true);
    setError(null);
    try {
      const committed = await commitTeacherRosterImport(selectedCourseId, csvText);
      setRosterCommit(committed);
      setRosterPreview(null);
      setCsvText("");
      setCsvFileName("");
      setExportStatus("Import complete. Export one-time PINs now.");
      setExportFallbackCsv(null);
      setRosterActionStatus(`Imported ${committed.createdCount} students and issued one-time PINs.`);
      await refreshRoster(selectedCourseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not import roster");
    } finally {
      setCommittingRoster(false);
    }
  }

  async function copyPins() {
    if (!rosterCommit) {
      setError("No PIN export is available to copy.");
      return;
    }
    const text = toPinCsv(rosterCommit);
    setExportStatus(null);
    setExportFallbackCsv(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        fallbackCopyToClipboard(text);
      }
      setExportStatus("PIN CSV copied to clipboard.");
    } catch {
      setExportFallbackCsv(text);
      setError("Could not copy to clipboard. Use the fallback CSV text below.");
    }
  }

  function downloadPins() {
    if (!rosterCommit) {
      setError("No PIN export is available to download.");
      return;
    }

    const csv = toPinCsv(rosterCommit);
    const filenameBase = selectedCourse?.code?.toLowerCase() || "course";
    const filename = `${filenameBase}-pins.csv`;
    setExportStatus(null);
    setExportFallbackCsv(null);

    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportStatus(`Downloaded ${filename}.`);
    } catch {
      setExportFallbackCsv(csv);
      setError("Download was blocked. Use the fallback CSV text below.");
    }
  }

  async function safeDeleteRoster() {
    if (!selectedCourseId || !selectedCourse) return;
    setDeletingRoster(true);
    setError(null);
    setRosterActionStatus(null);
    try {
      const result = await deleteTeacherRoster(selectedCourseId, deleteConfirmationInput);
      setDeleteConfirmationInput("");
      setCsvText("");
      setCsvFileName("");
      setRosterPreview(null);
      setRosterCommit(null);
      setExportStatus(null);
      setExportFallbackCsv(null);
      setRosterActionStatus(
        `Deleted ${result.deletedRosterStudents} unclaimed roster students and ${result.deletedAccessCodes} unclaimed PINs. Retained ${result.retainedClaimedStudents} claimed students.`
      );
      setShowDeleteRosterPanel(false);
      await refreshRoster(selectedCourseId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete roster");
    } finally {
      setDeletingRoster(false);
    }
  }

  return (
    <>
      <section className="course-editor">
        <h2>{editingId ? "Edit Course" : "Create Course"}</h2>
        <form className="course-form" onSubmit={submitCourse}>
          <label>
            Course code
            <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} autoComplete="off" placeholder="BIO101-S26" required />
          </label>
          <label>
            Course name
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
          </label>
          <label>
            Section
            <input value={section} onChange={(event) => setSection(event.target.value)} autoComplete="off" />
          </label>
          <label>
            Term
            <input value={term} onChange={(event) => setTerm(event.target.value)} autoComplete="off" placeholder="Spring 2026" />
          </label>
          <div className="control-row">
            <button className="primary-button" type="submit" disabled={saving}>
              <Save size={18} /> {saving ? "Saving" : editingId ? "Save changes" : "Create course"}
            </button>
            {editingId && <button className="secondary-button" type="button" onClick={resetCourseForm}>Cancel</button>}
          </div>
        </form>
      </section>

      <section className="course-list-panel">
        <div className="course-list-header">
          <h2>Courses</h2>
          <label className="checkbox-row">
            <input type="checkbox" checked={includeArchivedCourses} onChange={(event) => setIncludeArchivedCourses(event.target.checked)} />
            Show archived
          </label>
        </div>

        {loadingCourses ? (
          <p className="status-line">Loading courses</p>
        ) : courses.length === 0 ? (
          <div className="empty-state">
            <div>
              <BookOpen size={28} />
              <p>No courses yet.</p>
            </div>
          </div>
        ) : (
          <div className="course-list">
            {courses.map((course) => (
              <article key={course.id} className={`course-row ${course.id === selectedCourseId ? "selected-course" : ""}`}>
                <div>
                  <strong>{course.name}</strong>
                  <p>{course.code}{course.section ? ` · Section ${course.section}` : ""}{course.term ? ` · ${course.term}` : ""}</p>
                  {course.archivedAt && <span className="archive-badge">Archived</span>}
                </div>
                <div className="course-actions">
                  <button className="secondary-button" type="button" onClick={() => setSelectedCourseId(course.id)}>
                    <Users size={16} /> Roster
                  </button>
                  <button className="secondary-button" type="button" onClick={() => editCourse(course.id)}>
                    <Pencil size={16} /> Edit
                  </button>
                  {course.archivedAt ? (
                    <button className="secondary-button" type="button" onClick={() => setArchived(course.id, false)}>
                      <RotateCcw size={16} /> Unarchive
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" onClick={() => setArchived(course.id, true)}>
                      <Archive size={16} /> Archive
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="course-list-panel">
        <div className="course-list-header">
          <h2>Roster Import</h2>
          <label>
            Course
            <select value={selectedCourseId} onChange={(event) => setSelectedCourseId(event.target.value)} disabled={courses.length === 0}>
              {courses.length === 0 ? (
                <option value="">Create a course first</option>
              ) : (
                courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.code} · {course.name}</option>
                ))
              )}
            </select>
          </label>
        </div>

        <div className="roster-import-controls">
          <label className="secondary-button file-input-button">
            <Upload size={16} /> Select CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                readCsvFile(file).catch((err) => setError(err instanceof Error ? err.message : "Could not read CSV file"));
              }}
            />
          </label>
          <button className="secondary-button" type="button" onClick={previewRosterImport} disabled={!selectedCourseId || !csvText.trim() || previewingRoster}>
            <Users size={16} /> {previewingRoster ? "Previewing" : "Preview import"}
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={commitRosterImport}
            disabled={!selectedCourseId || !csvText.trim() || committingRoster || (rosterPreview !== null && rosterPreview.errors.length > 0)}
          >
            <Save size={16} /> {committingRoster ? "Importing" : "Commit import"}
          </button>
          <button
            className={showDeleteRosterPanel ? "danger-button" : "secondary-button"}
            type="button"
            onClick={() => {
              setShowDeleteRosterPanel((current) => !current);
              setDeleteConfirmationInput("");
              setError(null);
            }}
            disabled={!selectedCourse}
          >
            <Trash2 size={16} /> {showDeleteRosterPanel ? "Cancel delete" : "Delete roster"}
          </button>
        </div>

        {showDeleteRosterPanel && (
          <div className="roster-danger-block">
            <p className="field-error">Safe delete removes only unclaimed roster students and unclaimed PINs. Claimed students are always retained.</p>
            <label>
              Type <code>{deleteConfirmationPhrase || "DELETE <COURSE_CODE>"}</code> to confirm
              <input
                value={deleteConfirmationInput}
                onChange={(event) => setDeleteConfirmationInput(event.target.value)}
                placeholder={deleteConfirmationPhrase || "DELETE <COURSE_CODE>"}
                autoComplete="off"
                disabled={!selectedCourse}
              />
            </label>
            <button
              className="danger-button"
              type="button"
              onClick={safeDeleteRoster}
              disabled={!selectedCourse || deletingRoster || deleteConfirmationInput.trim().toUpperCase() !== deleteConfirmationPhrase.toUpperCase()}
            >
              <Trash2 size={16} /> {deletingRoster ? "Deleting" : "Delete unclaimed roster"}
            </button>
          </div>
        )}

        {csvFileName && <p className="status-line">Selected file: {csvFileName}</p>}
        {rosterActionStatus && <p className="status-line">{rosterActionStatus}</p>}

        {rosterPreview && (
          <div className="roster-preview-block">
            <p className="status-line">
              Preview: {rosterPreview.acceptedRows.length} accepted / {rosterPreview.totalRows} rows
            </p>
            {rosterPreview.errors.length > 0 && (
              <ul className="roster-error-list">
                {rosterPreview.errors.map((issue, index) => (
                  <li key={`${issue.rowNumber}-${issue.field}-${index}`}>Row {issue.rowNumber} ({issue.field}): {issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {rosterCommit && (
          <div className="roster-pins-panel">
            <div className="course-list-header">
              <p className="status-line">One-time PINs ({rosterCommit.createdCount})</p>
              <div className="course-actions">
                <button className="secondary-button" type="button" onClick={copyPins}>
                  <ClipboardCheck size={16} /> Copy CSV
                </button>
                <button className="secondary-button" type="button" onClick={downloadPins}>
                  <Download size={16} /> Download CSV
                </button>
              </div>
            </div>
            {exportStatus && <p className="status-line">{exportStatus}</p>}
            <p className="field-error">These plaintext PINs are shown once and are not recoverable after this view.</p>
            {exportFallbackCsv && (
              <label>
                Fallback CSV (manual copy)
                <textarea readOnly value={exportFallbackCsv} rows={8} />
              </label>
            )}
            <div className="roster-table">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Identifier</th>
                    <th>Email</th>
                    <th>Section</th>
                    <th>PIN</th>
                  </tr>
                </thead>
                <tbody>
                  {rosterCommit.pins.map((entry) => (
                    <tr key={entry.rosterStudentId}>
                      <td>{entry.displayName}</td>
                      <td>{entry.studentIdentifier ?? "-"}</td>
                      <td>{entry.email ?? "-"}</td>
                      <td>{entry.section ?? "-"}</td>
                      <td><code>{entry.pin}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <section className="course-list-panel">
        <div className="course-list-header">
          <h2>Roster</h2>
          {selectedCourse && <p>{selectedCourse.code}</p>}
        </div>
        {loadingRoster ? (
          <p className="status-line">Loading roster</p>
        ) : !selectedCourseId ? (
          <p className="status-line">Select a course to view roster status.</p>
        ) : !roster || roster.students.length === 0 ? (
          <div className="empty-state">
            <div>
              <Users size={28} />
              <p>No roster students yet.</p>
            </div>
          </div>
        ) : (
          <div className="roster-table">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Identifier</th>
                  <th>Email</th>
                  <th>Section</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {roster.students.map((student) => (
                  <tr key={student.id}>
                    <td>{student.displayName}</td>
                    <td>{student.studentIdentifier ?? "-"}</td>
                    <td>{student.email ?? "-"}</td>
                    <td>{student.section ?? "-"}</td>
                    <td>{student.claimed ? `Claimed${student.claimedAt ? ` (${new Date(student.claimedAt).toLocaleDateString()})` : ""}` : "Not claimed"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function toPinCsv(payload: TeacherRosterImportCommitResponse): string {
  const header = "display_name,student_identifier,email,section,pin";
  const rows = payload.pins.map((item) => [
    escapeCsvValue(item.displayName),
    escapeCsvValue(item.studentIdentifier ?? ""),
    escapeCsvValue(item.email ?? ""),
    escapeCsvValue(item.section ?? ""),
    escapeCsvValue(item.pin)
  ].join(","));
  return [header, ...rows].join("\n");
}

function escapeCsvValue(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function fallbackCopyToClipboard(text: string): void {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "true");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.focus();
  area.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(area);
  if (!copied) {
    throw new Error("Clipboard copy command failed");
  }
}
