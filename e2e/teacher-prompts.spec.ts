import { expect, test, type Page } from "@playwright/test";
import type { AiPromptOverrides, TeacherAssessment, TeacherAssignment, TeacherCourse } from "../shared/src/index";
import { resolvePromptContext } from "../worker/src/lib/aiPrompts";

async function fixture(page: Page) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "teacher@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 }))}.synthetic`;
    localStorage.setItem("alt-assessment.teacher-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const courses: TeacherCourse[] = ["A", "B"].map(id => ({ id, code: `CHEM-${id}`, name: `Chemistry ${id}`, section: id, term: "Fall", archivedAt: null, createdAt: "2026-10-01", updatedAt: "2026-10-01" }));
  let assessment: TeacherAssessment = { id: "gas", type: "simulation", title: "Gas laws", prompt: "Explain gas pressure and volume", expectedAnswer: "PRIVATE ANSWER KEY", rubric: [{ id: "r1", name: "Reasoning", maxPoints: 10, description: "Supported relationships" }], config: {}, createdAt: "2026-10-01", updatedAt: "2026-10-01", archivedAt: null };
  const assignments: TeacherAssignment[] = [];
  const saved: any[] = [];
  const assessmentPrompts = new Map<TeacherAssessment["type"], AiPromptOverrides>();
  const assignmentPrompts = new Map<string, AiPromptOverrides>();
  let failSave = false;
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let json: unknown = {};
    if (path === "/api/teacher/me") json = { profile: { id: user.id, email: user.email, displayName: "Demo teacher", role: "teacher" } };
    else if (path === "/api/teacher/setup-status") json = { setupAvailable: false };
    else if (path === "/api/teacher/courses") json = { courses };
    else if (path.endsWith("/roster")) json = { students: [] };
    else if (path === "/api/teacher/ai-settings") return route.fulfill({ status: 503, headers, json: { error: "Synthetic fixture" } });
    else if (path === "/api/teacher/ai-prompts") {
      const scope = url.searchParams.has("assignmentId") ? "assignment" : url.searchParams.has("assessmentId") ? "assessment" : "defaults";
      const id = url.searchParams.get("assignmentId");
      const type = (url.searchParams.get("type") ?? assessment.type) as TeacherAssessment["type"];
      json = resolvePromptContext({ type, assessment: assessmentPrompts.get(type),
        assessmentUpdatedAt: assessmentPrompts.has(type) ? "2026-10-08T04:00:00Z" : null,
        assignment: id ? assignmentPrompts.get(id) : {}, assignmentUpdatedAt: id ? "2026-10-08T04:00:00Z" : null }, scope, id ?? assessment.id);
    }
    else if (path === "/api/teacher/assessments") json = { assessments: [assessment] };
    else if (path === "/api/teacher/assessments/gas" && req.method() === "PUT") {
      const body = req.postDataJSON(); saved.push(body); assessment = { ...assessment, ...body }; assessmentPrompts.set(assessment.type, body.aiPrompts); json = { assessment };
    }
    else if (path === "/api/teacher/assignments" && req.method() === "POST") {
      const body = req.postDataJSON(); saved.push(body);
      const id = `assignment-${assignments.length}`;
      const assignment = { id, classId: body.courseId, assessmentId: body.assessmentId, opensAt: body.opensAt, dueAt: body.dueAt, assessment,
        course: courses.find(course => course.id === body.courseId)!, archivedAt: null, createdAt: "2026-10-08", updatedAt: "2026-10-08" };
      assignments.push(assignment); assignmentPrompts.set(id, body.aiPrompts); json = { assignment };
    }
    else if (path.startsWith("/api/teacher/assignments/") && req.method() === "PUT") {
      if (failSave) return route.fulfill({ status: 409, headers, json: { error: "This assignment or its prompts changed in another tab. Reload before saving. Your draft is kept." } });
      const body = req.postDataJSON(); saved.push(body);
      const id = path.split("/").at(-1)!; assignmentPrompts.set(id, body.aiPrompts); json = { assignment: assignments.find(item => item.id === id) };
    }
    else if (path === "/api/teacher/assignments") json = { assignments };
    else if (path === "/api/teacher/attempts") json = { attempts: [] };
    else if (path === "/api/teacher/gradebook") json = { entries: [] };
    await route.fulfill({ headers, json });
  });
  return { saved, assignmentPrompts, fail: () => { failSave = true; } };
}

