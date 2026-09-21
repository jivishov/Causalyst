import { describe, expect, it } from "vitest";
import {
  LEGACY_SIMULATION_HTML_VIEWPORT,
  LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT,
  LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
  SIMULATION_HTML_VIEWPORT,
  SIMULATION_HTML_VIEWPORT_HEIGHT,
  SIMULATION_HTML_VIEWPORT_WIDTH,
  assessSimulationDescriptionReadiness,
  validateSimulationSources
} from "../src/simulation";
import type { SimulationSpec } from "../src/types";

const description = "The virus is red. White cells move to the virus.";

function specWithQuote(quote: string, start: number, end: number): SimulationSpec {
  return {
    title: "Virus response",
    descriptionSummary: "Literal response",
    entities: [
      { id: "virus", kind: "entity", name: "virus", shape: "circle", color: "red", source: { quote, start, end } }
    ],
    labels: [],
    positions: [{ id: "p1", kind: "position", entityId: "virus", x: 40, y: 50, source: { quote, start, end } }],
    movements: [],
    interactions: [],
    stateChanges: [],
    timelineSteps: [{ id: "s1", kind: "timelineStep", order: 1, text: "The virus is red.", source: { quote, start, end } }]
  };
}

describe("validateSimulationSources", () => {
  it("accepts exact source spans", () => {
    const result = validateSimulationSources(description, specWithQuote("virus", 4, 9));
    expect(result.valid).toBe(true);
  });

  it("rejects invented source quotes", () => {
    const result = validateSimulationSources(description, specWithQuote("bacteria", 4, 9));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("source quote does not match");
  });
});

describe("simulation HTML viewport", () => {
  it("uses the compact fixed viewport shared by worker prompts and frontend previews", () => {
    expect(SIMULATION_HTML_VIEWPORT_WIDTH).toBe(1024);
    expect(SIMULATION_HTML_VIEWPORT_HEIGHT).toBe(640);
    expect(SIMULATION_HTML_VIEWPORT).toEqual({ width: 1024, height: 640 });
  });

  it("keeps the legacy viewport for saved HTML artifacts without metadata", () => {
    expect(LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH).toBe(1200);
    expect(LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT).toBe(800);
    expect(LEGACY_SIMULATION_HTML_VIEWPORT).toEqual({ width: 1200, height: 800 });
  });
});

describe("assessSimulationDescriptionReadiness", () => {
  const gasLawPrompt = "Describe a real life case for a gas law and show how the gas law applies.";

  it("blocks short responses", () => {
    const result = assessSimulationDescriptionReadiness({
      assessmentPrompt: gasLawPrompt,
      description: "oxygen tank",
      config: { minDescriptionChars: 40 }
    });

    expect(result.decision).toBe("block");
    expect(result.reasonCode).toBe("too_short");
  });

  it("blocks repeated prompt-like descriptions without student-provided mechanism", () => {
    const result = assessSimulationDescriptionReadiness({
      assessmentPrompt: gasLawPrompt,
      description: "Real life case is a scuba diver's oxygen tank and it is related to Gay-Lussac's Law. Simulate the oxygen tank and show how it is related to Gay-Lussac's Law. Simulate the oxygen tank and show how it is related to Gay-Lussac's Law.",
      config: { minDescriptionChars: 40 }
    });

    expect(result.decision).toBe("block");
    expect(result.reasonCode).toBe("insufficient_detail");
  });

  it("allows concrete descriptions with a drawable subject and explicit relationship", () => {
    const result = assessSimulationDescriptionReadiness({
      assessmentPrompt: "Explain how pressure changes in a scuba tank when temperature changes.",
      description: "A scuba tank gets hotter in the sun, and the pressure inside the tank gets higher.",
      config: { minDescriptionChars: 40 }
    });

    expect(result.decision).toBe("allow");
    expect(result.reasonCode).toBe("allow");
  });

  it("routes likely unrelated but drawable descriptions to the classifier", () => {
    const result = assessSimulationDescriptionReadiness({
      assessmentPrompt: gasLawPrompt,
      description: "A plant grows taller when fertilizer is added to the soil for four weeks.",
      config: { minDescriptionChars: 40 }
    });

    expect(result.decision).toBe("needs_classifier");
    expect(result.reasonCode).toBe("unrelated");
  });
});
