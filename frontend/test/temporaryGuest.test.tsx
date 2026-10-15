// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { GuestAssignmentPage } from "../src/pages/GuestAssignmentPage";
import { temporaryApi } from "../src/lib/temporaryApi";
vi.mock("../src/lib/temporaryApi", () => ({
  temporaryApi: vi.fn(),
  TemporaryRequestError: class extends Error {
    constructor(public code: string) {
      super(code);
    }
  },
}));
const publicId = "10000000-0000-4000-8000-000000000001";
const first = {
  assignment: {
    publicId,
    closesAt: "2026-10-15T12:00:00Z",
    expiresAt: "2026-10-17T12:00:00Z",
  },
  question: { title: "Pressure", prompt: "Explain pressure.", rubric: [] },
  code: "P01-ABCD",
  draft: "First participant's exact draft",
  draftVersion: 1,
  csrf: "first-session",
  latest: null,
  simulation: null,
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  history.replaceState(null, "", "/");
});
async function show() {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/s/${publicId}`]}>
        <Routes>
          <Route path="/s/:publicId" element={<GuestAssignmentPage />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}
it("keeps the original draft and stops when polling observes a different browser session", async () => {
  vi.useFakeTimers();
  vi.mocked(temporaryApi)
    .mockResolvedValueOnce(first)
    .mockResolvedValueOnce({
      ...first,
      code: "P02-EFGH",
      draft: "Another participant's work",
      csrf: "second-session",
    });
  await show();
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(editor.value).toBe(first.draft);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  expect(temporaryApi).toHaveBeenLastCalledWith(
    expect.stringContaining("/api/guest/work"),
    undefined,
    true,
    first.csrf,
  );
  expect(editor.disabled).toBe(true);
  expect(editor.value).toBe(first.draft);
  expect(screen.queryByText("P02-EFGH")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Submit explanation" }));
  expect(
    vi.mocked(temporaryApi).mock.calls.every(([, body]) => body === undefined),
  ).toBe(true);
});
it("refuses to open a different session between fragment exchange and initial load", async () => {
  history.replaceState(null, "", `/s/${publicId}#${"a".repeat(64)}`);
  vi.mocked(temporaryApi)
    .mockResolvedValueOnce({ csrf: first.csrf })
    .mockResolvedValueOnce({
      ...first,
      code: "P02-EFGH",
      csrf: "second-session",
    });
  await show();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText("Assignment unavailable")).toBeTruthy();
  expect(temporaryApi).toHaveBeenLastCalledWith(
    expect.stringContaining("/api/guest/work"),
    undefined,
    true,
    first.csrf,
  );
});
