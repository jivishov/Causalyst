import { describe, expect, it } from "vitest";
import { scoreToPercent, totalRubricPoints } from "../src/rubric";

describe("rubric helpers", () => {
  it("sums max points", () => {
    expect(totalRubricPoints([
      { name: "Accuracy", maxPoints: 4, description: "" },
      { name: "Detail", maxPoints: 6, description: "" }
    ])).toBe(10);
  });

  it("normalizes earned points to percent", () => {
    expect(scoreToPercent([
      { name: "Accuracy", score: 3, maxPoints: 4, comment: "" },
      { name: "Detail", score: 4, maxPoints: 6, comment: "" }
    ])).toBe(70);
  });
});
