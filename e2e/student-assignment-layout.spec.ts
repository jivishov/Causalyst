import { test, expect, type Page } from "@playwright/test";
import type { StudentAssignmentSummary } from "@alt-assessment/shared";

const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh1sAAAAASUVORK5CYII=", "base64");
const description = "Move 25 mL of water into a graduated cylinder and label the volume. The original container loses 25 mL.";
const layoutKey = "explain.student.assignment-layout";

async function fixture(page: Page) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, email: user.email })) + ".synthetic";
    localStorage.setItem("alt-assessment.student-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const types = ["simulation", "writing", "voice", "voice_realtime"] as const;
  const assignments: StudentAssignmentSummary[] = types.map(type => ({
    assignmentId: type, classId: "course", classCode: "APCHEM-2627", className: "AP Chemistry", opensAt: null, dueAt: null, state: "draft", dueState: "none", publishedGrade: null,
    assessment: { id: type, type, title: type === "simulation" ? "Unit 1 — Atomic Fingerprint: Electron Configuration & PES" : type + " assessment", prompt: "Explain what changes and why.\n\n- Identify your variables.\n- Describe how you would test your explanation.\n\nImportant: preserve the quantity 25 mL.", rubric: [{ name: "Explanation", maxPoints: 10, description: "Describe the process clearly and support your explanation with evidence." }], config: {} },
    latestAttempt: { attemptId: "attempt-" + type, status: "draft", provisionalScore: null }
  }));
  const starts: string[] = [];
  const unexpectedMutations: string[] = [];
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    const path = new URL(request.url()).pathname;
    if (path === "/api/student/me") {
      await route.fulfill({ headers, json: { profile: { id: user.id, displayName: "Student", email: user.email }, enrollmentStatus: "matched", courses: [{ classId: "course", classCode: "APCHEM-2627", className: "AP Chemistry", assignments }] } });
    } else if (path === "/api/attempts/start") {
      const assignment = assignments.find(a => a.assignmentId === request.postDataJSON().assignmentId)!;
      starts.push(assignment.assignmentId);
      await route.fulfill({ headers, json: {
        attemptId: "attempt-" + assignment.assignmentId, assignment,
        simulationDraft: assignment.assessment.type === "simulation" ? {
          description, simulationSketchPreview: null, activeSimulationJob: null,
          simulationPreview: { artifactId: "html-simulation", previewPath: "/artifacts/html-simulation/preview", previewToken: "synthetic", outputKind: "html", htmlViewport: { width: 1024, height: 768 } }
        } : null
      } });
    } else if (path === "/api/simulation/attempts/attempt-simulation/settings") {
      await route.fulfill({ headers, json: { sketchModelId: "gpt-image-2.5-flare", htmlModelId: "gpt-6.1-sol", htmlReasoningEffort: "high", htmlMaxOutputTokens: 64000 } });
    } else if (path.includes("/artifacts/html-simulation/preview")) {
      await route.fulfill({ headers, contentType: "text/html", body: '<!doctype html><html><body><h1>Container experiment</h1><button onclick="this.textContent=\'Experiment advanced\'">Step forward</button></body></html>' });
    } else {
      if (request.method() !== "GET") unexpectedMutations.push(path);
      await route.fulfill({ headers, json: {} });
    }
  });
  return { starts, unexpectedMutations };
}

