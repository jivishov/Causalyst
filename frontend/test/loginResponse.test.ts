import { describe, expect, it } from "vitest";
import { validateStudentSessionResponse } from "../src/lib/api";

describe("validateStudentSessionResponse", () => {
  it("accepts a complete login response", () => {
    const result = validateStudentSessionResponse({
      profile: {
        id: "student-1",
        displayName: "Demo Student",
        email: "student@example.com",
        className: "Chemistry",
        classCode: "CHEM101"
      },
      courses: []
    });

    expect(result.profile?.id).toBe("student-1");
    expect(result.profile?.email).toBe("student@example.com");
    expect(result.courses).toEqual([]);
  });

  it("rejects a response without a student profile", () => {
    expect(() => validateStudentSessionResponse({ profile: null, courses: [] })).toThrow("Login response was missing student profile");
  });

  it("rejects a response without a courses array", () => {
    expect(() => validateStudentSessionResponse({
      profile: { id: "student-1", displayName: "Demo Student" }
    })).toThrow("Login response was missing courses");
  });
});
