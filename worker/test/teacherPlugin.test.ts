import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HttpError } from "../src/lib/http";
import type { Env } from "../src/lib/env";
import { createTeacherPluginServer, requireTeacherPluginAuth, teacherPluginMcp, teacherPluginResourceMetadata } from "../src/lib/teacherPlugin";
import { requireUser } from "../src/lib/auth";
import { serviceSupabase } from "../src/lib/supabase";
import { requireTeacherProfile } from "../src/routes/teacher";
import { createTeacherAssessment, listTeacherAssessments, updateTeacherAssessment } from "../src/routes/teacherAssessments";
import { downloadTeacherArtifact, teacherAttemptDetail } from "../src/routes/teacherReview";

vi.mock("../src/lib/auth", async importOriginal => ({ ...(await importOriginal<object>()), requireUser: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ serviceSupabase: vi.fn() }));
vi.mock("../src/routes/teacher", () => ({ requireTeacherProfile: vi.fn(), listTeacherCourses: vi.fn() }));
vi.mock("../src/routes/teacherAssessments", () => ({ createTeacherAssessment: vi.fn(), updateTeacherAssessment: vi.fn(), listTeacherAssessments: vi.fn().mockResolvedValue({ assessments: [] }), listTeacherAssignments: vi.fn() }));
vi.mock("../src/routes/teacherReview", () => ({ downloadTeacherArtifact: vi.fn(), teacherAttemptDetail: vi.fn(), listTeacherAttempts: vi.fn() }));

