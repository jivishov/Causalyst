import type { AssessmentType } from "./types";

export const AI_PROMPT_STAGES = ["transcription", "voiceGrade", "realtimeVoice", "writingGrade", "simulationReadiness", "simulationSketch", "simulationSpec", "simulationHtml", "simulationRefine", "simulationFidelity", "assessmentBuilder"] as const;
export type AiPromptStage = typeof AI_PROMPT_STAGES[number];
export interface AiPromptPair { system: string; user: string }
export type AiPromptOverrides = Partial<Record<AiPromptStage, Partial<AiPromptPair>>>;
export type AiPromptBundle = Partial<Record<AiPromptStage, AiPromptPair>>;
export type AiPromptScope = "defaults" | "assessment" | "assignment";
export const AI_PROMPT_MAX_LENGTH = 24000;
export interface AiPromptStageDefinition {
  id: AiPromptStage; label: string; description: string; variables: string[]; requiredVariables: string[];
}
export interface TeacherAiPrompts {
  type: AssessmentType;
  scope: AiPromptScope;
  scopeId: string | null;
  updatedAt: string | null;
  stages: AiPromptStageDefinition[];
  prompts: AiPromptBundle;
  inherited: AiPromptBundle;
  builtIn: AiPromptBundle;
  overrides: AiPromptOverrides;
  sources: Partial<Record<AiPromptStage, { system: AiPromptScope | "built-in"; user: AiPromptScope | "built-in" }>>;
}
export interface AiPromptSaveFields {
  aiPrompts?: AiPromptOverrides;
  expectedPromptUpdatedAt?: string | null;
}

export const AI_PROMPT_STAGE_INFO: Record<AiPromptStage, Omit<AiPromptStageDefinition, "id">> = {
  transcription: { label: "Audio transcription", description: "Speech recognition combines customized instructions into one prompt. Context contains the assignment question, without its answer key. Audio is always attached; unchanged defaults preserve automatic speech recognition.", variables: ["assessmentPrompt"], requiredVariables: [] },
  voiceGrade: { label: "Voice feedback and grading", description: "Evaluate the recorded answer or completed live conversation against the saved rubric.", variables: ["assessmentPrompt", "expectedAnswer", "rubric", "scoringPolicy", "transcript"], requiredVariables: ["assessmentPrompt", "expectedAnswer", "rubric", "scoringPolicy", "transcript"] },
  realtimeVoice: { label: "Live voice conversation", description: "Guide the live assessor. System and user templates become session instructions. Answer keys are kept out of the conversation.", variables: ["assessmentPrompt", "rubric"], requiredVariables: ["assessmentPrompt", "rubric"] },
  writingGrade: { label: "Writing transcription and grading", description: "Read the uploaded work and return provisional rubric feedback. The original file is always attached.", variables: ["assessmentPrompt", "expectedAnswer", "rubric", "scoringPolicy"], requiredVariables: ["assessmentPrompt", "expectedAnswer", "rubric", "scoringPolicy"] },
  simulationReadiness: { label: "Description readiness", description: "Check whether the student's own explanation is ready to visualize.", variables: ["assessmentPrompt", "studentDescription", "deterministicSignals"], requiredVariables: ["assessmentPrompt", "studentDescription", "deterministicSignals"] },
  simulationSketch: { label: "Sketch generation", description: "Generate a diagram from the student's explanation. Image models combine both templates into one prompt.", variables: ["studentDescription"], requiredVariables: ["studentDescription"] },
  simulationSpec: { label: "Simulation specification", description: "Build the structured representation, including evidence spans from the student's text.", variables: ["assessmentPrompt", "studentDescription", "retryFeedback"], requiredVariables: ["assessmentPrompt", "studentDescription", "retryFeedback"] },
  simulationHtml: { label: "Interactive simulation", description: "Create the HTML simulation. Available sketches are always attached; the student's text supplies the domain facts.", variables: ["studentDescription", "sketchPolicy"], requiredVariables: ["studentDescription"] },
  simulationRefine: { label: "Simulation refinement", description: "Revise the current simulation using its source explanation and attached sketch.", variables: ["studentDescription", "currentHtml"], requiredVariables: ["studentDescription", "currentHtml"] },
  simulationFidelity: { label: "Simulation feedback and grading", description: "Review how faithfully the model represents the student's explanation and return rubric feedback.", variables: ["assessmentPrompt", "studentDescription", "simulationSpec", "rubric", "scoringPolicy"], requiredVariables: ["assessmentPrompt", "studentDescription", "simulationSpec", "rubric"] },
  assessmentBuilder: { label: "Assessment and rubric assistant", description: "Generate or review teacher drafts. Your objectives and current draft are supplied in context.", variables: ["context"], requiredVariables: ["context"] }
};

export function promptStagesForType(type: AssessmentType): AiPromptStageDefinition[] {
  const stages: AiPromptStage[] = type === "simulation"
    ? ["simulationReadiness", "simulationSketch", "simulationHtml", "simulationRefine", "assessmentBuilder"]
    : type === "writing" ? ["writingGrade", "assessmentBuilder"]
    : type === "voice_realtime" ? ["transcription", "realtimeVoice", "voiceGrade", "assessmentBuilder"]
    : ["transcription", "voiceGrade", "assessmentBuilder"];
  return stages.map(id => ({ id, ...AI_PROMPT_STAGE_INFO[id] }));
}
