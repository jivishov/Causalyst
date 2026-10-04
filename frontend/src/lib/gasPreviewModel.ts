// Equilibrium Boyle's-law states in a cylinder with a fixed cross-section.
// Particle motion is a slowed schematic, not a numerical pressure measurement.
export const GAS_CYLINDER = { left: 34, top: 28, width: 210, height: 124 } as const;
export const MIN_GAS_VOLUME = 35;
export const REFERENCE_GAS_VOLUME = 100;

export function gasPreviewState(percent: number) {
  const volumePercent = Number.isFinite(percent)
    ? Math.min(REFERENCE_GAS_VOLUME, Math.max(MIN_GAS_VOLUME, percent))
    : REFERENCE_GAS_VOLUME;
  const volumeRatio = volumePercent / REFERENCE_GAS_VOLUME;
  const gasWidth = GAS_CYLINDER.width * volumeRatio;
  return { volumePercent, volumeRatio, gasWidth, pistonX: GAS_CYLINDER.left + gasWidth, pressureRatio: 1 / volumeRatio };
}

export type GasParticle = { x: number; y: number; vx: number; vy: number; radius: number };

export function createGasParticles(gasWidth: number): GasParticle[] {
  const positions = [[.12,.2],[.36,.15],[.62,.28],[.84,.16],[.2,.56],[.46,.46],[.76,.55],[.13,.81],[.39,.77],[.64,.84],[.86,.78],[.58,.62]];
  const radius = 3.5;
  return positions.map(([x, y], index) => {
    const angle = .6 + index * 2.4;
    const speed = 36 + (index % 4) * 4;
    return {
      x: GAS_CYLINDER.left + radius + x * (gasWidth - 2 * radius),
      y: GAS_CYLINDER.top + radius + y * (GAS_CYLINDER.height - 2 * radius),
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, radius
    };
  });
}

function reflect(position: number, velocity: number, minimum: number, maximum: number, seconds: number) {
  const span = maximum - minimum;
  const period = 2 * span;
  const phase = ((position - minimum + velocity * seconds) % period + period) % period;
  const coordinate = minimum + (phase <= span ? phase : period - phase);
  const direction = phase === 0 ? Math.abs(velocity) : phase === span ? -Math.abs(velocity) : phase < span ? velocity : -velocity;
  return { coordinate, velocity: direction };
}

export function advanceGasParticle(particle: GasParticle, gasWidth: number, seconds: number): GasParticle {
  const x = reflect(particle.x, particle.vx, GAS_CYLINDER.left + particle.radius, GAS_CYLINDER.left + gasWidth - particle.radius, seconds);
  const y = reflect(particle.y, particle.vy, GAS_CYLINDER.top + particle.radius, GAS_CYLINDER.top + GAS_CYLINDER.height - particle.radius, seconds);
  return { ...particle, x: x.coordinate, y: y.coordinate, vx: x.velocity, vy: y.velocity };
}
