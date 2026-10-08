import type { AppDatabaseClient } from "../lib/database";
import type { Env } from "../lib/env";
import { readJson } from "../lib/http";
import { defaultAiSettings, loadTeacherAiSettings, PROVIDER_ENV, withAssessmentBuilderModel } from "../lib/aiSettings";
import { decryptProviderSecret } from "../lib/providerSecrets";
import { assessmentBuilderModel, parseAssessmentBuilderRequest, runAssessmentBuilder } from "../lib/assessmentBuilder";
import { openaiClient } from "../lib/openai";
import { requireTeacherProfile } from "./teacher";
import { loadTeacherPromptContext, parsePromptOverrides, resolvePromptContext } from "../lib/aiPrompts";
import type { AssessmentType } from "@alt-assessment/shared";

export async function generateTeacherAssessmentDraft(request: Request, db: AppDatabaseClient, env: Env, userId: string) {
  await requireTeacherProfile(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const input = parseAssessmentBuilderRequest(body);
  const saved = await loadTeacherAiSettings(db, userId);
  const settings = withAssessmentBuilderModel(saved.settings ?? defaultAiSettings(env));
  const { provider, baseURL } = assessmentBuilderModel(settings);
  const sealed = settings.apiKeys[provider];
  const key = sealed ? await decryptProviderSecret(sealed, `${userId}:${provider}`, env) : env[PROVIDER_ENV[provider]];
  let context = await loadTeacherPromptContext(db, userId, input.type, typeof body.assessmentId === "string" ? body.assessmentId : null);
  // A teacher can change the type of an unsaved draft; use that type's defaults.
  if (context.type !== input.type) context = await loadTeacherPromptContext(db, userId, input.type as AssessmentType);
  const overrides = body.aiPrompts === undefined ? context.assessment : parsePromptOverrides(body.aiPrompts, input.type);
  const prompts = resolvePromptContext({ ...context, assessment: overrides }, "assessment").prompts;
  return runAssessmentBuilder(openaiClient(key ?? "", baseURL), settings, input, prompts);
}
