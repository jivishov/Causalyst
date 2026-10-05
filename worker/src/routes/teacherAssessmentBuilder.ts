import type { AppDatabaseClient } from "../lib/database";
import type { Env } from "../lib/env";
import { readJson } from "../lib/http";
import { defaultAiSettings, loadTeacherAiSettings, PROVIDER_ENV, withAssessmentBuilderModel } from "../lib/aiSettings";
import { decryptProviderSecret } from "../lib/providerSecrets";
import { assessmentBuilderModel, parseAssessmentBuilderRequest, runAssessmentBuilder } from "../lib/assessmentBuilder";
import { openaiClient } from "../lib/openai";
import { requireTeacherProfile } from "./teacher";

export async function generateTeacherAssessmentDraft(request: Request, db: AppDatabaseClient, env: Env, userId: string) {
  await requireTeacherProfile(db, userId);
  const input = parseAssessmentBuilderRequest(await readJson<unknown>(request));
  const saved = await loadTeacherAiSettings(db, userId);
  const settings = withAssessmentBuilderModel(saved.settings ?? defaultAiSettings(env));
  const { provider, baseURL } = assessmentBuilderModel(settings);
  const sealed = settings.apiKeys[provider];
  const key = sealed ? await decryptProviderSecret(sealed, `${userId}:${provider}`, env) : env[PROVIDER_ENV[provider]];
  return runAssessmentBuilder(openaiClient(key ?? "", baseURL), settings, input);
}
