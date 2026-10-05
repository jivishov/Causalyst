import { test, expect, type Page } from "@playwright/test";
import type { AssessmentSummary, AttemptResult, StudentAssignmentSummary } from "@alt-assessment/shared";

const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=", "base64");
const description = (id: string) => `Move 25 mL of water from container ${id.toUpperCase()} into a graduated cylinder. The volume in the original container decreases by 25 mL.`;
const sketch = (id: string) => ({ artifactId: `sketch-${id}`, previewPath: `/artifacts/sketch-${id}/preview`, previewToken: "synthetic", outputKind: "image" as const });
const preview = (id: string) => ({ artifactId: `html-${id}`, previewPath: `/artifacts/html-${id}/preview`, previewToken: "synthetic", outputKind: "html" as const, htmlViewport: { width: 1024, height: 768 } });

async function fixture(page: Page, type: "simulation" | "writing" = "simulation") {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, email: user.email })) + ".synthetic";
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  // Two assignment IDs deliberately share an assessment ID. Assignment, rather
  // than assessment or type, must define the boundary for drafts/submissions.
  const assignments: StudentAssignmentSummary[] = ["a", "b"].map(id => ({
    assignmentId: `assignment-${id}`, classId: "course", classCode: "TEST", className: "Test course", opensAt: null, dueAt: null, state: "draft", dueState: "none", publishedGrade: null,
    assessment: { id: "shared-assessment", type, title: `Assignment ${id.toUpperCase()}`, prompt: "Describe your own container experiment.", rubric: [{ name: "Explanation", maxPoints: 10, description: "Explain each step." }], config: {} },
    latestAttempt: { attemptId: `attempt-${id}`, status: "draft", provisionalScore: null }
  }));
  const starts: string[] = [];
  const submissions: Record<string, unknown>[] = [];
  const generations: Record<string, unknown>[] = [];
  const startResponse = (id: string) => ({ attemptId: `attempt-${id}`, assignment: assignments.find(a => a.assignmentId === `assignment-${id}`)!, simulationDraft: type === "simulation" ? { description: description(id), simulationSketchPreview: sketch(id), simulationPreview: preview(id), activeSimulationJob: null } : null });
  const result = (id: string): AttemptResult => ({ attemptId: `attempt-${id}`, assignmentId: `assignment-${id}`, assessment: assignments.find(a => a.assignmentId === `assignment-${id}`)!.assessment as AssessmentSummary, status: "submitted", provisionalScore: null, provisionalFeedback: null, transcript: null, ocrText: null, simulationDescription: description(id), simulationSpec: null, simulationSketchPreview: sketch(id), simulationPreview: preview(id), submittedAt: "2026-10-02T04:00:00Z", submittedAfterDue: false });
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/student/me") await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "TEST", className: "Test course", assignments }] } });
    else if (path === "/api/attempts/start") {
      const id = route.request().postDataJSON().assignmentId.slice(-1);
      starts.push(id);
      await route.fulfill({ headers, json: startResponse(id) });
    } else if (path.includes("/artifacts/sketch-")) await route.fulfill({ headers, contentType: "image/png", body: png });
    else if (/\/simulation\/attempts\/attempt-[ab]\/settings$/.test(path)) await route.fulfill({ headers, json: { sketchModelId: "gpt-image-2.5-flare", htmlModelId: path.includes("attempt-a") ? "gpt-6.1-sol" : "gpt-5.6-terra", htmlReasoningEffort: path.includes("attempt-a") ? "high" : "medium", htmlMaxOutputTokens: 64000 } });
    else if (path.includes("/artifacts/html-")) {
      const id = path.includes("html-a") ? "A" : "B";
      await route.fulfill({ headers, contentType: "text/html", body: `<!doctype html><html><body><h1>Simulation ${id}</h1><button onclick="this.textContent='Advanced'">Step forward</button></body></html>` });
    } else if (path === "/api/simulation/sketch") {
      const body = route.request().postDataJSON(); generations.push(body);
      await route.fulfill({ headers, json: { ...sketch(body.attemptId.slice(-1)), requestedModel: "assigned", modelUsed: "assigned" } });
    } else if (path === "/api/simulation/generate") {
      const body = route.request().postDataJSON();
      await route.fulfill({ headers, json: { jobId: `job-${body.attemptId}`, operation: "generate", status: "completed", message: "Complete", preview: preview(body.attemptId.slice(-1)) } });
    } else if (path === "/api/simulation/submit") {
      const body = route.request().postDataJSON(); submissions.push(body);
      await route.fulfill({ headers, json: { attemptId: body.attemptId, submittedAt: "2026-10-02T04:00:00Z" } });
    } else if (/\/attempts\/attempt-[ab]\/result/.test(path)) await route.fulfill({ headers, json: result(path.includes("attempt-a") ? "a" : "b") });
    else await route.fulfill({ headers, json: {} });
  });
  const switchTo = async (id: string) => {
    await page.locator(".side-nav").getByRole("link", { name: "Dashboard", exact: true }).click();
    await page.locator(".student-assignment-card").filter({
      has: page.getByRole("heading", { name: `Assignment ${id.toUpperCase()}`, exact: true })
    }).getByRole("link", { name: "Continue draft", exact: true }).click();
  };
  return { starts, generations, submissions, startResponse, switchTo };
}