const auth = { userId: "teacher-1", token: "not-a-real-token", isAnonymous: false, email: "teacher@example.test", authProvider: null, authProviders: [], authMethods: [], oauthClientId: "client-1", sessionId: "session-1", oauthScopes: ["openid", "email", "profile"] };
const env = { SUPABASE_URL: "https://project.supabase.co", TEACHER_PLUGIN_CLIENT_IDS: "client-1" } as Env;
const base = "https://worker.example/mcp/teacher";
const uuid = "10000000-0000-4000-8000-000000000001";
const timestamp = "2026-10-06T00:00:00.000Z";
const rpc = vi.fn();
let client: Client | undefined;
let server: ReturnType<typeof createTeacherPluginServer> | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(async name => ({ data: name === "save_teacher_plugin_grade" ? { status: "saved", updatedAt: timestamp } : true, error: null }));
  vi.mocked(serviceSupabase).mockReturnValue({ rpc } as never);
  vi.mocked(requireUser).mockResolvedValue(auth);
  vi.mocked(requireTeacherProfile).mockResolvedValue({ id: auth.userId, display_name: "Teacher" });
  vi.mocked(listTeacherAssessments).mockResolvedValue({ assessments: [{ id: uuid, rubric: [{ maxPoints: 10 }] }] } as never);
  vi.mocked(teacherAttemptDetail).mockResolvedValue({ attempt: {
    status: "submitted", attemptId: uuid, updatedAt: timestamp, submittedAt: timestamp, assessment: { rubric: [] }, artifacts: [], realtimeEvents: [],
    transcript: "Student evidence", student: { displayName: "Private student name", id: "private-student" },
    legacyContextCapture: true, realtimeTrust: { level: "low", score: 50, flags: ["sequence_gaps"], summary: "Interrupted connection", history: [{ sessionId: "private-session" }] },
    gradebookEntry: { id: "entry-1", updatedAt: timestamp, publishedAt: null }
  } } as never);
});
afterEach(async () => { await client?.close(); await server?.close(); client = undefined; server = undefined; });
async function connect() {
  server = createTeacherPluginServer({ rpc } as never, env, auth, base);
  client = new Client({ name: "teacher-plugin-test", version: "1.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}
function request(body: unknown, origin?: string) {
  return new Request(base, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer test-token", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
}

describe("teacher plugin authorization", () => {
  it("publishes only resource and OAuth discovery information", () => {
    expect(teacherPluginResourceMetadata(new Request(base), env)).toEqual({ resource: base, authorization_servers: ["https://project.supabase.co/auth/v1"], scopes_supported: ["openid", "email", "profile"], bearer_methods_supported: ["header"], resource_name: "Explain" });
  });
  it("fails closed before administrator setup", async () => {
    await expect(requireTeacherPluginAuth(new Request(base), { ...env, TEACHER_PLUGIN_CLIENT_IDS: "" })).rejects.toMatchObject({ status: 503 });
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("uses the resource audience and checks live session ownership", async () => {
    await requireTeacherPluginAuth(new Request(base), env);
    expect(requireUser).toHaveBeenCalledWith(expect.any(Request), env, base);
    expect(rpc).toHaveBeenCalledWith("teacher_plugin_session_active", { p_session_id: "session-1", p_user_id: "teacher-1", p_client_id: "client-1" });
  });
  it("rejects an unapproved OAuth client", async () => {
    vi.mocked(requireUser).mockResolvedValue({ ...auth, oauthClientId: "other-client" });
    await expect(requireTeacherPluginAuth(new Request(base), env)).rejects.toMatchObject({ status: 401 });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects revoked sessions before reading teacher records", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    await expect(requireTeacherPluginAuth(new Request(base), env)).rejects.toMatchObject({ status: 401 });
    expect(requireTeacherProfile).not.toHaveBeenCalled();
  });
  it("enforces declared OAuth scopes and returns a reauthorization challenge", async () => {
    vi.mocked(requireUser).mockResolvedValue({ ...auth, oauthScopes: ["email"] });
    const response = await teacherPluginMcp(request({}), env);
    expect(response.status).toBe(403);
    expect(response.headers.get("WWW-Authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("WWW-Authenticate")).toContain('scope="openid email profile"');
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects non-teacher profiles", async () => {
    vi.mocked(requireTeacherProfile).mockRejectedValue(new Error("Teacher access required"));
    await expect(requireTeacherPluginAuth(new Request(base), env)).rejects.toThrow("Teacher access required");
  });
  it("blocks a foreign browser origin before checking credentials", async () => {
    expect((await teacherPluginMcp(request({}, "https://malicious.example"), env)).status).toBe(403);
    expect(requireUser).not.toHaveBeenCalled();
  });
  it("returns an OAuth resource challenge for missing credentials", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("Missing bearer token"));
    const response = await teacherPluginMcp(request({}), env);
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("/.well-known/oauth-protected-resource/mcp/teacher");
  });
});

describe("teacher plugin protocol and workflows", () => {
  it("supports stateless initialization followed by a separately authenticated tool call", async () => {
    const initialized = await teacherPluginMcp(request({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }), env);
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "explain-teacher" } } });
    const called = await teacherPluginMcp(request({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_teacher_profile", arguments: {} } }), env);
    expect(called.status).toBe(200);
    expect(await called.json()).toMatchObject({ result: { structuredContent: { id: "teacher-1", name: "Teacher" } } });
  });
  it("publishes OAuth metadata in both descriptor locations over HTTP", async () => {
    const response = await teacherPluginMcp(request({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }), env);
    const body = await response.json() as { result: { tools: Array<{ securitySchemes: unknown; _meta: { securitySchemes: unknown } }> } };
    expect(body.result.tools).toHaveLength(13);
    expect(body.result.tools.every(tool => Array.isArray(tool.securitySchemes) && JSON.stringify(tool.securitySchemes) === JSON.stringify(tool._meta.securitySchemes))).toBe(true);
  });
  it("signals tool-level reauthentication when a profile lookup rejects credentials", async () => {
    const connection = await connect();
    vi.mocked(requireTeacherProfile).mockRejectedValue(new HttpError(401, "Reconnect this account"));
    const result = await connection.callTool({ name: "get_teacher_profile", arguments: {} });
    expect(result.isError).toBe(true);
    expect(result._meta?.["mcp/www_authenticate"]).toEqual([expect.stringContaining('error="invalid_token"')]);
  });
  it("advertises OAuth, accurate write annotations, and no paid generation/publish tools", async () => {
    const connection = await connect();
    const { tools } = await connection.listTools();
    expect(tools.length).toBe(13);
    expect(tools.every(tool => tool._meta?.securitySchemes)).toBe(true);
    expect(tools.find(tool => tool.name === "get_teacher_profile")?.outputSchema).toMatchObject({ type: "object", required: ["id"], additionalProperties: false });
    expect(tools.find(tool => tool.name === "save_teacher_grade")?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: false });
    expect(tools.map(tool => tool.name).join(" ")).not.toMatch(/publish|generate_image|provider|api_key/);
  });
  it("prepares AI work without calling an inference endpoint", async () => {
    const connection = await connect();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await connection.callTool({ name: "prepare_assessment", arguments: { type: "simulation", request: "Gas pressure and volume" } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ type: "simulation", teacherRequest: "Gas pressure and volume", currentAssessment: null });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("does not save a draft unless the confirmed input is present", async () => {
    const connection = await connect();
    const result = await connection.callTool({ name: "save_assessment", arguments: { type: "writing", title: "Draft", prompt: "Explain", expectedAnswer: "Reasoning", rubric: [{ name: "Reasoning", description: "Accurate", maxPoints: 5 }] } });
    expect(result.isError).toBe(true);
    expect(createTeacherAssessment).not.toHaveBeenCalled();
  });
  it("saves a complete approved draft using the existing ownership-scoped operation", async () => {
    const connection = await connect();
    vi.mocked(createTeacherAssessment).mockResolvedValue({ assessment: { id: uuid } } as never);
    const draft = { type: "writing", title: "Draft", prompt: "Explain", expectedAnswer: "Reasoning", rubric: [{ name: "Reasoning", description: "Accurate", maxPoints: 5 }], confirmed: true };
    const result = await connection.callTool({ name: "save_assessment", arguments: draft });
    expect(result.isError).not.toBe(true);
    const [body, , owner] = vi.mocked(createTeacherAssessment).mock.calls[0];
    expect(owner).toBe("teacher-1");
    expect(await body.json()).toEqual({ ...draft, confirmed: undefined });
  });
  it("passes the assessment revision timestamp through rubric writes", async () => {
    const connection = await connect();
    vi.mocked(updateTeacherAssessment).mockResolvedValue({ assessment: { id: uuid } } as never);
    await connection.callTool({ name: "apply_rubric", arguments: { assessmentId: uuid, expectedUpdatedAt: timestamp, rubric: [{ name: "Accuracy", description: "Observable", maxPoints: 10 }], confirmed: true } });
    expect(await vi.mocked(updateTeacherAssessment).mock.calls[0][0].json()).toMatchObject({ expectedUpdatedAt: timestamp });
  });
  it("omits roster identity from evidence packets", async () => {
    const connection = await connect();
    const result = await connection.callTool({ name: "read_submission", arguments: { attemptId: uuid } });
    expect(JSON.stringify(result)).not.toContain("Private student name");
    expect(JSON.stringify(result)).not.toContain("private-student");
    expect(result.structuredContent).toMatchObject({ transcript: "Student evidence", gradebook: { updatedAt: timestamp } });
    expect(result.structuredContent).toMatchObject({ legacyContextCapture: true, connectionContinuity: { flags: ["sequence_gaps"] } });
    expect(JSON.stringify(result)).not.toContain("private-session");
    expect(teacherAttemptDetail).toHaveBeenCalledWith(expect.anything(), "teacher-1", uuid, { reconcileGradebook: false, submittedOnly: true });
  });
  it.each(["draft", "published"])("rejects %s grades", async state => {
    const connection = await connect();
    vi.mocked(teacherAttemptDetail).mockResolvedValue({ attempt: { status: state === "draft" ? "draft" : "submitted", gradebookEntry: { id: "entry-1", publishedAt: state === "published" ? timestamp : null } } } as never);
    const result = await connection.callTool({ name: "save_teacher_grade", arguments: { attemptId: uuid, expectedAttemptUpdatedAt: timestamp, expectedGradebookUpdatedAt: timestamp, score: 85, note: "Reviewed evidence", confirmed: true } });
    expect(result.isError).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("saves grades with atomic unpublished and revision guards", async () => {
    const connection = await connect();
    const result = await connection.callTool({ name: "save_teacher_grade", arguments: { attemptId: uuid, expectedAttemptUpdatedAt: timestamp, expectedGradebookUpdatedAt: timestamp, score: 85, note: "Reviewed evidence", confirmed: true } });
    expect(rpc).toHaveBeenCalledWith("save_teacher_plugin_grade", { p_teacher_id: "teacher-1", p_attempt_id: uuid, p_expected_attempt_updated_at: timestamp,
      p_entry_id: "entry-1", p_expected_entry_updated_at: timestamp, p_score: 85, p_note: `Reviewed in ChatGPT (attempt ${uuid}): Reviewed evidence` });
    expect(result.structuredContent).toMatchObject({ grade: { id: "entry-1", attemptId: uuid, score: 85, publishedAt: null } });
    expect(JSON.stringify(result)).not.toMatch(/Private student name|private-student/);
  });
  it("reports newer submissions as a conflict without claiming a successful grade", async () => {
    const connection = await connect();
    rpc.mockResolvedValue({ data: { status: "conflict", reason: "newer_submission" }, error: null });
    const result = await connection.callTool({ name: "save_teacher_grade", arguments: { attemptId: uuid, expectedAttemptUpdatedAt: timestamp, expectedGradebookUpdatedAt: timestamp, score: 85, note: "Reviewed evidence", confirmed: true } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("A newer submission is available");
  });
  it("returns simulation HTML as untrusted text, never executing it", async () => {
    const connection = await connect();
    vi.mocked(downloadTeacherArtifact).mockResolvedValue(new Response("<script>throw new Error('Do not run')</script>", { headers: { "Content-Type": "text/html" } }));
    const result = await connection.callTool({ name: "read_evidence", arguments: { attemptId: uuid, artifactId: uuid } });
    expect(JSON.stringify(result)).toContain("Untrusted student evidence");
    expect(result.isError).not.toBe(true);
    expect(downloadTeacherArtifact).toHaveBeenCalledWith(expect.any(Request), env, expect.anything(), "teacher-1", uuid, { maxBytes: 8 * 1024 * 1024, submissionAttemptId: uuid });
  });
});
