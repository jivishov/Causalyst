// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type {
  TemporaryReport,
  TemporaryRevision,
} from "@alt-assessment/shared";
import { TeacherTemporaryPage } from "../src/pages/teacher/TeacherTemporaryPage";
import { temporaryApi } from "../src/lib/temporaryApi";
import {
  buildEvidenceZip,
  downloadEvidence,
} from "../src/lib/temporaryReports";

vi.mock("../src/lib/temporaryApi", () => ({ temporaryApi: vi.fn() }));
vi.mock("../src/lib/temporaryReports", async (original) => ({
  ...(await original<typeof import("../src/lib/temporaryReports")>()),
  buildEvidenceZip: vi.fn(() => new Uint8Array([1])),
  downloadEvidence: vi.fn(),
}));
const assignment = {
  id: "10000000-0000-4000-8000-000000000001",
  publicId: "10000000-0000-4000-8000-000000000002",
  assessmentId: "10000000-0000-4000-8000-000000000003",
  publishedAt: "2026-10-14T12:00:00Z",
  closesAt: "2026-10-15T12:00:00Z",
  expiresAt: "2026-10-17T12:00:00Z",
};
const ref: TemporaryRevision = {
  id: "20000000-0000-4000-8000-000000000001",
  participantId: "30000000-0000-4000-8000-000000000001",
  code: "P01-ABCD",
  revision: 1,
  submittedAt: "2026-10-14T12:01:00Z",
  status: "queued",
  artifactId: null,
  gradeId: null,
};
const report: TemporaryReport = {
  assignment,
  question: { title: "Pressure", prompt: "Explain pressure.", rubric: [] },
  revision: ref,
  response: "Əlaqə\n日本語 😀 e\u0301",
  simulation: null,
  grade: null,
};
function detail(revisions = [ref]) {
  return {
    assignment,
    participants: [
      {
        id: ref.participantId,
        code: ref.code,
        hasDraft: false,
        draftVersion: 1,
      },
    ],
    revisions,
  };
}
beforeEach(() => {
  vi.mocked(temporaryApi).mockImplementation(async (path) => {
    if (path.endsWith("/capabilities"))
      return { owner: false, retentionHours: [24, 48, 72] } as never;
    if (path === "/api/teacher/assessments")
      return {
        assessments: [
          {
            id: assignment.assessmentId,
            type: "simulation",
            title: "Pressure",
          },
        ],
      } as never;
    if (path === "/api/teacher/temporary")
      return { assignments: [assignment] } as never;
    if (path.endsWith("/evidence")) return structuredClone(report) as never;
    return detail() as never;
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function show(query = "") {
  render(
    <MemoryRouter
      initialEntries={[
        `/teacher/temporary?assignment=${assignment.id}${query}`,
      ]}
    >
      <TeacherTemporaryPage />
    </MemoryRouter>,
  );
}
it("downloads the clicked response and pinned evidence when a new submission arrives during refresh", async () => {
  const api = vi.mocked(temporaryApi).getMockImplementation()!;
  let reads = 0;
  vi.mocked(temporaryApi).mockImplementation(async (path, ...args) => {
    if (path === `/api/teacher/temporary/${assignment.id}` && ++reads > 1)
      return detail([
        ref,
        {
          ...ref,
          id: "20000000-0000-4000-8000-000000000002",
          revision: 2,
          status: "ready",
          artifactId: "new-artifact",
          gradeId: "new-grade",
        },
      ]) as never;
    return api(path, ...args);
  });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Download HTML" }));
  await waitFor(() => expect(downloadEvidence).toHaveBeenCalled());
  expect(temporaryApi).toHaveBeenCalledWith(
    `/api/teacher/temporary/${assignment.id}/evidence`,
    {
      responseId: ref.id,
      artifactId: null,
      gradeId: null,
    },
  );
  const [html, filename, type] = vi.mocked(downloadEvidence).mock.calls[0];
  expect(filename).toBe("P01-ABCD-r1.html");
  expect(type).toBe("text/html");
  expect(String(html)).toContain(report.response);
  expect(String(html)).toContain("Simulation status: queued");
  expect(String(html)).not.toContain("new-artifact");
});
it("marks unavailable explicit selections as partial instead of downloading an empty complete ZIP", async () => {
  const missing = "30000000-0000-4000-8000-000000000099";
  show(`&participants=${missing}`);
  await screen.findByRole("button", { name: "Download HTML" });
  fireEvent.click(
    screen.getByRole("button", { name: "Download selected ZIP" }),
  );
  await waitFor(() => expect(buildEvidenceZip).toHaveBeenCalled());
  const entries = vi.mocked(buildEvidenceZip).mock.calls[0][0];
  const manifest = JSON.parse(
    entries.find((e) => e.name === "manifest.json")!.content,
  );
  expect(manifest).toMatchObject({
    partial: true,
    selection: [missing],
    results: [{ participantId: missing, status: "omitted" }],
  });
  expect(downloadEvidence).toHaveBeenCalledWith(
    expect.any(ArrayBuffer),
    expect.stringContaining("partial-"),
    "application/zip",
  );
});
it("reuses a publication key after a lost reply and changes it when the request changes", async () => {
  const api = vi.mocked(temporaryApi).getMockImplementation()!;
  vi.mocked(temporaryApi).mockImplementation(async (path, body, ...args) => {
    if (path === "/api/teacher/temporary" && body)
      throw new Error("Synthetic lost reply");
    return api(path, body, ...args);
  });
  show();
  await screen.findByRole("button", { name: "Download HTML" });
  fireEvent.change(screen.getByLabelText("Simulation assessment"), {
    target: { value: assignment.assessmentId },
  });
  const publish = screen.getByRole("button", {
    name: "Publish temporary assignment",
  });
  fireEvent.click(publish);
  await screen.findByText("Synthetic lost reply");
  fireEvent.click(publish);
  await waitFor(() =>
    expect(
      vi
        .mocked(temporaryApi)
        .mock.calls.filter(
          ([path, body]) => path === "/api/teacher/temporary" && body,
        ),
    ).toHaveLength(2),
  );
  await screen.findByText("Synthetic lost reply");
  fireEvent.change(screen.getByLabelText("Hosted lifetime"), {
    target: { value: "48" },
  });
  fireEvent.click(publish);
  await waitFor(() =>
    expect(
      vi
        .mocked(temporaryApi)
        .mock.calls.filter(
          ([path, body]) => path === "/api/teacher/temporary" && body,
        ),
    ).toHaveLength(3),
  );
  const bodies = vi
    .mocked(temporaryApi)
    .mock.calls.filter(
      ([path, body]) => path === "/api/teacher/temporary" && body,
    )
    .map(([, body]) => body as { key: string });
  expect(bodies[1].key).toBe(bodies[0].key);
  expect(bodies[2].key).not.toBe(bodies[0].key);
});
it("offers the owner a separate emergency revoke action without requesting colleague evidence", async () => {
  const api = vi.mocked(temporaryApi).getMockImplementation()!;
  vi.mocked(temporaryApi).mockImplementation(async (path, body, ...args) => {
    if (path.endsWith("/capabilities"))
      return { owner: true, retentionHours: [24, 48, 72] } as never;
    if (path.endsWith("/admin"))
      return {
        invitations: [],
        cleanupFailures: 0,
        activities: [
          {
            id: assignment.id,
            teacherEmail: "colleague@example.test",
            expiresAt: assignment.expiresAt,
          },
        ],
        settings: {
          enabled: true,
          processing_enabled: true,
          enforce_admission: true,
          max_hours: 72,
        },
      } as never;
    return api(path, body, ...args);
  });
  show();
  const revoke = await screen.findByRole("button", {
    name: "Revoke hosted access and start cleanup",
    hidden: true,
  });
  fireEvent.click(revoke);
  await screen.findByText(
    "Hosted access revoked. Content cleanup is scheduled.",
  );
  expect(temporaryApi).toHaveBeenCalledWith("/api/teacher/temporary/admin", {
    operation: "revoke",
    assignmentId: assignment.id,
  });
  expect(
    vi
      .mocked(temporaryApi)
      .mock.calls.some(([path]) => path.endsWith("/evidence")),
  ).toBe(false);
});
