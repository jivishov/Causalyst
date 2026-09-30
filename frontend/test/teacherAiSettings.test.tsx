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
  await screen.findByText(/Saved\. New attempts/);
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
