import { describe, expect, it } from "vitest";
import { requireStudentAuth, requireTeacherAuthSession, type AuthContext } from "../src/lib/auth";

const baseAuth: AuthContext = {
  userId: "user-1",
  token: "token",
  isAnonymous: true,
  email: null,
  authProvider: null,
  authProviders: [],
  authMethods: []
};

describe("auth role guards", () => {
  it("rejects anonymous tokens from student routes", () => {
    expect(() => requireStudentAuth(baseAuth)).toThrow("Student Google sign-in required");
  });

  it("allows email student auth contexts", () => {
    const auth = { ...baseAuth, isAnonymous: false, email: "student@example.com" };
    expect(requireStudentAuth(auth)).toBe(auth);
  });

  it("rejects anonymous tokens from teacher routes", () => {
    expect(() => requireTeacherAuthSession(baseAuth)).toThrow("Teacher email session required");
  });

  it("allows email/password teacher auth contexts", () => {
    const auth = {
      ...baseAuth,
      isAnonymous: false,
      email: "teacher@example.com",
      authProvider: "email",
      authProviders: ["email"],
      authMethods: ["password"]
    };
    expect(requireTeacherAuthSession(auth)).toBe(auth);
  });

  it("allows Google sessions to proceed to the teacher-profile authorization check", () => {
    const auth = {
      ...baseAuth,
      isAnonymous: false,
      email: "student@example.com",
      authProvider: "google",
      authProviders: ["google"],
      authMethods: ["oauth"]
    };
    expect(requireTeacherAuthSession(auth)).toBe(auth);
  });
});
