import { describe, expect, it } from "vitest";
import { studentAssessment, toAssessmentSummary, toGradingAssessment, type AssessmentRecord } from "../src/lib/db";
import { buildRealtimeInstructions } from "../src/routes/voiceRealtime";

const assessment: AssessmentRecord = {
  id: "a", type: "writing", title: "Private key test", prompt: "Explain diffusion.",
  expected_answer: "PRIVATE_GRADING_MARKER", rubric: [], config: {}
};

describe("assessment privacy", () => {
  it("whitelists student fields while retaining the private grading contract", () => {
    const grading = toGradingAssessment(assessment);
    expect(grading.expectedAnswer).toBe("PRIVATE_GRADING_MARKER");
    expect(toAssessmentSummary(assessment)).not.toHaveProperty("expectedAnswer");
    expect(studentAssessment(grading)).not.toHaveProperty("expectedAnswer");
    expect(JSON.stringify(studentAssessment(grading))).not.toContain("PRIVATE_GRADING_MARKER");
  });
  it("does not place the private answer in a student-connected realtime session", () => {
    expect(buildRealtimeInstructions({ prompt: assessment.prompt, expectedAnswer: assessment.expected_answer, rubric: [] }))
      .not.toContain("PRIVATE_GRADING_MARKER");
  });
});
