import { describe, expect, it } from "vitest";
// @ts-expect-error This standalone Node evaluation command is a JavaScript module.
import { evaluateGrades } from "../../scripts/evaluate-grades.mjs";
import { parseScoringPolicy } from "../src/lib/gradingPolicy";

const fixture = () => ({
  dataset: "synthetic-validator-test", model: "fixture-only", policyVersion: "rubric-v2",
  thresholds: { minimumCases: 2, maximumMeanAbsoluteError: 5 },
  cases: [
    { id: "one", modality: "writing", teacherReviewed: true, teacherScore: 80, modelScore: 82, unsupportedEvidence: false, policyViolation: false },
    { id: "two", modality: "voice", teacherReviewed: true, teacherScore: 60, modelScore: 66, unsupportedEvidence: false, policyViolation: false }
  ]
});

describe("teacher evaluation input integrity", () => {
  it("calculates error from independently identified cases", () => {
    expect(evaluateGrades(fixture())).toMatchObject({ count: 2, meanAbsoluteError: 4, maximumAbsoluteError: 6, passed: true });
  });
  it.each(["false", "true", 1, false, null])("rejects a non-true teacher review declaration (%s)", value => {
    const data = fixture();
    expect(() => evaluateGrades({ ...data, cases: [{ ...data.cases[0], teacherReviewed: value }] })).toThrow(/teacherReviewed/);
  });
  it("does not count duplicate case IDs toward the minimum sample", () => {
    const data = fixture();
    data.cases[1].id = " one ";
    expect(() => evaluateGrades(data)).toThrow(/unique/);
  });
  it.each(["dataset", "model", "policyVersion"])("requires the %s identity", field => {
    expect(() => evaluateGrades({ ...fixture(), [field]: "" })).toThrow(/Identify/);
  });
  it.each([0, 1.5, null])("rejects an invalid minimum case count (%s)", minimumCases => {
    const data = fixture();
    expect(() => evaluateGrades({ ...data, thresholds: { ...data.thresholds, minimumCases } })).toThrow(/thresholds/);
  });
  it("fails explicit evidence or policy violations regardless of score agreement", () => {
    const data = fixture();
    data.cases[0].unsupportedEvidence = true;
    expect(evaluateGrades(data).passed).toBe(false);
    data.cases[0].unsupportedEvidence = false;
    data.cases[0].policyViolation = true;
    expect(evaluateGrades(data).passed).toBe(false);
  });
  it("rejects numeric cap IDs instead of coercing them to strings", () => {
    expect(() => parseScoringPolicy({ mode: "capped", caps: [{ id: 123, maximumPercent: 50, condition: "Missing evidence" }] })).toThrow(/scoring caps/);
  });
});
