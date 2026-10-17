// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildEvidenceZip,
  buildTemporaryReport,
} from "../src/lib/temporaryReports";
import type { TemporaryReport } from "@alt-assessment/shared";
const fixture: TemporaryReport = {
  assignment: {
    id: "a",
    publicId: "p",
    assessmentId: "t",
    publishedAt: "2026-10-14T12:00:00Z",
    closesAt: "2026-10-15T12:00:00Z",
    expiresAt: "2026-10-17T12:00:00Z",
  },
  question: {
    title: "Pressure <test>",
    prompt: "Explain\nvolume & pressure",
    rubric: [],
  },
  revision: {
    id: "r1",
    participantId: "p1",
    code: "P01-ABCD",
    revision: 1,
    submittedAt: "2026-10-14T12:01:00Z",
    status: "ready",
    artifactId: "s1",
    gradeId: null,
  },
  response: "Şagird α\n</p><script>alert('injection')</script>",
  simulation: {
    html: '<!doctype html><html><head><style>p{color:red}</style></head><body><button id="b">Play</button><script>document.getElementById("b").onclick=()=>{document.body.dataset.clicked="yes"};</script></body></html>',
    generatedAt: "2026-10-14T12:05:00Z",
    model: null,
    client: null,
    assumptions: [],
  },
  grade: null,
};
describe("independent evidence reports", () => {
  it("preserves verbatim Unicode response and exact executed bundle as inert source and sandbox srcdoc", () => {
    const html = buildTemporaryReport(
      fixture,
      "2026-10-14T14:00:00Z",
      "</h1><script>bad()</script>",
    );
    const d = new DOMParser().parseFromString(html, "text/html");
    expect(d.querySelector("#response")?.textContent).toBe(fixture.response);
    expect(d.querySelector("#source")?.textContent).toBe(
      fixture.simulation!.html,
    );
    expect(d.querySelector("iframe")?.getAttribute("srcdoc")).toBe(
      fixture.simulation!.html,
    );
    expect(d.querySelector("iframe")?.getAttribute("sandbox")).toBe(
      "allow-scripts",
    );
    expect(d.querySelectorAll("script")).toHaveLength(1);
    expect(html).toContain("Not reported");
    expect(html).toContain("Not graded");
  });
  it("labels a missing latest simulation instead of substituting older work", () => {
    const html = buildTemporaryReport(
      {
        ...fixture,
        simulation: null,
        revision: { ...fixture.revision, status: "queued", artifactId: null },
      },
      "now",
    );
    expect(html).toContain("Response-only report");
    expect(html).toContain("queued");
    expect(html).not.toContain("<iframe");
  });
  it("assembles deterministic, safe ZIP entries with content intact", () => {
    const entries = [
      {
        name: "P01-ABCD-r1.html",
        content: buildTemporaryReport(fixture, "fixed"),
      },
      { name: "manifest.json", content: '{"partial":true}' },
    ];
    expect(buildEvidenceZip(entries)).toEqual(buildEvidenceZip(entries));
    const bytes = buildEvidenceZip(entries);
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(new TextDecoder().decode(bytes)).toContain(
      fixture.response
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("'", "&#39;"),
    );
    expect(() =>
      buildEvidenceZip([{ name: "../escape.html", content: "bad" }]),
    ).toThrow("Unsafe");
    expect(() =>
      buildEvidenceZip([{ name: "CON.html", content: "bad" }]),
    ).toThrow("Unsafe");
    expect(() =>
      buildEvidenceZip([
        { name: "x.html", content: "a" },
        { name: "x.html", content: "b" },
      ]),
    ).toThrow("duplicate");
  });
});
