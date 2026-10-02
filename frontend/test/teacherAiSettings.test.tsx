// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AI_MODEL_ROLES, modelCapabilityForRole, type TeacherAiSettings } from "@alt-assessment/shared";
import { TeacherAiSettingsPage } from "../src/pages/teacher/TeacherAiSettingsPage";
import { teacherApiFetch } from "../src/lib/api";

vi.mock("../src/lib/api", () => ({ teacherApiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function fixture(): TeacherAiSettings {
  const providerModels: NonNullable<TeacherAiSettings["providerModels"]> = [
    { id: "openai:gpt-5.6-sol", provider: "openai", label: "OpenAI GPT-6.1 Sol", modelId: "gpt-6.1-sol", capability: "text", reasoningEffort: "max", maxOutputTokens: 64000, enabled: true },
    { id: "openai:transcribe", provider: "openai", label: "Transcription", modelId: "gpt-4o-transcribe", capability: "transcription", reasoningEffort: "none", enabled: false },
    { id: "openai:image", provider: "openai", label: "Sketch image", modelId: "gpt-image-2.5-flare", capability: "image", reasoningEffort: "none", enabled: false },
    { id: "openai:voice", provider: "openai", label: "Live voice", modelId: "gpt-realtime", capability: "realtime", reasoningEffort: "none", enabled: false }
  ];
  const roleModels = Object.fromEntries(AI_MODEL_ROLES.map(role => {
    const model = providerModels.find(model => model.capability === modelCapabilityForRole(role))!;
    return [role, { id: model.modelId, catalogModelId: model.id, reasoningEffort: model.reasoningEffort, maxOutputTokens: model.maxOutputTokens }];
  })) as TeacherAiSettings["roleModels"];
  return { updatedAt: null, keys: { openai: { configured: true, source: "server" }, kimi: { configured: false, source: "missing" }, zai: { configured: false, source: "missing" } },
    roleModels, providerModels, codeModels: providerModels.filter(model => model.capability === "text"), defaultSimulationModelId: providerModels[0].id, forceDefaultSimulationModel: false };
}

it("adds a provider model, assigns it through role dropdowns, and saves effort and token limits", async () => {
  const settings = fixture();
  vi.mocked(teacherApiFetch).mockResolvedValue(settings);
  render(<TeacherAiSettingsPage />);
  await screen.findByText("Providers and model lists");
  const solEfforts = [...(screen.getByLabelText("OpenAI GPT-6.1 Sol reasoning") as HTMLSelectElement).options].map(option => option.value);
  expect(solEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  expect((screen.getByLabelText("Audio transcription") as HTMLSelectElement).options.length).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  const newCard = screen.getAllByRole("article").find(card => within(card).queryByDisplayValue("New model"))!;
  expect(newCard).toBe(document.querySelector(".ai-provider-model-card"));
  expect(document.activeElement).toBe(within(newCard).getByLabelText("Display name"));
  fireEvent.change(within(newCard).getByLabelText("Display name"), { target: { value: "Classroom model" } });
  fireEvent.change(within(newCard).getByLabelText("Provider model ID"), { target: { value: "synthetic-classroom-model" } });
  fireEvent.change(screen.getByLabelText("Classroom model reasoning"), { target: { value: "low" } });
  fireEvent.change(screen.getByLabelText("Classroom model token limit"), { target: { value: "25000" } });
  const gradingSelect = screen.getByLabelText("Voice grading") as HTMLSelectElement;
  const addedId = [...gradingSelect.options].find(option => option.textContent?.startsWith("Classroom model"))!.value;
  fireEvent.change(gradingSelect, { target: { value: addedId } });
  expect((screen.getByLabelText("Voice grading token limit") as HTMLInputElement).value).toBe("25000");
  expect((screen.getByRole("button", { name: "Remove Classroom model" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
  await screen.findByText(/Saved\. New previews/);
  const [, options] = vi.mocked(teacherApiFetch).mock.calls.find(([path, options]) => path === "/teacher/ai-settings" && options?.method === "PUT")!;
  const saved = JSON.parse(options!.body as string);
  expect(saved.roleModels.grading).toMatchObject({ id: "synthetic-classroom-model", catalogModelId: addedId, reasoningEffort: "low", maxOutputTokens: 25000 });
  expect(saved.providerModels.some((model: { id: string }) => model.id === addedId)).toBe(true);
});

it("keeps provider model lists separate and removes a newly added unused model", async () => {
  vi.mocked(teacherApiFetch).mockResolvedValue(fixture());
  render(<TeacherAiSettingsPage />);
  await screen.findByText("Providers and model lists");
  fireEvent.click(screen.getByRole("button", { name: "Kimi / Moonshot (0)" }));
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  expect(screen.getByDisplayValue("New model")).toBeTruthy();
  expect(screen.queryByLabelText("OpenAI GPT-6.1 Sol reasoning")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove New model" }));
  expect(screen.queryByDisplayValue("New model")).toBeNull();
  expect(screen.getByText("No models for this provider. Add a model to make it available.")).toBeTruthy();
});

it("keeps an assigned Sol capability control active and excludes incompatible task APIs", async () => {
  vi.mocked(teacherApiFetch).mockResolvedValue(fixture());
  render(<TeacherAiSettingsPage />);
  await screen.findByText("Providers and model lists");
  const card = screen.getAllByRole("article").find(card => within(card).queryByDisplayValue("gpt-6.1-sol"))!;
  const select = within(card).getByLabelText("Model capability") as HTMLSelectElement;
  expect(select.disabled).toBe(false);
  expect([...select.options].filter(option => !option.disabled).map(option => option.value)).toEqual(["text"]);
  expect(select.value).toBe("text");
  expect(select.getAttribute("aria-describedby")).toBe("ai-model-capability-help");
});

it("changes an unused custom model capability and saves its compatible assignment", async () => {
  vi.mocked(teacherApiFetch).mockResolvedValue(fixture());
  render(<TeacherAiSettingsPage />);
  await screen.findByText("Providers and model lists");
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  const card = screen.getAllByRole("article").find(card => within(card).queryByDisplayValue("New model"))!;
  fireEvent.change(within(card).getByLabelText("Display name"), { target: { value: "Classroom image" } });
  fireEvent.change(within(card).getByLabelText("Provider model ID"), { target: { value: "synthetic-approved-image-model" } });
  fireEvent.change(within(card).getByLabelText("Model capability"), { target: { value: "image" } });
  expect(screen.queryByLabelText("Classroom image reasoning")).toBeNull();
  const imageSelect = screen.getByLabelText("Simulation sketch image") as HTMLSelectElement;
  const modelId = [...imageSelect.options].find(option => option.textContent?.startsWith("Classroom image"))!.value;
  fireEvent.change(imageSelect, { target: { value: modelId } });
  fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
  await screen.findByText(/Saved\. New previews/);
  const [, options] = vi.mocked(teacherApiFetch).mock.calls.find(([path, options]) => path === "/teacher/ai-settings" && options?.method === "PUT")!;
  const saved = JSON.parse(options!.body as string);
  expect(saved.providerModels.find((model: { id: string }) => model.id === modelId)).toMatchObject({ capability: "image", reasoningEffort: "none", enabled: false });
  expect(saved.roleModels.simulationSketchImage).toMatchObject({ id: "synthetic-approved-image-model", catalogModelId: modelId, reasoningEffort: "none" });
  expect(saved.defaultSimulationModelId).toBe(fixture().defaultSimulationModelId);
});

it("preserves assignments when a custom model's capability would become incompatible", async () => {
  const settings = fixture();
  settings.providerModels![0].modelId = "synthetic-multipurpose-model";
  for (const role of AI_MODEL_ROLES) if (modelCapabilityForRole(role) === "text") settings.roleModels[role].id = "synthetic-multipurpose-model";
  vi.mocked(teacherApiFetch).mockResolvedValue(settings);
  render(<TeacherAiSettingsPage />);
  await screen.findByText("Providers and model lists");
  const card = screen.getAllByRole("article").find(card => within(card).queryByDisplayValue("synthetic-multipurpose-model"))!;
  fireEvent.change(within(card).getByLabelText("Model capability"), { target: { value: "image" } });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Choose a replacement"));
  expect((within(card).getByLabelText("Model capability") as HTMLSelectElement).value).toBe("text");
  expect((screen.getByLabelText("Default student simulation model") as HTMLSelectElement).value).toBe(settings.defaultSimulationModelId);
});

it("updates an unused model's capability when its provider ID changes to an image model", async () => {
  vi.mocked(teacherApiFetch).mockResolvedValue(fixture());
  render(<TeacherAiSettingsPage />);
  await screen.findByText("Providers and model lists");
  fireEvent.click(screen.getByRole("button", { name: "Add model" }));
  const card = screen.getAllByRole("article").find(card => within(card).queryByDisplayValue("New model"))!;
  fireEvent.change(within(card).getByLabelText("Provider model ID"), { target: { value: "gpt-image-2.5-sunburst" } });
  const select = within(card).getByLabelText("Model capability") as HTMLSelectElement;
  expect(select.value).toBe("image");
  expect([...select.options].filter(option => !option.disabled).map(option => option.value)).toEqual(["image"]);
});


it("keeps HTML Fast mode off until explicit opt-in and restores saved choices", async () => {
  let settings = fixture();
  const grading = structuredClone(settings.roleModels.grading);
  vi.mocked(teacherApiFetch).mockImplementation(async (_path, options) => {
    if (options?.method === "PUT") settings = { ...settings, ...JSON.parse(options.body as string) };
    return settings as never;
  });
  render(<TeacherAiSettingsPage />);
  const checkbox = await screen.findByRole("checkbox", { name: "Interactive simulation HTML fast mode" }) as HTMLInputElement;
  expect(checkbox.checked).toBe(false);
  fireEvent.click(checkbox);
  expect(checkbox.checked).toBe(true);
  fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
  await screen.findByText(/Saved\. New previews/);
  expect(settings.codeModels[0].fastMode).toBe(true);
  expect(settings.providerModels![0].fastMode).toBe(true);
  expect(settings.roleModels.grading).toEqual(grading);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved settings" }));
  expect((await screen.findByRole("checkbox", { name: "Interactive simulation HTML fast mode" }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Interactive simulation HTML fast mode" }));
  fireEvent.click(screen.getAllByRole("button", { name: "Save settings" })[0]);
  await screen.findByText(/Saved\. New previews/);
  expect(settings.codeModels[0].fastMode).toBe(false);
});
