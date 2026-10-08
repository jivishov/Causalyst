import type { AssessmentType, AiPromptOverrides, TeacherAiPrompts } from "../../shared/src/index";
import { resolvePromptContext } from "../../worker/src/lib/aiPrompts";
export function teacherPromptFixture(url: string, overrides: AiPromptOverrides = {}): TeacherAiPrompts {
  const query = new URL(url).searchParams;
  const type = (query.get("type") ?? "voice") as AssessmentType;
  const scope = query.has("assignmentId") ? "assignment" : query.has("assessmentId") ? "assessment" : "defaults";
  return resolvePromptContext({ type, [scope]: overrides }, scope, query.get("assignmentId") ?? query.get("assessmentId"));
}
