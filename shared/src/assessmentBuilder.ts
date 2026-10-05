import type { AiProvider, AiReasoningEffort } from "./aiSettings";
import type { AssessmentType, RubricCriterion } from "./types";

export type AssessmentBuilderAction = "assessment" | "rubric" | "reviewRubric";
export interface AssessmentBuilderDraft {
  title: string;
  prompt: string;
  expectedAnswer: string;
  rubric: RubricCriterion[];
}
export interface AssessmentBuilderAiRequest {
  action: AssessmentBuilderAction;
  type: AssessmentType;
  request: string;
  assessment: AssessmentBuilderDraft;
}
export interface AssessmentBuilderAiResponse {
  action: AssessmentBuilderAction;
  draft: AssessmentBuilderDraft | null;
  rubric: RubricCriterion[];
  feedback: string[];
  model: { provider: AiProvider; id: string; reasoningEffort: AiReasoningEffort; maxOutputTokens: number; fastMode: boolean };
}