test("layout switches preserve simulation state, enlarge text, and persist across assignments", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const f = await fixture(page);
  await page.goto("./assignment/simulation");
  const group = page.getByRole("group", { name: "Assignment layout" });
  const frame = page.frameLocator('iframe[title="Safe simulation preview"]');
  const editor = page.getByLabel("Description", { exact: true });
  await expect(editor).toHaveValue(description);
  await expect(group.getByRole("button", { name: "Side by side", exact: true })).toHaveAttribute("aria-pressed", "true");
  const beforeEditor = await page.locator(".simulation-input-accordion").boundingBox();
  const beforePreview = await page.locator(".safe-preview-primary").boundingBox();
  expect(beforePreview!.x).toBeGreaterThanOrEqual(beforeEditor!.x + beforeEditor!.width);
  const smallText = await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize));
  await frame.getByRole("button", { name: "Step forward", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("assignment-side-by-side.png") });

  await group.getByRole("button", { name: "Vertical", exact: true }).click();
  await expect(page.locator(".student-assessment-page")).toHaveAttribute("data-assignment-layout", "vertical");
  await expect(frame.getByRole("button", { name: "Experiment advanced", exact: true })).toBeVisible();
  await expect(editor).toHaveValue(description);
  const stackedEditor = await page.locator(".simulation-input-accordion").boundingBox();
  const stackedPreview = await page.locator(".safe-preview-primary").boundingBox();
  expect(stackedPreview!.y).toBeGreaterThanOrEqual(stackedEditor!.y + stackedEditor!.height);
  expect(Math.abs(stackedPreview!.x - stackedEditor!.x)).toBeLessThan(2);
  expect(stackedEditor!.width).toBeGreaterThan(beforeEditor!.width);
  expect(await editor.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(smallText);
  expect(await page.getByLabel("Assignment instructions", { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(18);
  await page.screenshot({ path: testInfo.outputPath("assignment-vertical-large-text.png"), fullPage: true });

  await group.getByRole("button", { name: "Side by side", exact: true }).click();
  await expect(frame.getByRole("button", { name: "Experiment advanced", exact: true })).toBeVisible();
  const edited = description + " Keep both containers labelled.";
  await editor.fill(edited);
  await group.getByRole("button", { name: "Vertical", exact: true }).click();
  await group.getByRole("button", { name: "Side by side", exact: true }).click();
  await expect(editor).toHaveValue(edited);
  await group.getByRole("button", { name: "Vertical", exact: true }).click();
  expect(f.starts).toEqual(["simulation"]);
  expect(f.unexpectedMutations).toEqual([]);
  expect(await page.evaluate(key => localStorage.getItem(key), layoutKey)).toBe("vertical");
  await page.reload();
  await expect(group.getByRole("button", { name: "Vertical", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor).toHaveValue(edited);

  await page.goto("./assignment/writing");
  await expect(group.getByRole("button", { name: "Vertical", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".upload-panel")).toBeVisible();
});

for (const type of ["writing", "voice", "voice_realtime"] as const) {
  test(type + " supports both layouts and larger text without losing its response panel", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    const f = await fixture(page);
    await page.goto("./assignment/" + type);
    const response = page.locator(type === "writing" ? ".upload-panel" : ".recorder-panel");
    await expect(response).toBeVisible();
    const before = await response.boundingBox();
    const rubric = await page.locator(".feedback-panel").boundingBox();
    expect(rubric!.x).toBeGreaterThanOrEqual(before!.x + before!.width);
    if (type === "writing") {
      await page.locator('input[type="file"]').setInputFiles({ name: "my-explanation.png", mimeType: "image/png", buffer: png });
      await expect(page.getByRole("button", { name: "Submit written work", exact: true })).toBeEnabled();
    }
    const group = page.getByRole("group", { name: "Assignment layout" });
    await group.getByRole("button", { name: "Vertical", exact: true }).click();
    const after = await response.boundingBox();
    const stackedRubric = await page.locator(".feedback-panel").boundingBox();
    expect(stackedRubric!.y).toBeGreaterThanOrEqual(after!.y + after!.height);
    expect(after!.width).toBeGreaterThan(before!.width);
    expect(await page.locator(".criterion-row p").evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBe(18);
    if (type === "writing") {
      await expect(page.locator(".file-preview")).toContainText("my-explanation.png");
      await expect(page.getByRole("button", { name: "Submit written work", exact: true })).toBeEnabled();
    }
    for (const width of [1366, 1024, 390]) {
      await page.setViewportSize({ width, height: 768 });
      for (const label of ["Side by side", "Vertical"]) {
        await group.getByRole("button", { name: label, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await expect(page.getByLabel("Assignment instructions", { exact: true })).toContainText("25 mL");
      }
      if (width === 390) await page.screenshot({ path: testInfo.outputPath(type + "-vertical-mobile.png"), fullPage: true });
    }
    expect(f.starts).toEqual([type]);
    expect(f.unexpectedMutations).toEqual([]);
  });
}
