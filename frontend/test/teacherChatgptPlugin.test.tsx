// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { teacherApiFetch } from "../src/lib/api";
import { teacherSupabase } from "../src/lib/supabase";
import { teacherPluginCallbackUrl, TeacherChatgptPluginPage } from "../src/pages/teacher/TeacherChatgptPluginPage";

vi.mock("../src/lib/api", () => ({ teacherApiFetch: vi.fn() }));
vi.mock("../src/lib/supabase", () => ({ teacherSupabase: { auth: { oauth: { getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn(), listGrants: vi.fn(), revokeGrant: vi.fn() } } } }));
const oauth = teacherSupabase.auth.oauth;
const config = { endpoint: "https://worker.example/mcp/teacher", configured: true, clientIds: ["client-1"] };
beforeEach(() => {
  vi.mocked(teacherApiFetch).mockResolvedValue(config);
  vi.mocked(oauth.listGrants).mockResolvedValue({ data: [], error: null });
});
afterEach(() => { cleanup(); vi.resetAllMocks(); sessionStorage.clear(); });
function show(path = "/teacher/chatgpt-plugin") { render(<MemoryRouter initialEntries={[path]}><TeacherChatgptPluginPage /></MemoryRouter>); }

it("shows setup and usage boundaries without changing API model settings", async () => {
  show();
  expect((await screen.findByRole("textbox", { name: "Plugin server URL" })).getAttribute("value")).toBe(config.endpoint);
  expect(screen.getByText(/Sign in to Codex with ChatGPT to use your subscription allowance.*Codex configured with an API key uses API billing/)).toBeTruthy();
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
});
it("shows teacher consent and rejects unapproved clients", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockResolvedValue({ data: { client: { id: "other-client", name: "Other app" } }, error: null } as never);
  show("/teacher/chatgpt-plugin?authorization_id=request-1");
  await screen.findByText("This app is not an approved Explain Teacher connection.");
  expect(screen.queryByRole("button", { name: "Connect teacher account" })).toBeNull();
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
});
it("requires an explicit click before accepting the requesting app", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockResolvedValue({ data: { authorization_id: "request-1", client: { id: "client-1", name: "Explain Teacher" }, user: { email: "teacher@example.test" }, scope: "openid email profile" }, error: null } as never);
  vi.mocked(oauth.approveAuthorization).mockResolvedValue({ data: { redirect_url: "https://foreign.example/callback" }, error: null });
  show("/teacher/chatgpt-plugin?authorization_id=request-1");
  await screen.findByText("teacher@example.test");
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Connect teacher account" }));
  await screen.findByText("The connection callback is not a supported ChatGPT or Codex address.");
  expect(oauth.approveAuthorization).toHaveBeenCalledWith("request-1", { skipBrowserRedirect: true });
});
it("allows revocation of a previously connected account", async () => {
  vi.mocked(oauth.listGrants).mockResolvedValue({ data: [{ client: { id: "client-1", name: "Explain Teacher" } }], error: null } as never);
  vi.mocked(oauth.revokeGrant).mockResolvedValue({ data: null, error: null } as never);
  show();
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
  await screen.findByText("Plugin access to this teacher account has been disconnected.");
  expect(oauth.revokeGrant).toHaveBeenCalledWith({ clientId: "client-1" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull());
});
it("only accepts HTTPS ChatGPT callbacks without credential tricks", () => {
  expect(teacherPluginCallbackUrl("https://chatgpt.com/connector_platform/oauth/callback?code=example")).toContain("https://chatgpt.com/");
  for (const url of ["javascript:alert(1)", "https://chatgpt.com.attacker.example/callback", "http://chatgpt.com/callback", "https://user:pass@chatgpt.com/callback", "https://chatgpt.com:444/callback", "https://chatgpt.com/callback#secret"]) expect(() => teacherPluginCallbackUrl(url)).toThrow();
});
it("accepts Codex loopback callbacks while rejecting other local destinations", () => {
  expect(teacherPluginCallbackUrl("http://127.0.0.1:4321/callback?code=synthetic&state=example")).toBe("http://127.0.0.1:4321/callback?code=synthetic&state=example");
  expect(teacherPluginCallbackUrl("http://127.0.0.1:4321/callback/XuuuHAzzHOni?code=synthetic")).toContain("/callback/XuuuHAzzHOni");
  for (const url of ["http://localhost:4321/callback", "http://192.168.1.1:4321/callback", "http://127.0.0.1.attacker.example/callback", "http://user:pass@127.0.0.1:4321/callback", "http://127.0.0.1:4321/admin", "http://127.0.0.1:4321/callback/extra/path", "http://127.0.0.1:4321/callback#secret"]) expect(() => teacherPluginCallbackUrl(url)).toThrow();
});
it("requires explicit continuation when returning to Codex", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockResolvedValue({ data: { redirect_url: "http://127.0.0.1:4321/callback/XuuuHAzzHOni?code=synthetic" }, error: null } as never);
  show("/teacher/chatgpt-plugin?authorization_id=request-1");
  await screen.findByRole("button", { name: "Continue to Codex" });
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
});
it("requires an explicit continuation for a previously approved grant", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockResolvedValue({ data: { redirect_url: "https://chatgpt.com/connector_platform_oauth_redirect?code=synthetic" }, error: null } as never);
  show("/teacher/chatgpt-plugin?authorization_id=request-1");
  await screen.findByRole("button", { name: "Continue to ChatGPT" });
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Connect teacher account" })).toBeNull();
});
it("does not allow consent when administrator setup is incomplete", async () => {
  vi.mocked(teacherApiFetch).mockResolvedValue({ ...config, configured: false, clientIds: [] });
  show("/teacher/chatgpt-plugin?authorization_id=request-1");
  await screen.findByRole("alert");
  expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled();
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
});
it("rejects a request that lacks the permissions advertised by the plugin", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockResolvedValue({ data: { client: { id: "client-1", name: "Explain Teacher" }, user: { email: "teacher@example.test" }, scope: "email" }, error: null } as never);
  show("/teacher/chatgpt-plugin?authorization_id=request-1");
  await screen.findByText(/This request is missing the required account permissions/);
  expect(screen.queryByRole("button", { name: "Connect teacher account" })).toBeNull();
});
it("clears old consent details while a changed authorization request loads", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockImplementation(async id => id === "request-1"
    ? { data: { client: { id: "client-1", name: "Explain Teacher" }, user: { email: "teacher@example.test" }, scope: "openid email profile" }, error: null } as never
    : new Promise(() => {}));
  function Fixture() { const navigate = useNavigate(); return <><button onClick={() => navigate("/teacher/chatgpt-plugin?authorization_id=request-2")}>Change request</button><TeacherChatgptPluginPage /></>; }
  render(<MemoryRouter initialEntries={["/teacher/chatgpt-plugin?authorization_id=request-1"]}><Fixture /></MemoryRouter>);
  await screen.findByRole("button", { name: "Connect teacher account" });
  fireEvent.click(screen.getByRole("button", { name: "Change request" }));
  await waitFor(() => expect(oauth.getAuthorizationDetails).toHaveBeenCalledWith("request-2"));
  expect(screen.queryByRole("button", { name: "Connect teacher account" })).toBeNull();
  expect(oauth.approveAuthorization).not.toHaveBeenCalled();
});
it("ignores an old consent response after the connection request changes", async () => {
  vi.mocked(oauth.getAuthorizationDetails).mockImplementation(async id => id === "request-1"
    ? { data: { client: { id: "client-1", name: "Explain Teacher" }, user: { email: "teacher@example.test" }, scope: "openid email profile" }, error: null } as never
    : new Promise(() => {}));
  let resolveApproval!: (result: Awaited<ReturnType<typeof oauth.approveAuthorization>>) => void;
  vi.mocked(oauth.approveAuthorization).mockReturnValue(new Promise(resolve => { resolveApproval = resolve; }));
  function Fixture() { const navigate = useNavigate(); return <><button onClick={() => navigate("/teacher/chatgpt-plugin?authorization_id=request-2")}>Change request</button><TeacherChatgptPluginPage /></>; }
  render(<MemoryRouter initialEntries={["/teacher/chatgpt-plugin?authorization_id=request-1"]}><Fixture /></MemoryRouter>);
  fireEvent.click(await screen.findByRole("button", { name: "Connect teacher account" }));
  fireEvent.click(screen.getByRole("button", { name: "Change request" }));
  await act(async () => { resolveApproval({ data: { redirect_url: "https://foreign.example/callback" }, error: null }); });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Connect teacher account" })).toBeNull();
});
