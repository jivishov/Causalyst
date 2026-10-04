import { test, expect, type Page } from "@playwright/test";
import type { TeacherAssessment } from "../shared/src/index";

async function teacherFixture(page: Page) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "teacher@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 }))}.synthetic`;
    localStorage.setItem("alt-assessment.teacher-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const course = { id: "course", code: "CHEM-26", name: "Chemistry", section: "A", term: "Fall 2026", archivedAt: null, createdAt: "2026-10-01", updatedAt: "2026-10-01" };
  let assessments: TeacherAssessment[] = ["writing", "simulation", "voice"].map((type, index) => ({ id: `assessment-${index}`, type: type as TeacherAssessment["type"], title: ["Finding to question", "Gas laws", "Chemical bonds"][index], prompt: "Explain how the evidence supports your scientific reasoning. Include a specific example.", expectedAnswer: "Private teacher answer key", rubric: [{ id: "criterion", name: "Scientific reasoning", description: "A clear explanation supported by evidence.", maxPoints: 10 }], config: { scoringPolicy: { mode: "additive", caps: [] }, minDescriptionChars: 120, simulationCodeModelId: "openai:gpt-5.6-sol" }, createdAt: "2026-10-01", updatedAt: "2026-10-01", archivedAt: null }));
  const saved: Record<string, unknown>[] = [];
  const assignments: Record<string, unknown>[] = [];
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let json: unknown = {};
    if (path === "/api/teacher/setup-status") json = { setupAvailable: false };
    else if (path === "/api/teacher/me") json = { profile: { id: user.id, displayName: "Demo teacher", email: user.email, role: "teacher" } };
    else if (path === "/api/teacher/courses") json = { courses: [course] };
    else if (path.endsWith("/roster")) json = { courseId: course.id, students: [] };
    else if (path === "/api/teacher/assessments") json = { assessments };
    else if (path === "/api/teacher/ai-settings") return route.fulfill({ status: 503, headers, json: { error: "Synthetic model-settings fixture unavailable" } });
    else if (path.startsWith("/api/teacher/assessments/") && route.request().method() === "PUT") {
      const payload = route.request().postDataJSON(); saved.push(payload);
      assessments = assessments.map(a => a.id === path.split("/").at(-1) ? { ...a, ...payload } : a);
      json = { assessment: assessments.find(a => a.id === path.split("/").at(-1)) };
    }
    else if (path === "/api/teacher/assignments") {
      if (route.request().method() === "POST") {
        const payload = route.request().postDataJSON();
        const assessment = assessments.find(a => a.id === payload.assessmentId)!;
        const assignment = { ...payload, id: "assignment", classId: payload.courseId, archivedAt: null, assessment, course, createdAt: "2026-10-01", updatedAt: "2026-10-01" };
        assignments.push(assignment); json = { assignment };
      } else json = { assignments };
    }
    else if (path === "/api/teacher/attempts") json = { attempts: [] };
    else if (path === "/api/teacher/gradebook") json = { entries: [] };
    await route.fulfill({ headers, json });
  });
  return { saved, assignments };
}

test("teacher builder preserves draft fields across tabs, previews student content, saves, and assigns the selected assessment", async ({ page }, testInfo) => {
  const fixture = await teacherFixture(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("teacher/assessments");
  await expect(page.getByRole("heading", { name: "Assessments", exact: true })).toBeVisible();
  const gasRow = page.getByRole("article", { name: "Gas laws", exact: true });
  await gasRow.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill("Gas pressure and volume");
  await page.getByRole("tab", { name: "Rubric", exact: true }).click();
  await page.getByLabel("Max points", { exact: true }).fill("20");
  await page.getByRole("tab", { name: "Prompt", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Gas pressure and volume");
  await page.getByRole("button", { name: "Student preview", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("20 points");
  await expect(page.getByRole("dialog")).not.toContainText("Private teacher answer key");
  await page.getByRole("button", { name: "Back to editing", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("working-teacher-builder.png") });
  await page.getByRole("button", { name: "Save assessment", exact: true }).click();
  await expect(page.getByRole("article", { name: "Gas pressure and volume", exact: true })).toBeVisible();
  expect(fixture.saved[0]).toMatchObject({ title: "Gas pressure and volume", rubric: [{ maxPoints: 20 }], expectedAnswer: "Private teacher answer key", config: { minDescriptionChars: 120, simulationCodeModelId: "openai:gpt-5.6-sol" } });
  await page.getByRole("article", { name: "Gas pressure and volume", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("link", { name: "Assign to a class", exact: true }).click();
  await expect(page.getByLabel("Assessment", { exact: true })).toHaveValue("assessment-1");
  await page.getByLabel("Due at", { exact: true }).fill("2026-11-15T15:30");
  await page.getByRole("button", { name: "Create assignment", exact: true }).click();
  await expect(page.locator(".course-row")).toContainText("Gas pressure and volume");
  expect(fixture.assignments[0]).toMatchObject({ assessmentId: "assessment-1", classId: "course" });
});

test("teacher pages remain usable on mobile and validation opens the field's tab", async ({ page }, testInfo) => {
  await teacherFixture(page);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("teacher/assessments");
  await page.getByRole("button", { name: "New assessment", exact: true }).click();
  await page.getByRole("tab", { name: "Rubric", exact: true }).click();
  await page.getByRole("button", { name: "Create assessment", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Prompt", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Title", { exact: true })).toBeFocused();
  await page.getByLabel("Title", { exact: true }).fill("Voice explanation");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Explain your scientific reasoning with a specific example.");
  await page.getByRole("tab", { name: "Models & settings", exact: true }).click();
  await page.getByLabel("Max recording seconds", { exact: true }).fill("invalid");
  await page.locator("#builder-panel-settings summary").click();
  await page.getByRole("tab", { name: "Prompt", exact: true }).click();
  await page.getByRole("button", { name: "Create assessment", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Models & settings", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Max recording seconds", { exact: true })).toBeFocused();
  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["teacher/assessments", "teacher", "teacher/assignments", "teacher/review", "teacher/gradebook"]) {
      await page.goto(route);
      await expect(page.locator(".teacher-design")).toBeVisible();
      await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${route} at ${width}px`).toBe(true);
    }
  }
  await page.goto("teacher/assessments");
  await page.getByRole("article", { name: "Gas laws", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("working-teacher-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
