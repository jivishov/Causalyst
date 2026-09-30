import { test, expect } from "@playwright/test";
import { AI_MODEL_ROLES, modelCapabilityForRole, type TeacherAiSettings } from "../shared/src/index";

test("teacher provider lists, model assignments, and token controls work on desktop and mobile", async ({ page }) => {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "teacher@test.invalid", is_anonymous: false, role: "authenticated", app_metadata: { provider: "google" }, user_metadata: {} };
  await page.addInitScript(user => {
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600 }))}.synthetic`;
    localStorage.setItem("alt-assessment.teacher-auth", JSON.stringify({ access_token: token, refresh_token: "synthetic-refresh", expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: "bearer", user }));
  }, user);
  await page.route("https://auth.test/**", route => route.fulfill({ json: { user } }));
  const providerModels: NonNullable<TeacherAiSettings["providerModels"]> = [
    { id: "openai:gpt-5.6-sol", provider: "openai", label: "OpenAI GPT-6.1 Sol", modelId: "gpt-6.1-sol", capability: "text", reasoningEffort: "max", maxOutputTokens: 64000, enabled: true },
    { id: "openai:transcribe", provider: "openai", label: "Transcription", modelId: "gpt-4o-transcribe", capability: "transcription", reasoningEffort: "none", enabled: false },
    { id: "openai:image", provider: "openai", label: "Sketch image", modelId: "gpt-image-2.5-flare", capability: "image", reasoningEffort: "none", enabled: false },
    { id: "openai:voice", provider: "openai", label: "Live voice", modelId: "gpt-realtime", capability: "realtime", reasoningEffort: "none", enabled: false }
  ];
  let settings: TeacherAiSettings = { updatedAt: null, keys: { openai: { configured: true, source: "server" }, kimi: { configured: false, source: "missing" }, zai: { configured: false, source: "missing" } },
    providerModels, codeModels: providerModels.filter(model => model.capability === "text"), defaultSimulationModelId: providerModels[0].id, forceDefaultSimulationModel: false,
    roleModels: Object.fromEntries(AI_MODEL_ROLES.map(role => { const model = providerModels.find(model => model.capability === modelCapabilityForRole(role))!;
      return [role, { id: model.modelId, catalogModelId: model.id, reasoningEffort: model.reasoningEffort, maxOutputTokens: model.maxOutputTokens }];
    })) as TeacherAiSettings["roleModels"] };
  await page.route("http://127.0.0.1:8787/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*" };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    let json: unknown = {};
    if (path === "/api/teacher/setup-status") json = { setupAvailable: false };
    else if (path === "/api/teacher/me") json = { profile: { id: user.id, displayName: "Preview teacher", email: user.email, role: "teacher" } };
    else if (path === "/api/teacher/courses") json = { courses: [] };
    else if (path === "/api/teacher/assessments") json = { assessments: [] };
    else if (path === "/api/teacher/ai-settings") {
      if (route.request().method() === "PUT") settings = { ...settings, ...route.request().postDataJSON(), updatedAt: "2026-09-30T12:00:00Z" };
      json = settings;
    }
    await route.fulfill({ headers, json });
  });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto("./teacher/ai-settings");
  await expect(page.getByRole("heading", { name: "Providers and model lists" })).toBeVisible();
  await expect(page.getByLabel("Voice grading", { exact: true })).toHaveValue("openai:gpt-5.6-sol");
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  const card = page.locator(".ai-provider-model-card").first();
  await expect(card.getByLabel("Display name", { exact: true })).toHaveValue("New model");
  await expect(card.getByLabel("Display name", { exact: true })).toBeFocused();
  const dimensions = await card.evaluate(element => ({
    cardHeight: element.getBoundingClientRect().height,
    fields: [...element.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input:not([type=checkbox]), select")].map(input => ({ width: input.getBoundingClientRect().width, height: input.getBoundingClientRect().height }))
  }));
  expect(dimensions.cardHeight).toBeLessThan(170);
  for (const field of dimensions.fields) {
    expect(field.width).toBeLessThanOrEqual(260);
    expect(field.height).toBeLessThanOrEqual(38);
  }
  await card.getByLabel("Display name", { exact: true }).fill("Classroom model");
  await card.getByLabel("Provider model ID", { exact: true }).fill("synthetic-classroom-model");
  await page.getByLabel("Classroom model reasoning", { exact: true }).selectOption("xhigh");
  await page.getByLabel("Classroom model token limit", { exact: true }).fill("28000");
  await page.getByLabel("Voice grading", { exact: true }).selectOption({ label: "Classroom model (synthetic-classroom-model)" });
  await expect(page.getByLabel("Voice grading token limit", { exact: true })).toHaveValue("28000");
  await expect(page.getByRole("button", { name: "Remove Classroom model", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Save settings", exact: true }).first().click();
  await expect(page.getByText(/Saved\. New attempts/)).toBeVisible();
  await page.getByRole("button", { name: "Reload saved settings", exact: true }).click();
  await expect(page.getByLabel("Voice grading reasoning", { exact: true })).toHaveValue("xhigh");
  await expect(page.locator(".ai-provider-model-card").first().getByLabel("Display name", { exact: true })).toHaveValue("Classroom model");
  await page.getByRole("button", { name: "Kimi / Moonshot (0)", exact: true }).click();
  await page.getByRole("button", { name: "Add model", exact: true }).click();
  await page.getByRole("button", { name: "Remove New model", exact: true }).click();
  await expect(page.getByText("No models for this provider. Add a model to make it available.")).toBeVisible();
  await page.getByRole("button", { name: "OpenAI (5)", exact: true }).click();
  for (const width of [1366, 1024, 375]) {
    await page.setViewportSize({ width, height: 768 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
