import { describe, expect, it } from "vitest";
import { resolvePostAuthTeacherPath } from "../src/pages/teacher/TeacherWorkspace";
import { resolveTeacherSelectedCourseId } from "../src/pages/teacher/TeacherWorkspaceData";

describe("teacher workspace routing", () => {
  it("keeps known deep links after auth", () => {
    expect(resolvePostAuthTeacherPath("/teacher")).toBe("/teacher");
    expect(resolvePostAuthTeacherPath("/teacher/assessments")).toBe("/teacher/assessments");
    expect(resolvePostAuthTeacherPath("/teacher/assignments")).toBe("/teacher/assignments");
    expect(resolvePostAuthTeacherPath("/teacher/review")).toBe("/teacher/review");
    expect(resolvePostAuthTeacherPath("/teacher/gradebook")).toBe("/teacher/gradebook");
  });

  it("normalizes unknown teacher paths to /teacher", () => {
    expect(resolvePostAuthTeacherPath("/teacher/unknown")).toBe("/teacher");
  });
});

describe("teacher selected course persistence helper", () => {
  it("returns preferred id when it exists", () => {
    expect(resolveTeacherSelectedCourseId([{ id: "a" }, { id: "b" }], "b")).toBe("b");
  });

  it("falls back to first course when preferred id is missing", () => {
    expect(resolveTeacherSelectedCourseId([{ id: "a" }, { id: "b" }], "x")).toBe("a");
  });

  it("returns empty when no courses exist", () => {
    expect(resolveTeacherSelectedCourseId([], "x")).toBe("");
  });
});
