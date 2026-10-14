import { TEMPORARY_LIMITS, type TemporaryReport } from "@alt-assessment/shared";

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** No model calls, template evaluation or source rewriting at export. */
export function buildTemporaryReport(
  report: TemporaryReport,
  exportedAt: string,
  localName = "",
): string {
  const e = escapeHtml,
    r = report.revision,
    s = report.simulation;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src 'self' data: blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${e(report.question.title)} | ${e(r.code)}</title><style>body{font:17px/1.6 system-ui,sans-serif;color:#142b3a;background:#fff;max-width:1100px;margin:auto;padding:28px}h1{font-size:28px;line-height:1.2}h2{font-size:21px;margin-top:26px}p,pre{overflow-wrap:anywhere;white-space:pre-wrap}dl{display:grid;grid-template-columns:145px 1fr;gap:3px 16px}dd{margin:0}iframe{width:100%;height:620px;border:1px solid #9baebb;border-radius:8px}button{padding:9px 18px;margin:0 0 12px;border:1px solid #456675;background:white;color:#142b3a;border-radius:6px;cursor:pointer}pre{background:#f2f6f8;padding:16px;max-height:500px;overflow:auto}small{color:#435e6c}@media print{iframe{height:400px}details{display:none}}</style></head><body>
<h1>${e(report.question.title)}</h1><p>${e(r.code)}${localName ? ` | ${e(localName)}` : ""} | ${r.status === "draft" ? "Unsubmitted draft version" : "Submitted revision"} ${r.revision}</p>
<h2>Question and instructions</h2><p id="question">${e(report.question.prompt)}</p>
<details><summary>Assessment criteria</summary><pre>${e(JSON.stringify(report.question.rubric, null, 2))}</pre></details>
<h2>${r.status === "draft" ? "Unsubmitted draft" : "Submitted explanation"}</h2><p id="response">${e(report.response)}</p>
<h2>Interactive simulation</h2>${
    s
      ? `<p>Generated from this response. Model: ${e(s.model ?? "Not reported")}. Client: ${e(s.client ?? "Not reported")}.</p><button id="reset" type="button">Reset simulation</button><iframe id="simulation" title="Student explanation simulation" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${e(s.html)}"></iframe>
<p>This report replays the saved code. It does not record the student's original mouse actions; randomness follows the saved implementation.</p>
${s.assumptions.length ? `<h3>Reported assumptions and limitations</h3><ul>${s.assumptions.map((a) => `<li>${e(a)}</li>`).join("")}</ul>` : ""}
<details><summary>View saved HTML, CSS and JavaScript</summary><pre id="source">${e(s.html)}</pre></details>
<script>const f=document.getElementById('simulation');const original=f.srcdoc;document.getElementById('reset').addEventListener('click',()=>{f.srcdoc=original});</script>`
      : `<p role="status">Response-only report. Simulation status: ${e(r.status)}. No simulation was available for the selected revision.</p>`
  }
<h2>Teacher grade and comments</h2>${report.grade ? `<p>${report.grade.score}/100</p><p>${e(report.grade.comment)}</p><p>Grade evidence: ${e(report.grade.evidenceArtifactId ?? "Response only; no simulation selected when graded")}</p>` : "<p>Not graded</p>"}
<h2>Evidence record</h2><dl><dt>Response revision</dt><dd>${e(r.id)}</dd><dt>Simulation revision</dt><dd>${e(r.artifactId ?? "None selected")}</dd><dt>Grade revision</dt><dd>${e(r.gradeId ?? "None selected")}</dd><dt>Submitted</dt><dd>${e(r.submittedAt ?? "Draft")}</dd><dt>Generated</dt><dd>${e(s?.generatedAt ?? "Not available")}</dd><dt>Graded</dt><dd>${e(report.grade?.gradedAt ?? "Not graded")}</dd><dt>Exported</dt><dd>${e(exportedAt)}</dd><dt>Hosted expiry</dt><dd>${e(report.assignment.expiresAt)}</dd></dl>
<p><small>This downloaded copy outlives hosted expiry. It is editable and does not certify identity or guarantee that the code renders correctly.</small></p></body></html>`;
}
export interface ExportEntry {
  name: string;
  content: string;
}
const encoder = new TextEncoder();
/** ZIP STORE, UTF-8 filenames, no compression dependency or server transfer. */
export function buildEvidenceZip(
  entries: ExportEntry[],
): Uint8Array<ArrayBuffer> {
  if (entries.length > 300) throw new Error("Too many export files.");
  const chunks: Uint8Array[] = [],
    central: Uint8Array[] = [],
    seen = new Set<string>();
  let offset = 0,
    size = 0;
  for (const entry of entries) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(entry.name) ||
      seen.has(entry.name.toLowerCase()) ||
      /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(entry.name)
    )
      throw new Error("Unsafe or duplicate export filename.");
    seen.add(entry.name.toLowerCase());
    const name = encoder.encode(entry.name),
      data = encoder.encode(entry.content);
    size += data.length;
    if (size > TEMPORARY_LIMITS.exportBytes)
      throw new Error(
        "Export exceeds the download limit. Select fewer participants.",
      );
    let crc = 0xffffffff;
    for (const b of data) {
      crc ^= b;
      for (let k = 0; k < 8; k++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new Uint8Array(30 + name.length),
      v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x800, true);
    v.setUint16(12, 0x21, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    const c = new Uint8Array(46 + name.length),
      cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    c.set(name, 46);
    chunks.push(local, data);
    central.push(c);
    offset += local.length + data.length;
  }
  const length = central.reduce((n, c) => n + c.length, 0),
    end = new Uint8Array(22),
    ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, length, true);
  ev.setUint32(16, offset, true);
  const all = [...chunks, ...central, end],
    output = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let n = 0;
  for (const c of all) {
    output.set(c, n);
    n += c.length;
  }
  return output;
}
export function downloadEvidence(
  content: BlobPart,
  name: string,
  type: string,
) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
