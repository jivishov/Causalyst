// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TeacherAiPromptEditor, TeacherPromptDefaultsPanel, useTeacherAiPrompts } from "../src/pages/teacher/TeacherAiPromptEditor";
import { teacherApiFetch } from "../src/lib/api";
import { promptFixture } from "./helpers/promptFixtures";

vi.mock("../src/lib/api", () => ({ teacherApiFetch: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("saves defaults for the selected type and resets one field without losing the other", async () => {
  let saved: any;
  vi.mocked(teacherApiFetch).mockImplementation(async (path, options) => {
    const initial = promptFixture("writing");
    if (options?.method === "PUT") {
      saved = JSON.parse(options.body as string);
      return { ...initial, overrides: saved.prompts, prompts: { ...initial.prompts, writingGrade: { ...initial.prompts.writingGrade, ...saved.prompts.writingGrade } }, updatedAt: "2026-10-08T04:00:00Z" } as never;
    }
    return promptFixture(new URL("http://test" + path).searchParams.get("type") === "writing" ? "writing" : "simulation") as never;
  });
  render(<TeacherPromptDefaultsPanel />);
  fireEvent.change(screen.getByLabelText("Assessment type"), { target: { value: "writing" } });
  await screen.findByDisplayValue("Default Writing transcription and grading instructions");
  fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Score reasoning explicitly." } });
  fireEvent.change(screen.getByLabelText("User prompt"), { target: { value: "Use Spanish feedback. {{context}}" } });
  fireEvent.click(screen.getAllByRole("button", { name: "Reset to Explain default" })[1]);
  expect((screen.getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe("Score reasoning explicitly.");
  expect((screen.getByLabelText("User prompt") as HTMLTextAreaElement).value).toBe("{{context}}");
  fireEvent.click(screen.getByRole("button", { name: "Save prompt defaults" }));
  await screen.findByText(/Prompt defaults saved/);
  expect(saved).toEqual({ type: "writing", prompts: { writingGrade: { system: "Score reasoning explicitly." } }, updatedAt: null });
});

it("starts a new assignment with inherited assessment prompts and an independent revision", async () => {
  const inherited = promptFixture("simulation");
  inherited.scope = "assessment"; inherited.updatedAt = "2026-10-08T04:00:00Z";
  inherited.prompts.simulationHtml = { system: "Assessment instructions", user: "Assessment user {{context}}" };
  inherited.overrides.simulationHtml = { system: "Assessment instructions", user: "Assessment user {{context}}" };
  vi.mocked(teacherApiFetch).mockResolvedValue(inherited);
  let fields: unknown;
  function Harness() {
    const state = useTeacherAiPrompts({ type: "simulation", scope: "assignment", assessmentId: "gas" });
    fields = state.saveFields;
    return <TeacherAiPromptEditor state={state} />;
  }
  render(<Harness />);
  await screen.findByLabelText("AI step");
  fireEvent.change(screen.getByLabelText("AI step"), { target: { value: "simulationHtml" } });
  expect((screen.getByLabelText("System prompt") as HTMLTextAreaElement).value).toBe("Assessment instructions");
  expect(fields).toEqual({ aiPrompts: {}, expectedPromptUpdatedAt: null });
  fireEvent.change(screen.getByLabelText("System prompt"), { target: { value: "Class-specific instructions" } });
  await waitFor(() => expect(fields).toEqual({ aiPrompts: { simulationHtml: { system: "Class-specific instructions" } }, expectedPromptUpdatedAt: null }));
  expect(inherited.prompts.simulationHtml.system).toBe("Assessment instructions");
});

it("never treats a failed prompt load as a ready-to-save draft", async () => {
  vi.mocked(teacherApiFetch).mockRejectedValue(new Error("Prompt settings unavailable"));
  let fields: unknown;
  function Harness() { const state = useTeacherAiPrompts({ type: "voice", scope: "assessment" }); fields = state.saveFields; return <TeacherAiPromptEditor state={state} scope="assessment" />; }
  render(<Harness />);
  await screen.findByRole("alert");
  expect(fields).toBeNull();
  expect(screen.getByText("Prompt settings unavailable")).toBeTruthy();
  vi.mocked(teacherApiFetch).mockResolvedValue(promptFixture("voice"));
  fireEvent.click(screen.getByRole("button", { name: "Reload prompts" }));
  await screen.findByLabelText("System prompt");
  expect(fields).toEqual({ aiPrompts: {}, expectedPromptUpdatedAt: null });
});
