import { test, expect, type Page } from "@playwright/test";
import { createServer, type ServerResponse } from "node:http";
import type { AssessmentSummary, AttemptResult, StudentAssignmentSummary } from "@alt-assessment/shared";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=", "base64");
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const job = { jobId: "job", operation: "generate", status: "in_progress", message: "Generating interactive HTML...", requestedModel: "gpt-5.6-terra", modelUsed: "gpt-5.6-terra", htmlReasoningEffort: "max" };
const sketch = { artifactId: "sketch", previewPath: "/artifacts/sketch/preview", previewToken: "synthetic", outputKind: "image" };
const preview = { artifactId: "html", previewPath: "/artifacts/html/preview", previewToken: "synthetic", outputKind: "html", htmlViewport: { width: 1024, height: 768 } };

async function studentFixture(page: Page, type: "simulation" | "writing", activeJob: typeof job | null = job) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript((user) => {
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, email: user.email })) + ".synthetic";
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const assessment: AssessmentSummary = { id: "assessment", type, title: "Student progress fixture", prompt: "Describe the movement between two containers.", rubric: [{ name: "Description", maxPoints: 10, description: "Explain the movement." }], config: {} };
  const assignment: StudentAssignmentSummary = { assignmentId: "assignment", assessment, classId: "course", classCode: "TEST", className: "Test course", opensAt: null, dueAt: null, state: "not_started", dueState: "none", latestAttempt: null, publishedGrade: null };
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (path === "/api/student/me") await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "TEST", className: "Test course", assignments: [assignment] }] } });
    else if (path === "/api/attempts/start") await route.fulfill({ headers, json: { attemptId: "attempt", assignment, ...(type === "simulation" ? { simulationDraft: { description: "Move the contents from container A to container B.", simulationSketchPreview: sketch, simulationPreview: null, activeSimulationJob: activeJob } } : {}) } });
    else if (path === "/api/artifacts/sketch/preview") await route.fulfill({ headers, contentType: "image/png", body: png });
    else await route.fulfill({ headers, json: {} });
  });
  return { assessment, assignment };
}

function savedResult(assessment: AssessmentSummary): AttemptResult {
  return { attemptId: "attempt", assignmentId: "assignment", assessment, status: "submitted", provisionalScore: null, provisionalFeedback: null,
    transcript: null, ocrText: null, simulationDescription: "Move the contents from container A to container B.", simulationSpec: null,
    simulationSketchPreview: sketch, simulationPreview: preview, submittedAt: "2026-09-30T19:21:27Z", submittedAfterDue: false };
}