test("two class assignments have independent system and user prompts and stale saves keep the draft", async ({ page }, info) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("teacher/assignments?assessment=gas");
  await page.getByLabel("AI step", { exact: true }).selectOption("simulationHtml");
  await page.getByLabel("System prompt", { exact: true }).fill("Class A: use large scientific labels.");
  await page.getByLabel("User prompt", { exact: true }).fill("Class A: show the original explanation. {{context}}");
  await page.getByLabel("Course", { exact: true }).selectOption("A");
  await page.screenshot({ path: info.outputPath("assignment-ai-prompts-desktop.png") });
  await page.getByRole("button", { name: "Create assignment", exact: true }).click();
  await expect(page.locator(".course-row")).toHaveCount(1);
  await page.getByLabel("AI step", { exact: true }).selectOption("simulationHtml");
  await expect(page.getByLabel("System prompt", { exact: true })).not.toHaveValue(/Class A/);
  await page.getByLabel("System prompt", { exact: true }).fill("Class B: use a compact Spanish interface.");
  await page.getByLabel("User prompt", { exact: true }).fill("Class B: write in Spanish. {{context}}");
  await page.getByLabel("Course", { exact: true }).selectOption("B");
  await page.getByRole("button", { name: "Create assignment", exact: true }).click();
  await expect(page.locator(".course-row")).toHaveCount(2);
  expect(f.saved[0].courseId).toBe("A");
  expect(f.saved[1].courseId).toBe("B");
  expect(f.assignmentPrompts.get("assignment-0")?.simulationHtml?.system).toContain("Class A");
  expect(f.assignmentPrompts.get("assignment-1")?.simulationHtml?.system).toContain("Class B");
  await page.locator(".course-row").first().getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("AI step", { exact: true }).selectOption("simulationHtml");
  await expect(page.getByLabel("System prompt", { exact: true })).toHaveValue(/Class A/);
  await page.getByLabel("System prompt", { exact: true }).fill("Unsaved revision kept on conflict.");
  f.fail(); await page.getByRole("button", { name: "Save assignment", exact: true }).click();
  await expect(page.getByText(/changed in another tab/)).toBeVisible();
  await expect(page.getByLabel("System prompt", { exact: true })).toHaveValue("Unsaved revision kept on conflict.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("System prompt", { exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath("assignment-ai-prompts-mobile.png") });
});

test("assessment prompts are prefilled, editable and saved with the assessment", async ({ page }, info) => {
  const f = await fixture(page);
  await page.goto("teacher/assessments");
  await page.getByRole("article", { name: "Gas laws", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("tab", { name: "AI prompts", exact: true }).click();
  await page.getByLabel("AI step", { exact: true }).selectOption("simulationSketch");
  await expect(page.getByLabel("System prompt", { exact: true })).toHaveValue(/literal classroom/);
  await page.getByLabel("System prompt", { exact: true }).fill("Use only student evidence in a clean labeled diagram.");
  await page.getByLabel("User prompt", { exact: true }).fill("Draw this explanation: {{studentDescription}}");
  await page.screenshot({ path: info.outputPath("assessment-ai-prompts.png") });
  await page.getByRole("button", { name: "Save assessment", exact: true }).click();
  await expect.poll(() => f.saved.length).toBe(1);
  await expect(page.getByRole("button", { name: "Save assessment", exact: true })).toBeHidden();
  expect(f.saved[0].aiPrompts.simulationSketch).toEqual({ system: "Use only student evidence in a clean labeled diagram.", user: "Draw this explanation: {{studentDescription}}" });
  expect(f.saved[0].expectedAnswer).toBe("PRIVATE ANSWER KEY");
  // Returning to a previous format must restore its prompts and revision.
  await page.getByRole("article", { name: "Gas laws", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("voice");
  await page.getByRole("tab", { name: "AI prompts", exact: true }).click();
  await page.getByLabel("AI step", { exact: true }).selectOption("voiceGrade");
  await page.getByLabel("System prompt", { exact: true }).fill("Voice format grading instructions.");
  await page.getByRole("button", { name: "Save assessment", exact: true }).click();
  await expect.poll(() => f.saved.length).toBe(2);
  await expect(page.getByRole("button", { name: "Save assessment", exact: true })).toBeHidden();
  await page.getByRole("article", { name: "Gas laws", exact: true }).getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByLabel("Type", { exact: true }).selectOption("simulation");
  await page.getByRole("tab", { name: "AI prompts", exact: true }).click();
  await page.getByLabel("AI step", { exact: true }).selectOption("simulationSketch");
  await expect(page.getByLabel("System prompt", { exact: true })).toHaveValue("Use only student evidence in a clean labeled diagram.");
  await page.getByRole("button", { name: "Save assessment", exact: true }).click();
  await expect.poll(() => f.saved.length).toBe(3);
  expect(f.saved[2].expectedPromptUpdatedAt).toBe("2026-10-08T04:00:00Z");
  expect(f.saved[2].expectedAnswer).toBe("PRIVATE ANSWER KEY");
});
