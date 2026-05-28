import type { GradeFeedback, RubricCriterion, RubricScore } from "./types";

export function totalRubricPoints(rubric: RubricCriterion[]): number {
  return rubric.reduce((sum, criterion) => sum + Math.max(0, criterion.maxPoints), 0);
}

export function scoreToPercent(criteria: RubricScore[]): number {
  const earned = criteria.reduce((sum, item) => sum + clampNumber(item.score, 0, item.maxPoints), 0);
  const possible = criteria.reduce((sum, item) => sum + Math.max(0, item.maxPoints), 0);
  if (possible === 0) return 0;
  return Math.round((earned / possible) * 100);
}

export function normalizeFeedback(feedback: GradeFeedback): GradeFeedback {
  return {
    ...feedback,
    score: clampNumber(Math.round(feedback.score), 0, 100),
    criteria: feedback.criteria.map((criterion) => ({
      ...criterion,
      score: clampNumber(criterion.score, 0, criterion.maxPoints),
      maxPoints: Math.max(0, criterion.maxPoints)
    })),
    reviewFlags: [...new Set(feedback.reviewFlags.filter(Boolean))]
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
