import { describe, expect, it, vi } from "vitest";
import worker, { routeMetadata, studentRoute, teacherRoute } from "../src/index";
import type { Env } from "../src/lib/env";

describe("Worker route auth metadata", () => {
  it("keeps only OAuth discovery, health and teacher setup status public", () => {
    const publicRoutes = routeMetadata
      .filter((route) => route.auth === "public")
      .map((route) => `${route.method} ${route.path}`);

    expect(publicRoutes).toEqual([
      "GET /.well-known/oauth-protected-resource/mcp/teacher",
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

describe("deployed teacher MCP boundary", () => {
  const env = { SUPABASE_URL: "https://auth.example.test", PIN_PEPPER: "test-pepper", TEACHER_PLUGIN_CLIENT_IDS: "approved-client" } as Env;
  const resource = "https://worker.example.test/mcp/teacher";

  it.each(["GET", "POST"])("returns the OAuth discovery challenge through the Worker %s entry point", async method => {
    const response = await worker.fetch(new Request(resource, { method }), env);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('resource_metadata="https://worker.example.test/.well-known/oauth-protected-resource/mcp/teacher"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects an unapproved origin through the Worker entry point", async () => {
    const response = await worker.fetch(new Request(resource, { method: "POST", headers: { Origin: "https://untrusted.example" } }), env);
    expect(response.status).toBe(403);
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