test("draft descriptions and previews stay with their assignment across navigation", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const f = await fixture(page);
  await page.goto("./assignment/assignment-a");
  const frame = () => page.frameLocator('iframe[title="Safe simulation preview"]');
  await expect(frame().getByRole("heading", { name: "Simulation A" })).toBeVisible();
  await expect(page.locator(".raw-debug-content")).toContainText("Next HTML model: gpt-6.1-sol | Next HTML reasoning: High");
  await page.locator(".assignment-instructions > summary").click();
  expect((await page.locator(".student-assessment-header").boundingBox())!.height).toBeLessThan(90);
  await page.screenshot({ path: testInfo.outputPath("student-preview-workbench.png") });
  const panel = await page.locator(".safe-preview-primary").boundingBox();
  const sketchPanel = await page.locator(".simulation-sketch-panel").boundingBox();
  expect(panel!.width).toBeGreaterThan(550);
  const editor = await page.locator(".simulation-input-accordion").boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(editor!.x + editor!.width);
  expect(panel!.y).toBeLessThan(sketchPanel!.y);
  await page.getByRole("button", { name: "Expand preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit expanded preview", exact: true })).toBeVisible();
  expect(await page.locator(".safe-preview-primary").evaluate(element => element === document.fullscreenElement && element.clientWidth > 1300)).toBe(true);
  await page.getByRole("button", { name: "Exit expanded preview", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  if (!(await page.locator(".simulation-input-accordion").evaluate(element => (element as HTMLDetailsElement).open))) await page.getByText("My explanation", { exact: true }).click();
  const edited = description("a") + " I will label the two containers clearly.";
  await page.getByLabel("Description", { exact: true }).fill(edited);
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(edited);
  await expect(page.locator('iframe[title="Safe simulation preview"]')).toHaveCount(0);
  await f.switchTo("b");
  await expect(frame().getByRole("heading", { name: "Simulation B" })).toBeVisible();
  await expect(page.locator(".raw-debug-content")).toContainText("Next HTML model: gpt-5.6-terra | Next HTML reasoning: Medium");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(description("b"));
  await f.switchTo("a");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(edited);
  await expect(page.locator('iframe[title="Safe simulation preview"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Generate sketch and HTML", exact: true }).click();
  await expect(frame().getByRole("heading", { name: "Simulation A" })).toBeVisible();
  expect(f.generations).toEqual([{ attemptId: "attempt-a", description: edited }]);
  expect(new Set(f.starts)).toEqual(new Set(["a", "b"]));
});

test("late submission cannot redirect another assignment or submit its artifacts", async ({ page }) => {
  const f = await fixture(page);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/simulation/submit", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const body = route.request().postDataJSON(); bodies.push(body);
    if (body.attemptId === "attempt-a") await pending;
    await route.fulfill({ headers, json: { attemptId: body.attemptId, submittedAt: "2026-10-02T04:00:00Z" } });
  });
  await page.goto("./assignment/assignment-a");
  await expect(page.getByRole("button", { name: "Submit Simulation", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Submit Simulation", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Submitting your simulation" })).toBeVisible();
  await f.switchTo("b");
  await expect(page.frameLocator('iframe[title="Safe simulation preview"]').getByRole("heading", { name: "Simulation B" })).toBeVisible();
  const response = page.waitForResponse(r => r.url().endsWith("/api/simulation/submit"));
  finish(); await response;
  await expect(page).toHaveURL(/\/assignment\/assignment-b$/);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit Simulation", exact: true }).click();
  await expect(page).toHaveURL(/\/attempt\/attempt-b$/);
  expect(bodies).toEqual(["a", "b"].map(id => ({ attemptId: `attempt-${id}`, description: description(id), sketchArtifactId: `sketch-${id}`, htmlArtifactId: `html-${id}` })));
});

test("a delayed attempt response cannot restore into the next assignment", async ({ page }) => {
  const f = await fixture(page);
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/attempts/start", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const id = route.request().postDataJSON().assignmentId.slice(-1);
    if (id === "a") await pending;
    await route.fulfill({ headers, json: f.startResponse(id) });
  });
  await page.goto("./assignment/assignment-a");
  await expect(page.getByRole("progressbar", { name: "Opening your assignment" })).toBeVisible();
  await f.switchTo("b");
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(description("b"));
  const response = page.waitForResponse(r => r.url().endsWith("/api/attempts/start") && r.request().postDataJSON().assignmentId === "assignment-a");
  finish(); await response;
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(description("b"));
  await expect(page.frameLocator('iframe[title="Safe simulation preview"]').getByRole("heading", { name: "Simulation B" })).toBeVisible();
});

test("written uploads reset on assignment switches and late grading keeps the current page", async ({ page }) => {
  const f = await fixture(page, "writing");
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const uploads: Record<string, unknown>[] = [];
  await page.route("**/api/artifacts/upload-token", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    uploads.push(route.request().postDataJSON());
    await route.fulfill({ headers, json: { artifactId: "writing-a", uploadToken: "synthetic", uploadUrl: "http://127.0.0.1:8787/api/artifacts/writing-a/upload" } });
  });
  await page.route("**/api/writing/grade", async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    await pending; await route.fulfill({ headers, json: {} });
  });
  await page.goto("./assignment/assignment-a");
  await page.locator('input[type="file"]').setInputFiles({ name: "response-a.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Submit written work", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Submitting your written work" })).toBeVisible();
  await f.switchTo("b");
  await expect(page.getByRole("button", { name: "Submit written work", exact: true })).toBeDisabled();
  await expect(page.locator(".file-preview")).toHaveCount(0);
  const response = page.waitForResponse(r => r.url().endsWith("/api/writing/grade"));
  finish(); await response;
  await expect(page).toHaveURL(/\/assignment\/assignment-b$/);
  expect(uploads[0].attemptId).toBe("attempt-a");
});
