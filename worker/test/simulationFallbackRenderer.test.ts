import { describe, expect, it } from "vitest";
import { buildSimulationFallbackHtml } from "../src/lib/simulationFallbackRenderer";

describe("simulation fallback renderer", () => {
  it("uses the generic fallback when gas apparatus details would need to be inferred", () => {
    const description = "Gay-Lussac's Law: a scuba oxygen tank gets hotter in the sun, temperature increases, pressure increases, and the tank volume stays constant. When cooler, temperature decreases and pressure decreases.";

    const result = buildSimulationFallbackHtml({ description, reasonCodes: ["clipped_elements"] });

    expect(result.renderer).toBe("generic");
    expect(result.html).toContain("Structured fallback");
    expect(result.html).toContain("Gay-Lussac");
    expect(result.html).not.toContain("Pressure gauge");
    expect(result.html).not.toContain("Gas particles");
    expect(result.html).not.toContain("Pressure changes with temperature while volume stays almost constant.");
    expect(result.html).not.toContain("Gas particles move faster.");
    expect(result.html).not.toContain("Gauge needle moves higher.");
  });

  it("renders the closed-gas-container fallback only when apparatus details are explicit", () => {
    const description = "Gay-Lussac's Law: a scuba oxygen tank has a pressure gauge in psi, gas particles move faster when temperature increases and pressure increases, and the tank volume stays constant. When cooler, gas particles move slower, temperature decreases, and pressure decreases.";

    const result = buildSimulationFallbackHtml({ description, reasonCodes: ["clipped_elements"] });

    expect(result.renderer).toBe("closedGasContainer");
    expect(result.html).toContain("<!doctype html>");
    expect(result.html).toContain("width=1024, height=640");
    expect(result.html).toContain("grid-template-rows:40px 58px 382px 160px");
    expect(result.html).toContain("Gay-Lussac");
    expect(result.html).toContain("Pressure gauge");
    expect(result.html).toContain("Gas particles");
    expect(result.html).toContain("Container volume stays constant.");
    expect(result.html).toContain("Pressure changes with temperature while volume stays almost constant.");
    expect(result.html).toContain("Temperature increases, pressure increases.");
    expect(result.html).toContain("Temperature decreases, pressure decreases.");
    expect(result.html).toContain("Hotter");
    expect(result.html).toContain("Cooler");
    expect(result.html).toContain("Step Forward");
    expect(result.html).not.toContain("gets hotter in the sun, temperature increases, pressure increases");
    expect(result.html).not.toContain("```");
    expect(result.html.length).toBeGreaterThan(8000);
  });

  it("uses a generic app-owned renderer when no known template matches", () => {
    const result = buildSimulationFallbackHtml({
      title: "Plant growth",
      description: "A plant grows taller when fertilizer is added to the soil.",
      reasonCodes: ["vertical_overflow"]
    });

    expect(result.renderer).toBe("generic");
    expect(result.html).toContain("Structured fallback");
    expect(result.html).toContain("width=1024, height=640");
    expect(result.html).toContain("grid-template-rows:40px 70px 370px 160px");
    expect(result.html).toContain("vertical_overflow");
    expect(result.html).toContain("Plant growth");
    expect(result.html).toContain("Play");
    expect(result.html).not.toContain("```");
  });
});
