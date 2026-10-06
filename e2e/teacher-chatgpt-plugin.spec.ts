import { test, expect } from "@playwright/test";

test("teacher ChatGPT consent, cancellation, and disconnection work on desktop and mobile", async ({ page }, testInfo) => {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "teacher@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  const client = { id: "22222222-2222-4222-8222-222222222222", name: "Explain" };
  const endpoint = "https://alt-assessment-student-api.emil-jivishov.workers.dev/mcp/teacher";
  let revoked = false;
  const decisions: string[] = [];
  await page.addInitScript(user => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.synthetic`;
    localStorage.setItem("alt-assessment.teacher-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/consent")) {
      decisions.push(request.postDataJSON().action);
      return route.fulfill({ json: { redirect_url: `https://chatgpt.com/plugin-callback?decision=${decisions.at(-1)}` } });
    }
    if (path.endsWith("/oauth/authorizations/synthetic-authorization")) return route.fulfill({ json: { authorization_id: "synthetic-authorization", client, user, scope: "openid email profile" } });
    if (path.endsWith("/user/oauth/grants")) {
      if (request.method() === "DELETE") { revoked = true; return route.fulfill({ status: 204 }); }
      return route.fulfill({ json: revoked ? [] : [{ client, scopes: ["openid", "email", "profile"], granted_at: "2026-10-06T00:00:00Z" }] });
    }
    return route.fulfill({ json: { user } });
  });
  await page.route("https://chatgpt.com/plugin-callback**", route => route.fulfill({ contentType: "text/html", body: "<p>ChatGPT callback fixture</p>" }));
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let json: unknown = {};
    if (path === "/api/teacher/setup-status") json = { setupAvailable: false };
    else if (path === "/api/teacher/me") json = { profile: { id: user.id, displayName: "Preview teacher", email: user.email, role: "teacher" } };
    else if (path === "/api/teacher/courses") json = { courses: [] };
    else if (path === "/api/teacher/assessments") json = { assessments: [] };
    else if (path === "/api/teacher/chatgpt-plugin") json = { endpoint, configured: true, clientIds: [client.id] };
    await route.fulfill({ headers, json });
  });

  await page.goto("./teacher/chatgpt-plugin");
  await expect(page.getByLabel("Plugin server URL")).toHaveValue(endpoint);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Plugin access to this teacher account has been disconnected.");
  expect(revoked).toBe(true);

  await page.goto("./teacher/chatgpt-plugin?authorization_id=synthetic-authorization");
  await expect(page.getByRole("button", { name: "Connect teacher account", exact: true })).toBeVisible();
  await expect(page.getByText(user.email, { exact: false }).last()).toBeVisible();
  expect(decisions).toEqual([]);
  for (const width of [1366, 375]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`chatgpt-consent-${width}.png`), fullPage: true });
  }
  await page.getByRole("button", { name: "Connect teacher account", exact: true }).click();
  await expect(page).toHaveURL("https://chatgpt.com/plugin-callback?decision=approve");
  expect(decisions).toEqual(["approve"]);
  await page.goto("http://127.0.0.1:5173/Causalyst/teacher/chatgpt-plugin?authorization_id=synthetic-authorization");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page).toHaveURL("https://chatgpt.com/plugin-callback?decision=deny");
  expect(decisions).toEqual(["approve", "deny"]);
});
