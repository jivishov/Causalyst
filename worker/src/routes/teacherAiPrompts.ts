import type { AiPromptScope, AssessmentType } from "@alt-assessment/shared";
import type { AppDatabaseClient } from "../lib/database";
import { toJson } from "../lib/database";
import { loadTeacherPromptContext, parsePromptOverrides, promptSaveError, resolvePromptContext } from "../lib/aiPrompts";
import { HttpError, readJson } from "../lib/http";
import { requireTeacherProfile } from "./teacher";

export async function getTeacherAiPrompts(request: Request, db: AppDatabaseClient, userId: string) {
  await requireTeacherProfile(db, userId);
  const query = new URL(request.url).searchParams;
  const type = query.get("type") as AssessmentType | null;
  const assessmentId = query.get("assessmentId");
  const assignmentId = query.get("assignmentId");
  if (type && !["voice", "voice_realtime", "writing", "simulation"].includes(type)) throw new HttpError(400, "Select an assessment type.");
  if (!type && !assessmentId && !assignmentId) throw new HttpError(400, "Select an assessment type.");
  const context = await loadTeacherPromptContext(db, userId, type ?? undefined, assessmentId, assignmentId);
  const scope: AiPromptScope = assignmentId ? "assignment" : assessmentId ? "assessment" : "defaults";
  return resolvePromptContext(context, scope, assignmentId ?? assessmentId ?? null);
}

export async function setTeacherPromptDefaults(request: Request, db: AppDatabaseClient, userId: string) {
  await requireTeacherProfile(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  if (!["voice", "voice_realtime", "writing", "simulation"].includes(String(body.type))) throw new HttpError(400, "Select an assessment type.");
  if (body.updatedAt !== null && (typeof body.updatedAt !== "string" || !Number.isFinite(Date.parse(body.updatedAt)))) throw new HttpError(400, "Read prompt defaults before saving.");
  const type = body.type as AssessmentType;
  const prompts = parsePromptOverrides(body.prompts, type);
  const { data, error } = await db.rpc("set_teacher_ai_prompts", { p_teacher_id: userId, p_scope: "defaults", p_scope_id: userId,
    p_type: type, p_prompts: toJson(prompts), p_expected_updated_at: body.updatedAt as string | null });
  if (error) throw promptSaveError(error);
  return resolvePromptContext(data as unknown as import("../lib/aiPrompts").StoredPromptContext, "defaults");
}
