import { describe, expect, it } from "vitest";
import { FINDING_TO_QUESTION_TEMPLATE, totalRubricPoints } from "../src";

describe("assessment templates", () => {
  it("provides a complete Finding-to-Question writing template", () => {
    expect(FINDING_TO_QUESTION_TEMPLATE.type).toBe("writing");
    expect(FINDING_TO_QUESTION_TEMPLATE.prompt).toContain("Complete each scaffolded section");
    expect(FINDING_TO_QUESTION_TEMPLATE.expectedAnswer).toContain("Score caps");
    expect(totalRubricPoints(FINDING_TO_QUESTION_TEMPLATE.rubric)).toBe(20);
  });
});
