import { describe, expect, it } from "vitest";
import { advanceGasParticle, createGasParticles, GAS_CYLINDER, gasPreviewState } from "../src/lib/gasPreviewModel";

describe("isothermal gas preview", () => {
  it("uses an explicit reference and conserves PV across every slider setting", () => {
    expect(gasPreviewState(100).pressureRatio).toBe(1);
    expect(gasPreviewState(50).pressureRatio).toBe(2);
    expect(gasPreviewState(80).pressureRatio).toBe(1.25);
    for (let volume = 35; volume <= 100; volume++) {
      const state = gasPreviewState(volume);
      expect(state.pressureRatio * state.volumeRatio).toBeCloseTo(1, 12);
      expect(state.gasWidth / GAS_CYLINDER.width).toBeCloseTo(state.volumeRatio, 12);
    }
  });

  it("confines the same particles and preserves their speed through compression, expansion, and wall collisions", () => {
    let particles = createGasParticles(gasPreviewState(100).gasWidth);
    const originalSpeeds = particles.map(p => Math.hypot(p.vx, p.vy));
    const originalSizes = particles.map(p => p.radius);
    for (const volume of [35, 100, 50, 69, 35, 80, 100]) {
      const { gasWidth } = gasPreviewState(volume);
      for (let frame = 0; frame < 120; frame++) {
        particles = particles.map(p => advanceGasParticle(p, gasWidth, frame === 0 ? 0 : .05));
        expect(particles).toHaveLength(originalSpeeds.length);
        particles.forEach((p, index) => {
          expect(p.x).toBeGreaterThanOrEqual(GAS_CYLINDER.left + p.radius - 1e-9);
          expect(p.x).toBeLessThanOrEqual(GAS_CYLINDER.left + gasWidth - p.radius + 1e-9);
          expect(p.y).toBeGreaterThanOrEqual(GAS_CYLINDER.top + p.radius - 1e-9);
          expect(p.y).toBeLessThanOrEqual(GAS_CYLINDER.top + GAS_CYLINDER.height - p.radius + 1e-9);
          expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(originalSpeeds[index], 12);
          expect(p.radius).toBe(originalSizes[index]);
        });
      }
    }
  });

  it("reflects wall impacts inward and handles multiple collisions in a long step", () => {
    const radius = 3.5;
    const width = gasPreviewState(35).gasWidth;
    const atWall = { x: GAS_CYLINDER.left + width - radius, y: GAS_CYLINDER.top + radius, vx: 40, vy: -30, radius };
    const reflected = advanceGasParticle(atWall, width, 0);
    expect(reflected.vx).toBe(-40);
    expect(reflected.vy).toBe(30);
    const later = advanceGasParticle(reflected, width, 10);
    expect(later.x).toBeGreaterThanOrEqual(GAS_CYLINDER.left + radius);
    expect(later.x).toBeLessThanOrEqual(GAS_CYLINDER.left + width - radius);
    expect(later.y).toBeGreaterThanOrEqual(GAS_CYLINDER.top + radius);
    expect(later.y).toBeLessThanOrEqual(GAS_CYLINDER.top + GAS_CYLINDER.height - radius);
    expect(Math.hypot(later.vx, later.vy)).toBe(50);
  });
});
