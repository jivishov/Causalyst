import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { MousePointer2, Orbit } from "lucide-react";
import { advanceGasParticle, createGasParticles, GAS_CYLINDER, gasPreviewState, MIN_GAS_VOLUME, REFERENCE_GAS_VOLUME } from "../lib/gasPreviewModel";

export function GasExample() {
  const [volume, setVolume] = useState(REFERENCE_GAS_VOLUME);
  const state = gasPreviewState(volume);
  const clipId = useId();
  const gridId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const bounds = useRef(state.gasWidth);
  const particles = useRef(createGasParticles(state.gasWidth));
  const nodes = useRef<Array<SVGCircleElement | null>>([]);

  function drawParticles() {
    particles.current.forEach((particle, index) => {
      nodes.current[index]?.setAttribute("cx", String(particle.x));
      nodes.current[index]?.setAttribute("cy", String(particle.y));
    });
  }

  useLayoutEffect(() => {
    bounds.current = state.gasWidth;
    // Re-equilibrate positions inside the new chamber without changing speeds.
    particles.current = particles.current.map(particle => advanceGasParticle(particle, state.gasWidth, 0));
    drawParticles();
  }, [state.gasWidth]);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let inView = true;
    let frame = 0;
    let previous = 0;
    const shouldAnimate = () => inView && !document.hidden && !reducedMotion.matches;
    function tick(timestamp: number) {
      const seconds = previous ? Math.min((timestamp - previous) / 1000, .05) : 0;
      previous = timestamp;
      particles.current = particles.current.map(particle => advanceGasParticle(particle, bounds.current, seconds));
      drawParticles();
      if (shouldAnimate()) frame = requestAnimationFrame(tick);
    }
    function syncAnimation() {
      cancelAnimationFrame(frame);
      previous = 0;
      if (shouldAnimate()) frame = requestAnimationFrame(tick);
    }
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; syncAnimation(); });
    if (svgRef.current) observer.observe(svgRef.current);
    reducedMotion.addEventListener("change", syncAnimation);
    document.addEventListener("visibilitychange", syncAnimation);
    syncAnimation();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      reducedMotion.removeEventListener("change", syncAnimation);
      document.removeEventListener("visibilitychange", syncAnimation);
    };
  }, []);

  return <aside className="frontpage-example" aria-label="Interactive simulation example">
    <div className="frontpage-example-caption"><span><Orbit size={16} />An idea, made visible</span><span>Try a simulation</span></div>
    <div className="frontpage-example-card">
      <div className="frontpage-example-header"><span><span className="frontpage-example-dot" />Simulation preview</span><span>Interactive example</span></div>
      <div className="frontpage-example-prompt"><span>Your explanation</span><p>"With the same amount of gas at a constant temperature, a smaller volume means higher pressure."</p></div>
      <div className="frontpage-gas-model">
        <div className="frontpage-gas-title"><h2>Give an idea a little room.</h2><span>Boyle’s law: fixed amount of gas, constant temperature.</span></div>
        <svg ref={svgRef} viewBox="0 0 430 190" role="img" aria-label={`Fixed cylinder with a movable piston. Gas volume is ${volume} percent of the reference volume. Pressure is ${state.pressureRatio.toFixed(2)} times the pressure at 100 percent volume.`}>
          <defs>
            <pattern id={gridId} width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#dedbe8" strokeWidth=".6" /></pattern>
            <clipPath id={clipId}><rect x={GAS_CYLINDER.left} y={GAS_CYLINDER.top} width={state.gasWidth} height={GAS_CYLINDER.height} /></clipPath>
          </defs>
          <rect x="12" y="4" width="406" height="182" rx="12" fill={`url(#${gridId})`} />
          <text x="34" y="17" className="frontpage-gas-svg-label">Fixed cylinder</text>
          <rect x="34" y="28" width="218" height="124" fill="#f8f6fb" />
          <rect data-testid="gas-chamber" x={GAS_CYLINDER.left} y={GAS_CYLINDER.top} width={state.gasWidth} height={GAS_CYLINDER.height} fill="#eeebfa" />
          <g clipPath={`url(#${clipId})`} aria-hidden="true">
            {particles.current.map((particle, index) => <circle className="frontpage-gas-particle" key={index} ref={node => { nodes.current[index] = node; }} cx={particle.x} cy={particle.y} r={particle.radius} fill="#6350c8" />)}
          </g>
          <path data-testid="gas-cylinder" d="M252 26H32V154H252" fill="none" stroke="#a99bc0" strokeWidth="3" strokeLinejoin="round" />
          <g data-testid="gas-piston" transform={`translate(${state.pistonX},0)`}>
            <path data-testid="gas-piston-rod" d="M8 90H162" stroke="#aaa2c0" strokeWidth="6" />
            <path data-testid="gas-piston-handle" d="M162 74V106" stroke="#aaa2c0" strokeWidth="5" strokeLinecap="round" />
            <rect y="26" width="8" height="128" rx="2" fill="#6350c8" />
          </g>
          <path d={`M34 165V173M34 169H${state.pistonX}M${state.pistonX} 165V173`} stroke="#a99bc0" fill="none" />
          <text x={34 + state.gasWidth / 2} y="183" textAnchor="middle" className="frontpage-gas-svg-label">{volume}% of V₀</text>
        </svg>
        <div className="frontpage-gas-control"><label htmlFor="example-volume">Gas volume · V/V₀ <output htmlFor="example-volume">{volume}%</output></label><input id="example-volume" aria-label="Volume" aria-valuetext={`${volume} percent of the reference volume`} type="range" min={MIN_GAS_VOLUME} max={REFERENCE_GAS_VOLUME} step="1" value={volume} onChange={event => setVolume(Number(event.target.value))} /><div><span>Compress</span><span>Expand</span></div></div>
        <div className="frontpage-gas-readout"><span>Pressure · P/P₀ <strong data-testid="example-pressure">{state.pressureRatio.toFixed(2)}×</strong></span><span>P₀ = pressure at 100% volume</span></div>
        <p className="frontpage-gas-assumption"><strong>PV = P₀V₀.</strong> Heat exchange keeps temperature constant. Particle motion is slowed for clarity.</p>
      </div>
      <div className="frontpage-example-footer"><MousePointer2 size={15} /><span>Move the slider. What do you notice?</span><span>Sample only</span></div>
    </div>
    <p className="frontpage-example-note">In a simulation assessment, you answer by explaining the process. AI helps turn your explanation into a model that you can test and refine.</p>
  </aside>;
}