test("HTML generation streams before completion and reconnects without regenerating or executing partial code", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await studentFixture(page, "simulation", null);
  let generationRequests = 0;
  await page.route("**/api/simulation/generate", async route => {
    generationRequests++;
    await route.fulfill({ headers, json: job });
  });
  await page.route("**/api/simulation/jobs/job", route => route.fulfill({ headers, json: job }));
  await page.route("**/api/artifacts/html/preview?**", route => route.fulfill({ headers, contentType: "text/html", body: '<!doctype html><html><body><h1>Finished simulation</h1><button id="step">Step forward</button><script>document.getElementById("step").onclick=function(){this.textContent="Advanced"};</script></body></html>' }));
  const connections: ServerResponse[] = [];
  const cursors: (string | null)[] = [];
  const send = (response: ServerResponse, event: unknown) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const initialCode = '<h1>Unfinished simulation</h1>\n<script>window.partialCodeRan=true;</script>\n';
  const server = createServer((request, response) => {
    response.writeHead(200, { ...headers, "content-type": "text/event-stream", "cache-control": "no-store" });
    response.flushHeaders();
    if (request.method === "OPTIONS") { response.end(); return; }
    cursors.push(new URL(request.url!, "http://stream.test").searchParams.get("after"));
    connections.push(response);
    send(response, { type: "job", job });
    send(response, { type: "html_delta", cursor: 3, delta: initialCode });
    if (connections.length > 1) send(response, { type: "html_delta", cursor: 4, delta: '<p>More code has arrived</p>\n' });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  await page.route(/\/api\/simulation\/jobs\/job\/stream(?:\?.*)?$/, async route => {
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    await route.continue({ url: `http://127.0.0.1:${port}/stream${new URL(route.request().url()).search}` });
  });
  try {
    await page.goto("./assignment/assignment");
    await page.getByRole("button", { name: "Regenerate HTML Preview", exact: true }).click();
    const code = page.getByLabel("Generated HTML code", { exact: true });
    await expect(code).toContainText("Unfinished simulation");
    await expect(page.getByText("HTML is arriving", { exact: true })).toBeVisible();
    await expect(page.locator('iframe[title="Safe simulation preview"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).partialCodeRan)).toBeUndefined();
    await expect(page.getByRole("button", { name: "Submit Simulation", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("html-streaming.png") });
    connections[0].end();
    await expect(code).toContainText("More code has arrived");
    expect(cursors.slice(0, 2)).toEqual([null, "3"]);
    expect((await code.textContent())!.split("Unfinished simulation")).toHaveLength(2);
    expect(generationRequests).toBe(1);
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Move the contents from container A to container B.");
    send(connections[1], { type: "job", job: { ...job, status: "completed", preview } });
    connections[1].end();
    const frame = page.frameLocator('iframe[title="Safe simulation preview"]');
    await expect(frame.getByRole("heading", { name: "Finished simulation" })).toBeVisible();
    await frame.getByRole("button", { name: "Step forward" }).click();
    await expect(frame.getByRole("button", { name: "Advanced" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit Simulation", exact: true })).toBeEnabled();
    await expect(page.getByRole("progressbar")).toHaveCount(0);
  } finally {
    for (const response of connections) response.destroy();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("restored simulation work shows progress, renders completed HTML and signals submission", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const { assessment, assignment } = await studentFixture(page, "simulation");
  const result = savedResult(assessment);
  await page.route("**/api/attempts/attempt/result", route => route.fulfill({ headers, json: result }));
  let phase = "in_progress";
  await page.route("**/api/simulation/jobs/job", route => route.fulfill({ headers, json: { ...job, status: phase, ...(phase === "completed" ? { preview } : {}) } }));
  await page.route("**/api/artifacts/html/preview?**", route => route.fulfill({ headers, contentType: "text/html", body: '<!doctype html><html><body><h1>Container movement</h1><button id="step">Step forward</button><script>(function () { document.getElementById("step").addEventListener("click", function () { this.textContent = "Advanced"; }); })();</script></body></html>' }));
  let finishSubmission!: () => void;
  const submitted = new Promise<void>(resolve => { finishSubmission = resolve; });
  await page.route("**/api/simulation/submit", async route => {
    await submitted;
    assignment.state = "submitted";
    assignment.latestAttempt = { attemptId: "attempt", status: "submitted", submittedAt: result.submittedAt, provisionalScore: null };
    await route.fulfill({ headers, json: { attemptId: "attempt" } });
  });
  await page.goto("./assignment/assignment");
  await expect(page.getByRole("progressbar", { name: "Generating your interactive preview" })).toBeVisible();
  await page.locator(".safe-preview-primary").scrollIntoViewIfNeeded();
  const box = await page.locator(".student-action-progress").boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(8);
  expect(box!.y).toBeLessThanOrEqual(20);
  phase = "finalizing";
  await expect(page.getByRole("progressbar", { name: "Finishing your interactive preview" })).toBeVisible();
  phase = "completed";
  const frame = page.frameLocator('iframe[title="Safe simulation preview"]');
  // Legacy jobs recover through polling, whose interval can exceed the default
  // assertion timeout once the fixture advances between two status reads.
  await expect(frame.getByRole("heading", { name: "Container movement" })).toBeVisible({ timeout: 12_000 });
  await frame.getByRole("button", { name: "Step forward" }).click();
  await expect(frame.getByRole("button", { name: "Advanced" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit Simulation", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Submitting your simulation" })).toBeVisible();
  finishSubmission();
  await expect(page).toHaveURL(/\/attempt\/attempt$/);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Your Simulation Description" })).toBeVisible();
  await expect(page.getByText(result.simulationDescription!, { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Generated simulation sketch" })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Recovered simulation preview"]').getByRole("heading", { name: "Container movement" })).toBeVisible();
  await page.reload();
  await expect(page.getByText(result.simulationDescription!, { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Recovered simulation preview"]').getByRole("heading", { name: "Container movement" })).toBeVisible();
  await page.locator("#student-content").getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("link", { name: "View submission" })).toHaveAttribute("href", "/Causalyst/attempt/attempt");
  let newStarts = 0;
  page.on("request", request => { if (request.url().endsWith("/api/attempts/start")) newStarts++; });
  await page.goto("./assignment/assignment");
  await expect(page).toHaveURL(/\/attempt\/attempt$/);
  await expect(page.getByText(result.simulationDescription!, { exact: true })).toBeVisible();
  expect(newStarts).toBe(0);
});

test("failed submission preserves the editor and result loading can be retried without regeneration", async ({ page }) => {
  const { assessment } = await studentFixture(page, "simulation");
  const result = savedResult(assessment);
  await page.route("**/api/simulation/jobs/job", route => route.fulfill({ headers, json: { ...job, status: "completed", preview } }));
  await page.route("**/api/artifacts/html/preview?**", route => route.fulfill({ headers, contentType: "text/html", body: '<!doctype html><html><body><h1>Matter in three containers</h1><button onclick="this.textContent=\'Advanced\'">Step forward</button></body></html>' }));
  let submissions = 0;
  await page.route("**/api/simulation/submit", async route => {
    submissions++;
    await route.fulfill({ headers, status: submissions === 1 ? 502 : 200, json: submissions === 1 ? { error: "Submission temporarily unavailable. Your work is saved." } : { attemptId: "attempt" } });
  });
  let resultLoads = 0;
  let resultUnavailable = true;
  await page.route("**/api/attempts/attempt/result", async route => {
    resultLoads++;
    await route.fulfill({ headers, status: resultUnavailable ? 503 : 200, json: resultUnavailable ? { error: "Result temporarily unavailable" } : result });
  });
  await page.goto("./assignment/assignment");
  const editor = page.frameLocator('iframe[title="Safe simulation preview"]');
  await editor.getByRole("button", { name: "Step forward" }).click();
  await page.getByRole("button", { name: "Submit Simulation", exact: true }).click();
  await expect(page.getByText("Submission temporarily unavailable. Your work is saved.")).toBeVisible();
  await expect(editor.getByRole("button", { name: "Advanced" })).toBeVisible();
  await page.getByText("Input and Rubric", { exact: true }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(result.simulationDescription!);
  await expect(page.getByRole("img", { name: "Generated simulation sketch" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit Simulation", exact: true }).click();
  await expect(page.getByText("Result temporarily unavailable", { exact: true })).toBeVisible();
  const failedResultLoads = resultLoads;
  resultUnavailable = false;
  await page.getByRole("button", { name: "Retry loading submission" }).click();
  await expect(page.getByText(result.simulationDescription!, { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Recovered simulation preview"]').getByRole("heading", { name: "Matter in three containers" })).toBeVisible();
  await page.locator("#student-content").getByRole("link", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("link", { name: "View submission" })).toBeVisible();
  expect(submissions).toBe(2);
  expect(resultLoads).toBe(failedResultLoads + 1);
});

test("a failed preview finalization stops the progress indicator and enables retry", async ({ page }) => {
  await studentFixture(page, "simulation");
  let polls = 0;
  await page.route("**/api/simulation/jobs/job", async route => {
    polls++;
    if (polls === 1) await route.fulfill({ headers, status: 502, json: { error: "Internal server error" } });
    else await route.fulfill({ headers, json: { ...job, status: "failed", errorMessage: "The preview could not be prepared. Your sketch is saved." } });
  });
  await page.goto("./assignment/assignment");
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByText("The preview could not be prepared. Your sketch is saved.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Regenerate HTML Preview" })).toBeEnabled();
});

test("written submission shows background work and clears progress after a response error", async ({ page }) => {
  await studentFixture(page, "writing");
  await page.route("**/api/artifacts/upload-token", route => route.fulfill({ headers, json: { artifactId: "writing", uploadToken: "synthetic", uploadUrl: "http://127.0.0.1:8787/api/artifacts/writing/upload" } }));
  let finishGrading!: () => void;
  const graded = new Promise<void>(resolve => { finishGrading = resolve; });
  await page.route("**/api/writing/grade", async route => { await graded; await route.fulfill({ headers, status: 502, json: { error: "Feedback is temporarily unavailable. Try again." } }); });
  await page.goto("./assignment/assignment");
  await page.locator('input[type="file"]').setInputFiles({ name: "written-work.png", mimeType: "image/png", buffer: png });
  await page.getByRole("button", { name: "Submit written work" }).click();
  await expect(page.getByRole("progressbar", { name: "Submitting your written work" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submitting written work..." })).toBeDisabled();
  finishGrading();
  await expect(page.getByText("Feedback is temporarily unavailable. Try again.")).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Submit written work" })).toBeEnabled();
});
