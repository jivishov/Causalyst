import { expect, test, type Page } from "@playwright/test";
import { AI_MODEL_ROLES, modelCapabilityForRole, type TeacherAiSettings, type TeacherAssessment } from "../shared/src/index";

const generated = { title: "Boyle's law investigation", prompt: "Explain why pressure rises as volume falls for a fixed amount of gas at constant temperature. Predict the pressure when volume halves, test your model, and describe its limits.", expectedAnswer: "At fixed temperature and gas amount, P1V1=P2V2; halving volume doubles pressure.",
  rubric: [{ name: "Scientific reasoning", maxPoints: 10, description: "Full credit: explains the inverse relationship and controlled conditions. Partial: gives the trend only. None: gives the wrong trend." }, { name: "Prediction and reflection", maxPoints: 10, description: "Full credit: correct prediction with observations and model limits. Partial: prediction without reflection. None: unsupported prediction." }] };

async function fixture(page: Page) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "teacher@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 }))}.synthetic`;
    localStorage.setItem("alt-assessment.teacher-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const providerModels: NonNullable<TeacherAiSettings["providerModels"]> = [
    { id: "openai:sol", provider: "openai", label: "GPT-6.1 Sol", modelId: "gpt-6.1-sol", capability: "text", reasoningEffort: "medium", maxOutputTokens: 16000, enabled: true },
    { id: "openai:transcribe", provider: "openai", label: "Transcription", modelId: "gpt-4o-transcribe", capability: "transcription", reasoningEffort: "none", enabled: false },
    { id: "openai:image", provider: "openai", label: "Image", modelId: "gpt-image-2.5-flare", capability: "image", reasoningEffort: "none", enabled: false },
    { id: "openai:voice", provider: "openai", label: "Live voice", modelId: "gpt-realtime", capability: "realtime", reasoningEffort: "none", enabled: false }
  ];
  const settings: TeacherAiSettings = { updatedAt: null, keys: { openai: { configured: true, source: "server" }, kimi: { configured: false, source: "missing" }, zai: { configured: false, source: "missing" } }, providerModels,
    codeModels: [providerModels[0]], defaultSimulationModelId: "openai:sol", forceDefaultSimulationModel: false,
    roleModels: Object.fromEntries(AI_MODEL_ROLES.map(role => { const model = providerModels.find(model => model.capability === modelCapabilityForRole(role))!; return [role, { id: model.modelId, catalogModelId: model.id, reasoningEffort: model.reasoningEffort, maxOutputTokens: model.maxOutputTokens }]; })) as TeacherAiSettings["roleModels"] };
  const requests: any[] = [];
  const assessments: TeacherAssessment[] = [];
  let saves = 0;
  let fail = false;
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let json: unknown = {};
    if (path === "/api/teacher/setup-status") json = { setupAvailable: false };
    else if (path === "/api/teacher/me") json = { profile: { id: user.id, displayName: "Demo teacher", email: user.email, role: "teacher" } };
    else if (path === "/api/teacher/courses") json = { courses: [] };
    else if (path === "/api/teacher/ai-settings") json = settings;
    else if (path === "/api/teacher/assessments/generate") {
      const input = route.request().postDataJSON(); requests.push(input);
      if (fail) return route.fulfill({ status: 502, headers, json: { error: "Synthetic provider failure. Your draft was kept." } });
      const rubric = input.action === "reviewRubric" ? [{ name: "Revised reasoning", maxPoints: 20, description: "Clear full, partial, and no-credit descriptors aligned with constant-temperature gas reasoning." }] : generated.rubric;
      json = { action: input.action, draft: input.action === "assessment" ? generated : null, rubric, feedback: input.action === "assessment" ? [] : ["Clarified partial credit and alignment with the assessment."], model: { provider: "openai", id: "gpt-6.1-sol", reasoningEffort: "medium", maxOutputTokens: 16000, fastMode: false } };
    }
    else if (path === "/api/teacher/assessments") {
      if (route.request().method() === "POST") {
        saves++;
        const assessment = { ...route.request().postDataJSON(), id: "new", createdAt: "2026-10-05", updatedAt: "2026-10-05", archivedAt: null };
        assessments.push(assessment);
        json = { assessment };
      }
      else json = { assessments };
    }
    else if (path === "/api/teacher/assignments") json = { assignments: [] };
    else if (path === "/api/teacher/attempts") json = { attempts: [] };
    else if (path === "/api/teacher/gradebook") json = { entries: [] };
    await route.fulfill({ headers, json });
  });
  return { requests, get saves() { return saves; }, get savedAssessment() { return assessments[0]; }, setFail() { fail = true; } };
}

