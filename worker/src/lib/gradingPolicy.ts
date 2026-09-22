import type { GradeFeedback, RubricCriterion, RubricScore } from "@alt-assessment/shared";
import { scoreToPercent } from "@alt-assessment/shared";
import { HttpError } from "./http";

export const GRADING_POLICY_VERSION = "rubric-v2";
export interface ScoringPolicy {
  mode: "additive" | "capped" | "review_adjustments";
  caps: Array<{ id: string; maximumPercent: number; condition: string }>;
}
export function rubricWithIds(rubric: RubricCriterion[]): Array<RubricCriterion & { id: string }> {
  return rubric.map((criterion, index) => ({ ...criterion, id: criterion.id ?? `criterion-${index + 1}` }));
}
export function parseScoringPolicy(value: unknown): ScoringPolicy {
  if (value === undefined || value === null) return { mode: "review_adjustments", caps: [] };
  if (typeof value !== "object") throw new HttpError(400, "Invalid scoring policy");
  const input = value as ScoringPolicy;
  if (!["additive", "capped", "review_adjustments"].includes(input.mode)) throw new HttpError(400, "Invalid scoring policy mode");
  const caps = input.caps ?? [];
  if (!Array.isArray(caps) || caps.length > 20 || caps.some((cap) => !cap || !/^[a-zA-Z0-9_-]{1,80}$/.test(cap.id) ||
    !Number.isFinite(cap.maximumPercent) || cap.maximumPercent < 0 || cap.maximumPercent > 100 || typeof cap.condition !== "string" || !cap.condition.trim()) ||
    new Set(caps.map((cap) => cap.id)).size !== caps.length || (input.mode !== "capped" && caps.length > 0)) {
    throw new HttpError(400, "Invalid scoring caps");
  }
  return { mode: input.mode, caps: caps.map(({ id, maximumPercent, condition }) => ({ id, maximumPercent, condition })) };
}
export function validateGradeFeedback(raw: unknown, rubric: RubricCriterion[], policyValue?: unknown): GradeFeedback {
  const fail = (): never => { throw new HttpError(502, "Grading output does not match the frozen rubric; teacher review or a new grading attempt is required"); };
  if (!raw || typeof raw !== "object") return fail();
  const result = raw as GradeFeedback;
  if (!Number.isFinite(result.score) || result.score < 0 || result.score > 100 || !Array.isArray(result.criteria) ||
    !Array.isArray(result.reviewFlags) || result.criteria.some((criterion) => !criterion || typeof criterion !== "object") || result.reviewFlags.some((flag) => typeof flag !== "string") ||
    typeof result.overallComment !== "string" || !["low", "medium", "high"].includes(result.confidence)) return fail();
  const expected = rubricWithIds(rubric);
  if (!expected.length || new Set(expected.map((criterion) => criterion.id)).size !== expected.length || result.criteria.length !== expected.length) return fail();
  const byId = new Map(result.criteria.map((criterion) => [criterion.id, criterion]));
  if (byId.size !== expected.length) return fail();
  const criteria: RubricScore[] = expected.map((criterion) => {
    const scored = byId.get(criterion.id);
    if (!scored || scored.name !== criterion.name || scored.maxPoints !== criterion.maxPoints || !Number.isFinite(scored.score) ||
      scored.score < 0 || scored.score > criterion.maxPoints || typeof scored.comment !== "string") return fail();
    return { id: criterion.id, name: criterion.name, maxPoints: criterion.maxPoints, score: scored.score, comment: scored.comment };
  });
  const policy = parseScoringPolicy(policyValue);
  const appliedCaps = result.appliedCaps ?? [];
  if (!Array.isArray(appliedCaps) || appliedCaps.some((cap) => !cap || typeof cap !== "object") || new Set(appliedCaps.map((cap) => cap.id)).size !== appliedCaps.length) return fail();
  let score = scoreToPercent(criteria);
  for (const applied of appliedCaps) {
    const cap = policy.caps.find((entry) => entry.id === applied.id);
    if (policy.mode !== "capped" || !cap || typeof applied.reason !== "string" || !applied.reason.trim()) return fail();
    score = Math.min(score, cap.maximumPercent);
  }
  const flags = [...result.reviewFlags];
  if (policy.mode === "review_adjustments" && Math.abs(result.score - score) > 1) {
    flags.push("SCORING_REVIEW_REQUIRED: The suggested adjustment has no machine-readable policy. Enter a teacher grade with a reason.");
    score = result.score;
  }
  return { overallComment: result.overallComment, confidence: result.confidence, criteria, score, appliedCaps, reviewFlags: [...new Set(flags)], policyVersion: GRADING_POLICY_VERSION };
}
