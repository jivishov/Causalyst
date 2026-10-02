import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleSlash,
  Download,
  Eraser,
  Eye,
  Save,
  Send,
} from "lucide-react";
import { useParams } from "react-router-dom";
import type { TeacherAttemptReviewDetail } from "@alt-assessment/shared";
import { ReviewTimestamp } from "../../components/ReviewTimestamp";
import { RubricFeedback } from "../../components/RubricFeedback";
import { SimulationPreviewFrame } from "../../components/SimulationPreviewFrame";
import {
  approveTeacherAttemptScore,
  clearTeacherGradebookGrade,
  getTeacherArtifactDownload,
  getTeacherArtifactPreviewUrl,
  getTeacherAttemptDetail,
  markTeacherGradebookMissing,
  publishTeacherGradebookEntry,
  setTeacherGradebookOverride,
  unpublishTeacherGradebookEntry,
} from "../../lib/api";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";

export function TeacherAttemptReviewPage() {
  const { attemptId } = useParams();
  const { setError } = useTeacherWorkspaceData();
  const [attempt, setAttempt] = useState<TeacherAttemptReviewDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [simulationPreviewUrl, setSimulationPreviewUrl] = useState<
    string | null
  >(null);
  const [sketchPreviewUrl, setSketchPreviewUrl] = useState<string | null>(null);
  const [previewingArtifactId, setPreviewingArtifactId] = useState<
    string | null
  >(null);
  const [overrideScore, setOverrideScore] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [finalizing, setFinalizing] = useState(false);

  const simulationArtifact = useMemo(
    () =>
      attempt?.artifacts
        .slice()
        .reverse()
        .find(
          (artifact) =>
            artifact.kind === "simulation-derived" && artifact.previewPath,
        ),
    [attempt],
  );
  const sketchArtifact = useMemo(
    () =>
      attempt?.artifacts
        .slice()
        .reverse()
        .find(
          (artifact) =>
            artifact.kind === "simulation-sketch" && artifact.previewPath,
        ),
    [attempt],
  );

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);
    setAttempt(null);
    if (!attemptId) {
      setLoading(false);
      return;
    }

    getTeacherAttemptDetail(attemptId)
      .then((response) => {
        if (!mounted) return;
        setAttempt(response.attempt);
        setOverrideScore(
          typeof response.attempt.gradebookEntry?.teacherOverrideScore ===
            "number"
            ? String(response.attempt.gradebookEntry.teacherOverrideScore)
            : "",
        );
        setOverrideNote(
          response.attempt.gradebookEntry?.teacherOverrideNote ?? "",
        );
      })
      .catch((err) => {
        if (!mounted) return;
        setError(
          err instanceof Error ? err.message : "Could not load attempt review",
        );
      })
      .finally(() => {
        if (!mounted) return;
        setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [attemptId]);

  useEffect(() => {
    if (!simulationArtifact) {
      setSimulationPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    let revoked = false;
    setPreviewingArtifactId(simulationArtifact.id);
    getTeacherArtifactPreviewUrl(simulationArtifact.id)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        setSimulationPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return url;
        });
      })
      .catch((err) => {
        if (!revoked) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load simulation preview",
          );
        }
      })
      .finally(() => {
        if (!revoked) setPreviewingArtifactId(null);
      });
    return () => {
      revoked = true;
    };
  }, [simulationArtifact?.id]);

  useEffect(() => {
    if (!sketchArtifact) {
      setSketchPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
      return;
    }
    let revoked = false;
    setPreviewingArtifactId(sketchArtifact.id);
    getTeacherArtifactPreviewUrl(sketchArtifact.id)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        setSketchPreviewUrl((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return url;
        });
      })
      .catch((err) => {
        if (!revoked) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load simulation sketch",
          );
        }
      })
      .finally(() => {
        if (!revoked) setPreviewingArtifactId(null);
      });
    return () => {
      revoked = true;
    };
  }, [sketchArtifact?.id]);

  useEffect(() => {
    return () => {
      if (simulationPreviewUrl) URL.revokeObjectURL(simulationPreviewUrl);
    };
  }, [simulationPreviewUrl]);

  useEffect(() => {
    return () => {
      if (sketchPreviewUrl) URL.revokeObjectURL(sketchPreviewUrl);
    };
  }, [sketchPreviewUrl]);

  async function previewArtifact(artifactId: string) {
    setPreviewingArtifactId(artifactId);
    setError(null);
    try {
      const url = await getTeacherArtifactPreviewUrl(artifactId);
      const popup = window.open(url, "_blank", "noopener,noreferrer");
      if (!popup) {
        URL.revokeObjectURL(url);
        throw new Error(
          "Preview pop-up was blocked. Allow pop-ups for this site or use Download.",
        );
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 45_000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not preview artifact",
      );
    } finally {
      setPreviewingArtifactId(null);
    }
  }

  async function approveProvisional() {
    if (!attemptId) return;
    setFinalizing(true);
    setError(null);
    try {
      const response = await approveTeacherAttemptScore(attemptId);
      applyGradebookEntryUpdate(response.entry);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not approve provisional score",
      );
    } finally {
      setFinalizing(false);
    }
  }

  async function saveOverride() {
    if (!attempt?.gradebookEntry) return;
    const parsed = Number.parseFloat(overrideScore);
    if (!Number.isFinite(parsed)) {
      setError("Override score must be a valid number.");
      return;
    }
    if (parsed < 0 || parsed > 100) {
      setError("Override score must be between 0 and 100.");
      return;
    }
    setFinalizing(true);
    setError(null);
    try {
      const response = await setTeacherGradebookOverride(
        attempt.gradebookEntry.id,
        {
          score: parsed,
          note: overrideNote.trim() || undefined,
        },
      );
      applyGradebookEntryUpdate(response.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save override");
    } finally {
      setFinalizing(false);
    }
  }

  async function markMissing() {
    if (!attempt?.gradebookEntry) return;
    setFinalizing(true);
    setError(null);
    try {
      const response = await markTeacherGradebookMissing(
        attempt.gradebookEntry.id,
      );
      applyGradebookEntryUpdate(response.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not mark missing");
    } finally {
      setFinalizing(false);
    }
  }

  async function clearGrade() {
    if (!attempt?.gradebookEntry) return;
    setFinalizing(true);
    setError(null);
    try {
      const response = await clearTeacherGradebookGrade(
        attempt.gradebookEntry.id,
      );
      applyGradebookEntryUpdate(response.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear grade");
    } finally {
      setFinalizing(false);
    }
  }

  async function togglePublish() {
    if (!attempt?.gradebookEntry) return;
    setFinalizing(true);
    setError(null);
    try {
      const response = attempt.gradebookEntry.publishedAt
        ? await unpublishTeacherGradebookEntry(attempt.gradebookEntry.id)
        : await publishTeacherGradebookEntry(attempt.gradebookEntry.id);
      applyGradebookEntryUpdate(response.entry);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update publish state",
      );
    } finally {
      setFinalizing(false);
    }
  }

  function applyGradebookEntryUpdate(
    entry: NonNullable<TeacherAttemptReviewDetail["gradebookEntry"]>,
  ) {
    setAttempt((current) =>
      current ? { ...current, gradebookEntry: entry } : current,
    );
    setOverrideScore(
      typeof entry.teacherOverrideScore === "number"
        ? String(entry.teacherOverrideScore)
        : "",
    );
    setOverrideNote(entry.teacherOverrideNote ?? "");
  }

  async function downloadArtifact(
    artifactId: string,
    fallbackFilename: string,
  ) {
    setError(null);
    try {
      const { blob, filename } = await getTeacherArtifactDownload(artifactId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || fallbackFilename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
      document.body.removeChild(link);
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not download artifact",
      );
    }
  }

  if (loading) {
    return <p className="status-line">Loading attempt review</p>;
  }
  if (!attempt) {
    return <p className="status-line">Attempt not found.</p>;
  }

  return (
    <div className="page-stack teacher-attempt-review">
      <section className="course-list-panel review-attempt-header">
        <div className="course-list-header">
          <h2>{attempt.assessment.title}</h2>
          <p>
            {attempt.course.code} · {attempt.student.displayName}
          </p>
        </div>
        <div className="attempt-meta-grid teacher-attempt-summary-grid">
          <p>
            <strong>Status</strong>
            <span className={`review-status review-status-${attempt.status}`}>
              {attempt.status}
            </span>
          </p>
          <p>
            <strong>Submitted</strong>
            <ReviewTimestamp
              value={attempt.submittedAt}
              empty="Not submitted"
            />
          </p>
          <p>
            <strong>Last activity</strong>
            <ReviewTimestamp value={attempt.updatedAt ?? attempt.createdAt} />
          </p>
          <p>
            <strong>Provisional score</strong>{" "}
            {typeof attempt.provisionalScore === "number"
              ? Math.round(attempt.provisionalScore)
              : "-"}
          </p>
          <p>
            <strong>Review flags</strong>{" "}
            {attempt.reviewFlags.length > 0
              ? attempt.reviewFlags.join(", ")
              : "None"}
          </p>
        </div>
      </section>

      <div className="review-work-layout">
        <div className="review-work-column" aria-label="Student work">
          {attempt.legacyContextCapture && (
            <p className="overall-comment">
              This older attempt uses assessment context captured during
              migration. Its original prompt and rubric could not be
              reconstructed.
            </p>
          )}

          {attempt.realtimeEvents.length > 0 && (
            <details className="evidence-panel teacher-disclosure-panel">
              <summary>Realtime Voice Log</summary>
              <div className="realtime-log">
                {attempt.realtimeEvents.map((event) => (
                  <article
                    key={event.id}
                    className={`realtime-log-entry ${event.role ?? "status"}`}
                  >
                    <strong>
                      {formatRealtimeEventRole(event.role)} · {event.eventType}
                    </strong>
                    {event.text ? (
                      <p>{event.text}</p>
                    ) : (
                      <p>{new Date(event.createdAt).toLocaleString()}</p>
                    )}
                  </article>
                ))}
              </div>
            </details>
          )}

          {attempt.transcript && (
            <details className="evidence-panel teacher-disclosure-panel" open>
              <summary>Student transcript</summary>
              <p className="review-response-text">{attempt.transcript}</p>
            </details>
          )}

          {attempt.ocrText && (
            <details className="evidence-panel teacher-disclosure-panel" open>
              <summary>Student writing (OCR)</summary>
              <p className="review-response-text">{attempt.ocrText}</p>
            </details>
          )}

          {attempt.simulationDescription && (
            <details className="evidence-panel teacher-disclosure-panel" open>
              <summary>Student simulation description</summary>
              <p className="review-response-text">
                {attempt.simulationDescription}
              </p>
            </details>
          )}

          {simulationArtifact && (
            <section className="safe-preview-panel safe-preview-primary">
              <div className="safe-preview-header">
                <div>
                  <h2>Simulation Preview</h2>
                  <ReviewTimestamp value={simulationArtifact.createdAt} />
                </div>
                <div className="preview-actions">
                  {previewingArtifactId === simulationArtifact.id && (
                    <p className="status-line">Loading preview</p>
                  )}
                </div>
              </div>
              {simulationPreviewUrl ? (
                <SimulationPreviewFrame
                  artifactId={simulationArtifact.id}
                  src={simulationPreviewUrl}
                  title="Teacher simulation preview"
                  viewport={simulationArtifact.htmlViewport}
                />
              ) : (
                <div className="safe-preview-empty">Preview unavailable</div>
              )}
            </section>
          )}
          {sketchArtifact && (
            <section className="safe-preview-panel">
              <div className="safe-preview-header">
                <div>
                  <h2>Generated Sketch</h2>
                  <ReviewTimestamp value={sketchArtifact.createdAt} />
                </div>
                {previewingArtifactId === sketchArtifact.id && (
                  <p className="status-line">Loading sketch</p>
                )}
              </div>
              {sketchPreviewUrl ? (
                <img
                  className="sketch-preview-image"
                  src={sketchPreviewUrl}
                  alt="Generated simulation sketch"
                />
              ) : (
                <div className="safe-preview-empty">Sketch unavailable</div>
              )}
            </section>
          )}

          <section className="course-list-panel review-evidence-artifacts">
            <div className="course-list-header">
              <h2>Evidence Artifacts</h2>
            </div>
            {attempt.artifacts.length === 0 ? (
              <p className="status-line">
                No artifacts uploaded for this attempt.
              </p>
            ) : (
              <div className="roster-table">
                <table>
                  <thead>
                    <tr>
                      <th>Artifact</th>
                      <th>Created</th>
                      <th>State</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attempt.artifacts
                      .slice()
                      .reverse()
                      .map((artifact) => (
                        <tr key={artifact.id}>
                          <td className="review-artifact-file">
                            <strong>{artifact.originalFilename}</strong>
                            <small>{artifact.kind}</small>
                            <small>
                              {artifact.mimeType} ·{" "}
                              {formatBytes(artifact.byteSize)}
                            </small>
                          </td>
                          <td>
                            <ReviewTimestamp value={artifact.createdAt} />
                          </td>
                          <td>{artifact.uploadState}</td>
                          <td>
                            <div className="course-actions">
                              {artifact.previewPath && (
                                <button
                                  className="secondary-button"
                                  type="button"
                                  onClick={() => previewArtifact(artifact.id)}
                                  disabled={
                                    artifact.uploadState !== "uploaded" ||
                                    previewingArtifactId === artifact.id
                                  }
                                >
                                  <Eye size={14} /> Preview
                                </button>
                              )}
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={() =>
                                  downloadArtifact(
                                    artifact.id,
                                    artifact.originalFilename,
                                  )
                                }
                                disabled={artifact.uploadState !== "uploaded"}
                              >
                                <Download size={14} /> Download
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
          {attempt.realtimeTrust && (
            <details className="evidence-panel teacher-disclosure-panel">
              <summary>Live session telemetry</summary>
              <div className="attempt-meta-grid">
                <p>
                  <strong>Continuity score:</strong>{" "}
                  {attempt.realtimeTrust.score}
                </p>
                <p>
                  <strong>Level:</strong> {attempt.realtimeTrust.level}
                </p>
                <p>
                  <strong>Sessions:</strong>{" "}
                  {attempt.realtimeTrust.history.length}
                </p>
                <p>
                  <strong>Flags:</strong>{" "}
                  {attempt.realtimeTrust.flags.length > 0
                    ? attempt.realtimeTrust.flags.join(", ")
                    : "None"}
                </p>
              </div>
              <p className="overall-comment">
                Browser telemetry describes connection continuity. It does not
                authenticate speech or establish answer quality. Grading uses
                the server transcript.
              </p>
              {attempt.realtimeTrust.history.length > 0 && (
                <div className="realtime-log">
                  {attempt.realtimeTrust.history.map((history) => (
                    <article
                      key={history.sessionId}
                      className="realtime-log-entry status"
                    >
                      <strong>
                        Session {history.sessionId.slice(0, 8)} ·{" "}
                        {history.status} · score {history.score}
                      </strong>
                      <p>
                        Events {history.eventCount} · Student turns{" "}
                        {history.studentTurnCount} · Assistant turns{" "}
                        {history.assistantTurnCount} · Gaps {history.gapCount} ·
                        Duplicates {history.duplicateCount}
                      </p>
                      <p>
                        Started {new Date(history.startedAt).toLocaleString()}
                        {history.endedAt
                          ? ` · Ended ${new Date(history.endedAt).toLocaleString()}`
                          : ""}
                      </p>
                      {history.flags.length > 0 && (
                        <p>Flags: {history.flags.join(", ")}</p>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </details>
          )}
        </div>
        <aside className="review-grading-column" aria-label="Grading">
          <section className="course-list-panel teacher-final-grade-panel">
            <div className="course-list-header">
              <h2>Final Grade</h2>
            </div>
            {attempt.gradebookEntry ? (
              <>
                <div className="attempt-meta-grid">
                  <p>
                    <strong>Final status:</strong>{" "}
                    {attempt.gradebookEntry.finalStatus}
                  </p>
                  <p>
                    <strong>Final score:</strong>{" "}
                    {typeof attempt.gradebookEntry.finalScore === "number"
                      ? attempt.gradebookEntry.finalScore.toFixed(1)
                      : "-"}
                  </p>
                  <p>
                    <strong>Published:</strong>{" "}
                    {attempt.gradebookEntry.publishedAt
                      ? new Date(
                          attempt.gradebookEntry.publishedAt,
                        ).toLocaleString()
                      : "No"}
                  </p>
                  <p>
                    <strong>Approved attempt:</strong>{" "}
                    {attempt.gradebookEntry.approvedAttemptId
                      ? attempt.gradebookEntry.approvedAttemptId ===
                        attempt.attemptId
                        ? "This response"
                        : "Another response"
                      : "-"}
                  </p>
                </div>
                <div className="assignment-form teacher-final-grade-form">
                  <label>
                    Override score
                    <input
                      value={overrideScore}
                      onChange={(event) => setOverrideScore(event.target.value)}
                      inputMode="decimal"
                      placeholder="0-100"
                    />
                  </label>
                  <label>
                    Override note
                    <input
                      value={overrideNote}
                      onChange={(event) => setOverrideNote(event.target.value)}
                      placeholder="Optional note"
                    />
                  </label>
                  <div className="teacher-final-grade-actions assessment-span-full">
                    <div className="teacher-final-grade-action-row teacher-final-grade-action-row-primary">
                      <button
                        className="primary-button"
                        type="button"
                        onClick={approveProvisional}
                        disabled={
                          finalizing ||
                          typeof attempt.provisionalScore !== "number"
                        }
                      >
                        <CheckCircle2 size={16} />
                        Approve provisional
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={saveOverride}
                        disabled={finalizing}
                      >
                        <Save size={16} />
                        Save override
                      </button>
                    </div>
                    <div className="teacher-final-grade-action-row teacher-final-grade-action-row-secondary">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={markMissing}
                        disabled={finalizing}
                      >
                        <CircleSlash size={16} />
                        Mark missing
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={clearGrade}
                        disabled={finalizing}
                      >
                        <Eraser size={16} />
                        Clear
                      </button>
                      <button
                        className="primary-button"
                        type="button"
                        onClick={togglePublish}
                        disabled={finalizing}
                      >
                        <Send size={16} />
                        {attempt.gradebookEntry.publishedAt
                          ? "Unpublish"
                          : "Publish"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="status-line">
                Gradebook entry is unavailable for this attempt.
              </p>
            )}
          </section>

          <details className="evidence-panel teacher-disclosure-panel review-rubric">
            <summary>Rubric &amp; provisional feedback</summary>
            <RubricFeedback
              feedback={attempt.provisionalFeedback}
              rubric={attempt.assessment.rubric}
            />
          </details>
        </aside>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatRealtimeEventRole(
  role: TeacherAttemptReviewDetail["realtimeEvents"][number]["role"],
): string {
  if (role === "student") return "Student";
  if (role === "assistant") return "GPT";
  if (role === "system") return "System";
  return "Status";
}
