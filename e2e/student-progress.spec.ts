import { test, expect, type Page } from "@playwright/test";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=", "base64");
const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const job = { jobId: "job", operation: "generate", status: "in_progress", message: "Generating interactive HTML...", requestedModel: "gpt-5.6-terra", modelUsed: "gpt-5.6-terra", htmlReasoningEffort: "max" };
const sketch = { artifactId: "sketch", previewPath: "/artifacts/sketch/preview", previewToken: "synthetic", outputKind: "image" };
const preview = { artifactId: "html", previewPath: "/artifacts/html/preview", previewToken: "synthetic", outputKind: "html", htmlViewport: { width: 1024, height: 768 } };

async function studentFixture(page: Page, type: "simulation" | "writing") {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript((user) => {
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, email: user.email })) + ".synthetic";
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const assessment = { id: "assessment", type, title: "Student progress fixture", prompt: "Describe the movement between two containers.", rubric: [{ name: "Description", maxPoints: 10, description: "Explain the movement." }], config: {} };
  const assignment = { assignmentId: "assignment", assessment, classId: "course", classCode: "TEST", className: "Test course", opensAt: null, dueAt: null, state: "available", lifecycle: "available", dueState: "none", latestAttempt: null, publishedGrade: null, canStart: true };
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    if (path === "/api/student/me") await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "TEST", className: "Test course", assignments: [assignment] }] } });
    else if (path === "/api/attempts/start") await route.fulfill({ headers, json: { attemptId: "attempt", assignment, ...(type === "simulation" ? { simulationDraft: { description: "Move the contents from container A to container B.", simulationSketchPreview: sketch, simulationPreview: null, activeSimulationJob: job } } : {}) } });
    else if (path === "/api/artifacts/sketch/preview") await route.fulfill({ headers, contentType: "image/png", body: png });
    else await route.fulfill({ headers, json: {} });
  });
}

test("restored simulation work shows progress, renders completed HTML and signals submission", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await studentFixture(page, "simulation");
  let phase = "in_progress";
  await page.route("**/api/simulation/jobs/job", route => route.fulfill({ headers, json: { ...job, status: phase, ...(phase === "completed" ? { preview } : {}) } }));
  await page.route("**/api/artifacts/html/preview?**", route => route.fulfill({ headers, contentType: "text/html", body: '<!doctype html><html><body><h1>Container movement</h1><button id="step">Step forward</button><script>(function () { document.getElementById("step").addEventListener("click", function () { this.textContent = "Advanced"; }); })();</script></body></html>' }));
  let finishSubmission!: () => void;
  const submitted = new Promise<void>(resolve => { finishSubmission = resolve; });
  await page.route("**/api/simulation/submit", async route => { await submitted; await route.fulfill({ headers, json: { attemptId: "attempt" } }); });
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
  await expect(frame.getByRole("heading", { name: "Container movement" })).toBeVisible();
  await frame.getByRole("button", { name: "Step forward" }).click();
  await expect(frame.getByRole("button", { name: "Advanced" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toHaveCount(0);
  await page.getByRole("button", { name: "Submit Simulation", exact: true }).click();
  await expect(page.getByRole("progressbar", { name: "Submitting your simulation" })).toBeVisible();
  finishSubmission();
  await expect(page).toHaveURL(/\/attempt\/attempt$/);
  await expect(page.getByRole("progressbar")).toHaveCount(0);
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
