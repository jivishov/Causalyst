import { describe, expect, it, vi } from "vitest";
import { routeMetadata, studentRoute, teacherRoute } from "../src/index";
import type { Env } from "../src/lib/env";

describe("Worker route auth metadata", () => {
  it("keeps only health and teacher setup status public", () => {
    const publicRoutes = routeMetadata
      .filter((route) => route.auth === "public")
      .map((route) => `${route.method} ${route.path}`);

    expect(publicRoutes).toEqual([
      "GET /api/health",
      "GET /api/teacher/setup-status"
    ]);
  });

  it("requires auth for every sensitive route namespace", () => {
    for (const route of routeMetadata) {
      if (route.path.startsWith("/api/teacher") && route.path !== "/api/teacher/setup-status") {
        expect(route.auth, `${route.method} ${route.path}`).toBe("teacher");
      }
      if (isStudentNamespace(route.path)) {
        expect(route.auth, `${route.method} ${route.path}`).toBe("student");
      }
    }
  });
});

describe("Worker route auth helpers", () => {
  it("rejects missing student tokens before handler execution", async () => {
    const handler = vi.fn(async () => new Response("should not run"));
    const route = studentRoute("GET", "/api/student/probe", /^\/api\/student\/probe$/, handler);

    await expect(route.handler(
      new Request("https://example.test/api/student/probe"),
      {} as Env,
      ["/api/student/probe"] as unknown as RegExpMatchArray
    )).rejects.toThrow("Missing bearer token");
    expect(handler).not.toHaveBeenCalled();
  });

  it("rejects missing teacher tokens before handler execution", async () => {
    const handler = vi.fn(async () => new Response("should not run"));
    const route = teacherRoute("GET", "/api/teacher/probe", /^\/api\/teacher\/probe$/, handler);

    await expect(route.handler(
      new Request("https://example.test/api/teacher/probe"),
      {} as Env,
      ["/api/teacher/probe"] as unknown as RegExpMatchArray
    )).rejects.toThrow("Missing bearer token");
    expect(handler).not.toHaveBeenCalled();
  });
});

function isStudentNamespace(path: string): boolean {
  return path.startsWith("/api/student")
    || path.startsWith("/api/attempts")
    || path.startsWith("/api/assignments")
    || path.startsWith("/api/artifacts")
    || path.startsWith("/api/voice")
    || path.startsWith("/api/writing")
    || path.startsWith("/api/simulation");
}
