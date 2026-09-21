import { simulationSpecSchema } from "@alt-assessment/shared";

const criterionScoreSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "score", "maxPoints", "comment"],
  properties: {
    name: { type: "string" },
    score: { type: "number" },
    maxPoints: { type: "number" },
    comment: { type: "string" }
  }
};

export const gradeFeedbackSchema = {
  type: "object",
  additionalProperties: false,
  required: ["score", "overallComment", "criteria", "confidence", "reviewFlags"],
  properties: {
    score: { type: "number" },
    overallComment: { type: "string" },
    criteria: { type: "array", items: criterionScoreSchema },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reviewFlags: { type: "array", items: { type: "string" } }
  }
};

export const writingGradeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["transcribedText", "feedback"],
  properties: {
    transcribedText: { type: "string" },
    feedback: gradeFeedbackSchema
  }
};

export const simulationGenerationSchema = simulationSpecSchema();

export const simulationReadinessClassifierSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "reasonCode", "relatedToPrompt", "hasDrawableStudentEvidence", "isMostlyPromptEcho"],
  properties: {
    decision: { type: "string", enum: ["allow", "block"] },
    reasonCode: { type: "string", enum: ["unrelated", "prompt_echo", "insufficient_detail", "allow"] },
    relatedToPrompt: { type: "boolean" },
    hasDrawableStudentEvidence: { type: "boolean" },
    isMostlyPromptEcho: { type: "boolean" }
  }
};

export const fidelityReviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["feedback", "missingElements", "addedElements"],
  properties: {
    feedback: gradeFeedbackSchema,
    missingElements: { type: "array", items: { type: "string" } },
    addedElements: { type: "array", items: { type: "string" } }
  }
};
