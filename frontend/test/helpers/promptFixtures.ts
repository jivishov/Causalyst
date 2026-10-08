import { promptStagesForType, type AssessmentType, type TeacherAiPrompts } from "@alt-assessment/shared";
export function promptFixture(type: AssessmentType = "simulation"): TeacherAiPrompts {
  const stages = promptStagesForType(type);
  const prompts = Object.fromEntries(stages.map(stage => [stage.id, { system: `Default ${stage.label} instructions`, user: "{{context}}" }]));
  return { type, scope: "defaults", scopeId: null, stages, prompts, inherited: prompts, builtIn: prompts, overrides: {}, sources: {}, updatedAt: null };
}