test("AI fills an editable draft, preserves the request, reviews rubrics before applying, and saves only on Create", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await page.goto("teacher/assessments");
  await page.getByLabel("Type", { exact: true }).selectOption("simulation");
  await page.getByRole("button", { name: "Generate assessment with AI", exact: true }).click();
  const request = "Create an Honors Chemistry Boyle's law simulation assessment with a 20-point rubric.";
  await page.getByRole("textbox", { name: "AI assessment request", exact: true }).fill(request);
  await page.getByRole("button", { name: "Generate Now", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(generated.title);
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue(generated.prompt);
  await expect(page.getByRole("textbox", { name: "Expected answer (optional)", exact: true })).toHaveValue(generated.expectedAnswer);
  await expect(page.getByRole("textbox", { name: "AI assessment request", exact: true })).toHaveValue(request);
  expect(state.saves).toBe(0);
  await page.getByRole("button", { name: "Generate assessment with AI", exact: true }).click();
  await page.getByRole("button", { name: "Generate assessment with AI", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "AI assessment request", exact: true })).toHaveValue(request);
  await page.getByRole("tab", { name: "Rubric", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue("Scientific reasoning");
  await page.getByRole("button", { name: "Review rubric with AI", exact: true }).click();
  await page.getByRole("button", { name: "Generate Now", exact: true }).click();
  await expect(page.getByRole("heading", { name: "AI feedback", exact: true })).toBeVisible();
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue("Scientific reasoning");
  await page.getByLabel("Title", { exact: true }).fill("Changed since the rubric review");
  await expect(page.getByRole("button", { name: "Apply revised rubric", exact: true })).toBeDisabled();
  await page.getByLabel("Title", { exact: true }).fill(generated.title);
  await page.getByRole("button", { name: "Apply revised rubric", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue("Revised reasoning");
  await page.getByRole("button", { name: "Undo AI changes", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true }).first()).toHaveValue("Scientific reasoning");
  await page.getByRole("button", { name: "Generate rubric with AI", exact: true }).click();
  await page.getByRole("button", { name: "Generate Now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply generated rubric", exact: true })).toBeVisible();
  expect(state.requests[2].assessment.prompt).toBe(generated.prompt);
  await page.getByRole("button", { name: "Apply generated rubric", exact: true }).click();
  await page.getByRole("tab", { name: "Prompt", exact: true }).click();
  await page.getByRole("button", { name: "Generate assessment with AI", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "AI assessment request", exact: true })).toHaveValue(request);
  await page.screenshot({ path: testInfo.outputPath("assessment-builder-ai.png"), fullPage: true });
  for (const width of [1366, 1024, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Create assessment", exact: true }).click();
  await expect(page.getByRole("article", { name: generated.title, exact: true })).toBeVisible();
  expect(state.saves).toBe(1);
  expect(state.savedAssessment.prompt).toBe(generated.prompt);
  expect(JSON.stringify(state.savedAssessment)).not.toContain(request);
});

test("provider errors preserve the draft and AI request", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("teacher/assessments");
  await page.getByLabel("Title", { exact: true }).fill("Keep this title");
  await page.getByRole("textbox", { name: "Prompt", exact: true }).fill("Keep this student-facing prompt.");
  await page.getByRole("button", { name: "Generate assessment with AI", exact: true }).click();
  await page.getByRole("textbox", { name: "AI assessment request", exact: true }).fill("Improve the draft for grade 10 chemistry.");
  state.setFail();
  await page.getByRole("button", { name: "Generate Now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Your draft was kept");
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Keep this title");
  await expect(page.getByRole("textbox", { name: "Prompt", exact: true })).toHaveValue("Keep this student-facing prompt.");
  await expect(page.getByRole("textbox", { name: "AI assessment request", exact: true })).toHaveValue("Improve the draft for grade 10 chemistry.");
  expect(state.saves).toBe(0);
});
