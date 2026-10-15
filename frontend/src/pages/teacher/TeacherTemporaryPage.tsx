import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  TemporaryAssignment,
  TemporaryReport,
  TemporaryRevision,
} from "@alt-assessment/shared";
import { temporaryApi } from "../../lib/temporaryApi";
import {
  buildTemporaryReport,
  buildEvidenceZip,
  downloadEvidence,
  escapeHtml,
} from "../../lib/temporaryReports";
import { temporaryExportParticipants } from "../../lib/temporaryNavigation";
import "../../temporary.css";

interface Detail {
  assignment: TemporaryAssignment;
  participants: Array<{
    id: string;
    code: string;
    hasDraft: boolean;
    draftVersion: number;
  }>;
  revisions: TemporaryRevision[];
}
interface Invitation {
  email: string;
  active: boolean;
  redeemed: boolean;
}
interface ManagedActivity {
  id: string;
  teacherEmail: string;
  expiresAt: string;
}
export function TeacherTemporaryPage() {
  const [params, setParams] = useSearchParams(),
    [activities, setActivities] = useState<TemporaryAssignment[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [assessments, setAssessments] = useState<
      Array<{ id: string; title: string; type: string }>
    >([]),
    [assessmentId, setAssessmentId] = useState(""),
    [hours, setHours] = useState(72),
    [retentionOptions, setRetentionOptions] = useState([24, 48, 72]),
    [closes, setCloses] = useState(
      new Date(
        Date.now() + 12 * 3600000 - new Date().getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16),
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [count, setCount] = useState(30),
    [links, setLinks] = useState<
      Array<{ id: string; code: string; url: string }>
    >([]),
    [selected, setSelected] = useState<string[]>(() =>
      temporaryExportParticipants(params),
    ),
    [earlier, setEarlier] = useState(params.get("earlier") === "1"),
    [includeDrafts, setIncludeDrafts] = useState(false),
    [labels, setLabels] = useState(""),
    [report, setReport] = useState<TemporaryReport | null>(null),
    [preview, setPreview] = useState(""),
    [score, setScore] = useState(0),
    [comment, setComment] = useState(""),
    [gradeVersion, setGradeVersion] = useState(0),
    [owner, setOwner] = useState(false),
    [cleanupFailures, setCleanupFailures] = useState(0),
    [invitations, setInvitations] = useState<Invitation[]>([]),
    [managedActivities, setManagedActivities] = useState<ManagedActivity[]>([]),
    [inviteEmail, setInviteEmail] = useState(""),
    [settings, setSettings] = useState({
      enabled: false,
      processingEnabled: false,
      enforceAdmission: false,
      maxHours: 72,
    });
  const assignmentId = params.get("assignment");
  const mutationKeys = useRef(
    new Map<string, { payload: string; key: string }>(),
  );
  function mutationKey(operation: string, input: unknown) {
    const payload = JSON.stringify(input),
      previous = mutationKeys.current.get(operation);
    if (previous?.payload === payload) return previous.key;
    const key = crypto.randomUUID();
    mutationKeys.current.set(operation, { payload, key });
    return key;
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const list = await temporaryApi<{ assignments: TemporaryAssignment[] }>(
      "/api/teacher/temporary",
    );
    setActivities(list.assignments);
    if (assignmentId) {
      const d = await temporaryApi<Detail>(
        `/api/teacher/temporary/${assignmentId}`,
      );
      setDetail(d);
      return d;
    }
  }
  useEffect(() => {
    void run(async () => {
      const c = await temporaryApi<{
        owner: boolean;
        retentionHours: number[];
      }>("/api/teacher/temporary/capabilities");
      setOwner(c.owner);
      setRetentionOptions(c.retentionHours);
      setHours((previous) =>
        c.retentionHours.includes(previous)
          ? previous
          : c.retentionHours[c.retentionHours.length - 1],
      );
      const a = await temporaryApi<{
        assessments: Array<{ id: string; title: string; type: string }>;
      }>("/api/teacher/assessments");
      setAssessments(a.assessments.filter((x) => x.type === "simulation"));
      if (c.owner) {
        const adm = await temporaryApi<{
          invitations: Invitation[];
          activities: ManagedActivity[];
          cleanupFailures: number;
          settings: {
            enabled: boolean;
            processing_enabled: boolean;
            enforce_admission: boolean;
            max_hours: number;
          };
        }>("/api/teacher/temporary/admin");
        setInvitations(adm.invitations);
        setManagedActivities(adm.activities);
        setCleanupFailures(adm.cleanupFailures);
        setSettings({
          enabled: adm.settings.enabled,
          processingEnabled: adm.settings.processing_enabled,
          enforceAdmission: adm.settings.enforce_admission,
          maxHours: adm.settings.max_hours,
        });
      }
      await refresh();
    });
  }, [assignmentId]);
  useEffect(() => {
    if (!report?.simulation) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(
      new Blob([report.simulation.html], { type: "text/html" }),
    );
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [report]);
  const revisions = useMemo(() => {
    const list = [...(detail?.revisions ?? [])].sort(
      (a, b) => b.revision - a.revision,
    );
    if (earlier) return list;
    const seen = new Set<string>();
    return list.filter((r) => {
      if (seen.has(r.participantId)) return false;
      seen.add(r.participantId);
      return true;
    });
  }, [detail, earlier]);
  async function exportRows(
    participantIds?: string[],
    single = false,
    clickedRevision?: TemporaryRevision,
  ) {
    if (!assignmentId || !detail) return;
    const current = await refresh();
    if (!current) return;
    const ids = participantIds ?? current.participants.map((p) => p.id),
      latest = new Map<string, TemporaryRevision>();
    for (const r of current.revisions)
      if (
        !latest.has(r.participantId) ||
        latest.get(r.participantId)!.revision < r.revision
      )
        latest.set(r.participantId, r);
    const pinned = clickedRevision
      ? [{ ...clickedRevision }]
      : earlier
        ? current.revisions.filter((r) => ids.includes(r.participantId))
        : [...latest.values()].filter((r) => ids.includes(r.participantId));
    const localNames = new Map(
      labels.split(/\r?\n/).map((line) => {
        const i = line.indexOf(",");
        return i < 0
          ? [line.trim(), ""]
          : [line.slice(0, i).trim(), line.slice(i + 1).trim()];
      }),
    );
    const exportedAt = new Date().toISOString(),
      entries: Array<{ name: string; content: string }> = [],
      manifest: Array<{
        code: string;
        participantId?: string;
        responseId: string | null;
        artifactId?: string | null;
        gradeId?: string | null;
        status: string;
        error?: string;
      }> = [];
    for (const id of ids)
      if (!current.participants.some((p) => p.id === id))
        manifest.push({
          code: "Unavailable participant",
          participantId: id,
          responseId: null,
          status: "omitted",
          error: "The selected participant is unavailable in this assignment.",
        });
    for (const p of current.participants.filter((p) => ids.includes(p.id)))
      if (
        !pinned.some((r) => r.participantId === p.id) &&
        !(includeDrafts && p.hasDraft)
      )
        manifest.push({
          code: p.code,
          responseId: null,
          status: "not_submitted",
          error:
            "No submitted response. Draft export must be selected explicitly.",
        });
    for (const ref of pinned) {
      try {
        const data = await temporaryApi<TemporaryReport>(
          `/api/teacher/temporary/${assignmentId}/evidence`,
          {
            responseId: ref.id,
            artifactId: ref.artifactId,
            gradeId: ref.gradeId,
          },
        );
        data.revision.status = ref.status;
        data.revision.artifactId = ref.artifactId;
        const name = `${ref.code}-r${ref.revision}.html`,
          html = buildTemporaryReport(
            data,
            exportedAt,
            localNames.get(ref.code) ?? "",
          );
        entries.push({ name, content: html });
        manifest.push({
          code: ref.code,
          responseId: ref.id,
          artifactId: ref.artifactId,
          gradeId: ref.gradeId,
          status: data.simulation ? "complete" : "response_only",
        });
      } catch (e) {
        manifest.push({
          code: ref.code,
          responseId: ref.id,
          status: "omitted",
          error: e instanceof Error ? e.message : "Unavailable",
        });
      }
    }
    if (includeDrafts && !single)
      for (const p of current.participants.filter(
        (p) => ids.includes(p.id) && p.hasDraft,
      )) {
        try {
          const data = await temporaryApi<TemporaryReport>(
            `/api/teacher/temporary/${assignmentId}/draft-evidence`,
            { participantId: p.id, draftVersion: p.draftVersion },
          );
          const name = `${p.code}-draft-v${p.draftVersion}.html`;
          entries.push({
            name,
            content: buildTemporaryReport(
              data,
              exportedAt,
              localNames.get(p.code) ?? "",
            ),
          });
          manifest.push({
            code: p.code,
            responseId: data.revision.id,
            status: "unsubmitted_draft",
          });
        } catch (e) {
          manifest.push({
            code: p.code,
            responseId: null,
            status: "omitted",
            error: e instanceof Error ? e.message : "Draft unavailable",
          });
        }
      }
    const partial = manifest.some(
        (m) => m.status === "omitted" || m.status === "not_submitted",
      ),
      missing = manifest.filter((m) => m.status === "response_only").length;
    if (single && entries.length === 1 && !partial) {
      downloadEvidence(entries[0].content, entries[0].name, "text/html");
      setMessage(
        `Downloaded ${entries[0].name}${missing ? " (response only)" : ""}.`,
      );
      return;
    }
    entries.push({
      name: "manifest.json",
      content: JSON.stringify(
        {
          assignmentId,
          exportedAt,
          partial,
          includeEarlier: earlier,
          selection: ids,
          includeDrafts,
          results: manifest,
        },
        null,
        2,
      ),
    });
    entries.push({
      name: "index.html",
      content: `<!doctype html><html lang="en"><meta charset="utf-8"><title>Explain evidence export</title><h1>${partial ? "Partial export" : "Evidence export"}</h1><p>${missing} response-only reports. ${manifest.filter((m) => m.status === "omitted" || m.status === "not_submitted").length} omissions.</p><ul>${entries
        .filter((e) => e.name.endsWith(".html"))
        .map(
          (e) =>
            `<li><a href="${escapeHtml(e.name)}">${escapeHtml(e.name)}</a></li>`,
        )
        .join(
          "",
        )}</ul><pre>${escapeHtml(JSON.stringify(manifest, null, 2))}</pre></html>`,
    });
    const bytes = buildEvidenceZip(entries);
    downloadEvidence(
      bytes.buffer,
      `explain-${partial ? "partial-" : ""}${assignmentId}.zip`,
      "application/zip",
    );
    setMessage(
      `${partial ? "Partial export" : "Export downloaded"}. ${missing} reports have no simulation; check the manifest.`,
    );
  }
  async function view(ref: TemporaryRevision) {
    if (!assignmentId) return;
    const data = await temporaryApi<TemporaryReport>(
      `/api/teacher/temporary/${assignmentId}/evidence`,
      { responseId: ref.id },
    );
    setReport(data);
    setScore(data.grade?.score ?? 0);
    setComment(data.grade?.comment ?? "");
    setGradeVersion(data.revision.gradeVersion ?? 0);
  }
  return (
    <main className="temporary-teacher">
      <h1>Temporary assignments</h1>
      <p>
        Students explain their thinking through private links. Process their
        submissions in your connected AI client, then download independent
        evidence reports.
      </p>
      {message && (
        <p role="status" className="temporary-note">
          {message}
        </p>
      )}
      <section>
        <h2>Publish an assignment</h2>
        <div className="temporary-form">
          <label>
            Simulation assessment
            <select
              value={assessmentId}
              onChange={(e) => setAssessmentId(e.target.value)}
            >
              <option value="">Choose from your library</option>
              {assessments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hosted lifetime
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
            >
              {retentionOptions.map((n) => (
                <option key={n} value={n}>
                  {n} hours
                </option>
              ))}
            </select>
          </label>
          <label>
            Submissions close (local time)
            <input
              type="datetime-local"
              value={closes}
              onChange={(e) => setCloses(e.target.value)}
            />
          </label>
          <button
            disabled={busy || !assessmentId}
            className="temporary-primary"
            onClick={() => {
              void run(async () => {
                const input = {
                  assessmentId,
                  hours,
                  closesAt: new Date(closes).toISOString(),
                };
                const a = await temporaryApi<TemporaryAssignment>(
                  "/api/teacher/temporary",
                  {
                    ...input,
                    key: mutationKey("publish", input),
                  },
                );
                mutationKeys.current.delete("publish");
                setParams({ assignment: a.id });
              });
            }}
          >
            Publish temporary assignment
          </button>
        </div>
        <p className="temporary-note">
          Leave time between the submission deadline and expiry for processing,
          review and downloads. Publication freezes the question. Hosted
          retention cannot be extended.
        </p>
      </section>
      <section>
        <label>
          Published assignments
          <select
            value={assignmentId ?? ""}
            onChange={(e) => {
              setLinks([]);
              setReport(null);
              setSelected([]);
              setParams(e.target.value ? { assignment: e.target.value } : {});
            }}
          >
            <option value="">Choose an assignment</option>
            {activities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.publishedAt} | {a.id.slice(0, 8)}
              </option>
            ))}
          </select>
        </label>
      </section>
      {detail && assignmentId && (
        <>
          <section>
            <h2>Distribute private links</h2>
            <p>
              Submissions close{" "}
              {new Date(detail.assignment.closesAt).toLocaleString()}. Hosted
              work expires{" "}
              {new Date(detail.assignment.expiresAt).toLocaleString()}.
            </p>
            <div className="temporary-actions">
              <label>
                New participants
                <input
                  type="number"
                  min="1"
                  max="40"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                />
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    const r = await temporaryApi<{ links: typeof links }>(
                      `/api/teacher/temporary/${assignmentId}/participants`,
                      { count },
                    );
                    setLinks(r.links);
                    await refresh();
                  });
                }}
              >
                Create private links
              </button>
              {links.length > 0 && (
                <button
                  onClick={() =>
                    downloadEvidence(
                      links.map((p) => `${p.code},${p.url}`).join("\n"),
                      "private-student-links.csv",
                      "text/csv",
                    )
                  }
                >
                  Download link distribution list
                </button>
              )}
            </div>
            {links.length > 0 && (
              <>
                <p>
                  Save these links now. They are shown once and cannot be
                  recovered. Reissuing a link invalidates its previous link and
                  sessions.
                </p>
                <ul>
                  {links.map((p) => (
                    <li key={p.id}>
                      {p.code}:{" "}
                      <a href={p.url} rel="noreferrer" target="_blank">
                        Open private link
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <details>
              <summary>Reissue a lost link</summary>
              {detail.participants.map((p) => (
                <div key={p.id} className="temporary-actions">
                  <span>{p.code}</span>
                  <button
                    disabled={busy}
                    onClick={() => {
                      void run(async () => {
                        const link = await temporaryApi<{
                          id: string;
                          code: string;
                          url: string;
                        }>(`/api/teacher/temporary/${assignmentId}/reissue`, {
                          participantId: p.id,
                        });
                        setLinks([link]);
                        setMessage(
                          "Link reissued. Previous access is invalid. Saved work is preserved.",
                        );
                      });
                    }}
                  >
                    Invalidate old access and reissue
                  </button>
                </div>
              ))}
            </details>
          </section>
          <section>
            <h2>Responses and evidence</h2>
            <div className="temporary-actions">
              <button
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await refresh();
                  });
                }}
              >
                Refresh status
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={earlier}
                  onChange={(e) => setEarlier(e.target.checked)}
                />
                Include earlier submitted revisions
              </label>
              <button
                disabled={busy || !selected.length}
                onClick={() => {
                  void run(() => exportRows(selected));
                }}
              >
                Download selected ZIP
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  void run(() => exportRows());
                }}
              >
                Download all ZIP
              </button>
              <label>
                <input
                  type="checkbox"
                  checked={includeDrafts}
                  onChange={(e) => setIncludeDrafts(e.target.checked)}
                />
                Include unsubmitted drafts (labeled)
              </label>
            </div>
            <p className="temporary-note">
              Processing starts when you ask your connected AI client to claim
              this assignment’s queued work. Keep that client open. Missing
              simulations produce labeled response-only reports.
            </p>
            <details>
              <summary>Optional local names for reports</summary>
              <p>
                One participant code and name per line, separated by a comma.
                These names stay in this browser tab.
              </p>
              <textarea
                className="temporary-labels"
                value={labels}
                onChange={(e) => setLabels(e.target.value)}
                aria-label="Local participant names"
                placeholder="P01-ABCD, Local student name"
              />
            </details>
            <table>
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Participant</th>
                  <th>Revision</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <input
                        aria-label={`Select ${r.code}`}
                        type="checkbox"
                        checked={selected.includes(r.participantId)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...new Set([...prev, r.participantId])]
                              : prev.filter((id) => id !== r.participantId),
                          )
                        }
                      />
                    </td>
                    <td>{r.code}</td>
                    <td>{r.revision}</td>
                    <td>{r.status}</td>
                    <td>
                      <button
                        disabled={busy}
                        onClick={() => {
                          void run(() => view(r));
                        }}
                      >
                        Review
                      </button>{" "}
                      {r.status === "failed" && (
                        <button
                          disabled={busy}
                          onClick={() => {
                            void run(async () => {
                              await temporaryApi(
                                `/api/teacher/temporary/${assignmentId}/retry`,
                                { responseId: r.id },
                              );
                              await refresh();
                            });
                          }}
                        >
                          Retry generation
                        </button>
                      )}{" "}
                      <button
                        disabled={busy}
                        onClick={() => {
                          void run(() =>
                            exportRows([r.participantId], true, { ...r }),
                          );
                        }}
                      >
                        Download HTML
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          {report && (
            <section>
              <h2>
                Review {report.revision.code}, revision{" "}
                {report.revision.revision}
              </h2>
              <p>{report.question.prompt}</p>
              <pre>{report.response}</pre>
              {preview && (
                <iframe
                  title="Review simulation"
                  sandbox="allow-scripts"
                  referrerPolicy="no-referrer"
                  src={preview}
                />
              )}
              <div className="temporary-actions">
                <label>
                  Score out of 100
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={score}
                    onChange={(e) => setScore(Number(e.target.value))}
                  />
                </label>
                <label>
                  Teacher comment
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    maxLength={6000}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      const input = {
                        responseId: report.revision.id,
                        artifactId: report.revision.artifactId,
                        score,
                        comment,
                        expectedGradeVersion: gradeVersion,
                        approved: true,
                      };
                      await temporaryApi(
                        `/api/teacher/temporary/${assignmentId}/grade`,
                        {
                          ...input,
                          key: mutationKey("grade", { assignmentId, ...input }),
                        },
                      );
                      mutationKeys.current.delete("grade");
                      await view(report.revision);
                      await refresh();
                      setMessage(
                        "Teacher grade saved for this evidence version.",
                      );
                    });
                  }}
                >
                  Save approved teacher grade
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {owner && (
        <section>
          <h2>Teacher invitations</h2>
          {cleanupFailures > 0 && (
            <p className="temporary-error" role="alert">
              {cleanupFailures} hosted content deletions need operator
              attention. Automatic retries continue. Check the temporary cleanup
              logs.
            </p>
          )}
          <div className="temporary-actions">
            <label>
              Exact teacher email
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !inviteEmail}
              onClick={() => {
                void run(async () => {
                  await temporaryApi("/api/teacher/temporary/admin", {
                    operation: "invite",
                    email: inviteEmail,
                    active: true,
                  });
                  const a = await temporaryApi<{ invitations: Invitation[] }>(
                    "/api/teacher/temporary/admin",
                  );
                  setInvitations(a.invitations);
                  setInviteEmail("");
                });
              }}
            >
              Invite teacher
            </button>
          </div>
          {invitations.map((i) => (
            <div className="temporary-actions" key={i.email}>
              <span>
                {i.email} | {i.redeemed ? "Connected" : "Invited"} |{" "}
                {i.active ? "Active" : "Disabled"}
              </span>
              <button
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await temporaryApi("/api/teacher/temporary/admin", {
                      operation: "invite",
                      email: i.email,
                      active: !i.active,
                    });
                    setInvitations((prev) =>
                      prev.map((x) =>
                        x.email === i.email ? { ...x, active: !x.active } : x,
                      ),
                    );
                  });
                }}
              >
                {i.active ? "Disable" : "Reactivate"}
              </button>
            </div>
          ))}
          <details>
            <summary>Emergency activity revocation</summary>
            <p>
              Revoke all hosted access to an activity and start cleanup,
              including work owned by a disabled teacher. Student evidence stays
              restricted to its teacher.
            </p>
            {managedActivities.map((a) => (
              <div key={a.id} className="temporary-actions">
                <span>
                  {a.teacherEmail} | {a.id} | expires{" "}
                  {new Date(a.expiresAt).toLocaleString()}
                </span>
                <button
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await temporaryApi("/api/teacher/temporary/admin", {
                        operation: "revoke",
                        assignmentId: a.id,
                      });
                      setManagedActivities((previous) =>
                        previous.filter((p) => p.id !== a.id),
                      );
                      setActivities((previous) =>
                        previous.filter((p) => p.id !== a.id),
                      );
                      if (assignmentId === a.id) {
                        setDetail(null);
                        setReport(null);
                        setLinks([]);
                      }
                      setMessage(
                        "Hosted access revoked. Content cleanup is scheduled.",
                      );
                    });
                  }}
                >
                  Revoke hosted access and start cleanup
                </button>
              </div>
            ))}
          </details>
          <details>
            <summary>Temporary mode controls</summary>
            <div className="temporary-actions">
              {(
                ["enabled", "processingEnabled", "enforceAdmission"] as const
              ).map((key) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={settings[key]}
                    onChange={(e) =>
                      setSettings((s) => ({ ...s, [key]: e.target.checked }))
                    }
                  />
                  {
                    {
                      enabled: "Allow new assignments",
                      processingEnabled: "Allow processing",
                      enforceAdmission: "Require invitations for teachers",
                    }[key]
                  }
                </label>
              ))}
              <label>
                Maximum hosted hours
                <select
                  value={settings.maxHours}
                  onChange={(e) =>
                    setSettings((s) => ({
                      ...s,
                      maxHours: Number(e.target.value),
                    }))
                  }
                >
                  {[24, 48, 72].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <button
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    await temporaryApi("/api/teacher/temporary/admin", {
                      operation: "settings",
                      ...settings,
                    });
                    setMessage(
                      "Controls saved. Existing cleanup and authorized exports continue.",
                    );
                  });
                }}
              >
                Save controls
              </button>
            </div>
          </details>
        </section>
      )}
    </main>
  );
}
