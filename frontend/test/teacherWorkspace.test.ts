import {
  temporaryReturnPath,
  temporaryExportParticipants,
} from "../src/lib/temporaryNavigation";
import { describe, expect, it } from "vitest";
import { resolvePostAuthTeacherPath } from "../src/pages/teacher/TeacherWorkspace";
import { resolveTeacherSelectedCourseId } from "../src/pages/teacher/TeacherWorkspaceData";

describe("teacher workspace routing", () => {
  it("keeps known deep links after auth", () => {
    expect(resolvePostAuthTeacherPath("/teacher/temporary")).toBe(
      "/teacher/temporary",
    );
    expect(resolvePostAuthTeacherPath("/teacher")).toBe("/teacher");
    expect(resolvePostAuthTeacherPath("/teacher/assessments")).toBe(
      "/teacher/assessments",
    );
    expect(resolvePostAuthTeacherPath("/teacher/assignments")).toBe(
      "/teacher/assignments",
    );
    expect(resolvePostAuthTeacherPath("/teacher/review")).toBe(
      "/teacher/review",
    );
    expect(resolvePostAuthTeacherPath("/teacher/gradebook")).toBe(
      "/teacher/gradebook",
    );
    expect(resolvePostAuthTeacherPath("/teacher/chatgpt-plugin")).toBe(
      "/teacher/chatgpt-plugin",
    );
  });

  it("normalizes unknown teacher paths to /teacher", () => {
    expect(resolvePostAuthTeacherPath("/teacher/unknown")).toBe("/teacher");
  });
});

describe("teacher selected course persistence helper", () => {
  it("returns preferred id when it exists", () => {
    expect(
      resolveTeacherSelectedCourseId([{ id: "a" }, { id: "b" }], "b"),
    ).toBe("b");
  });

  it("falls back to first course when preferred id is missing", () => {
    expect(
      resolveTeacherSelectedCourseId([{ id: "a" }, { id: "b" }], "x"),
    ).toBe("a");
  });

  it("returns empty when no courses exist", () => {
    expect(resolveTeacherSelectedCourseId([], "x")).toBe("");
  });
});

describe("temporary export sign-in return", () => {
  it("retains the requested selection without persisting names, tokens or arbitrary redirects", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    const path = temporaryReturnPath(
      "/teacher/temporary",
      "?assignment=" +
        id +
        "&participants=" +
        id +
        "&export=1&earlier=1&name=PrivateName&token=private-token&next=https://evil.test",
    );
    expect(path).toContain("assignment=" + id);
    expect(path).toContain("participants=" + id);
    expect(path).toContain("export=1");
    expect(path).not.toMatch(/PrivateName|private-token|evil/);
    expect(
      temporaryReturnPath("/teacher/other", "?assignment=" + id),
    ).toBeNull();
    expect(
      temporaryExportParticipants(
        new URLSearchParams("participants=../../other"),
      ),
    ).toEqual([]);
  });
});
