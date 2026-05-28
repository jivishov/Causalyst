import { useMemo, useState } from "react";
import type { SimulationSpec } from "@alt-assessment/shared";

export function SimulationRenderer({ spec }: { spec: SimulationSpec }) {
  const orderedSteps = useMemo(() => [...spec.timelineSteps].sort((a, b) => a.order - b.order), [spec.timelineSteps]);
  const [stepId, setStepId] = useState(orderedSteps[0]?.id ?? "");
  const positions = new Map(spec.positions.map((position) => [position.entityId, position]));
  const selectedStep = orderedSteps.find((step) => step.id === stepId) ?? orderedSteps[0];

  return (
    <section className="simulation-panel">
      <div className="simulation-header">
        <div>
          <h2>{spec.title}</h2>
          <p>{spec.descriptionSummary}</p>
        </div>
      </div>
      <div className="simulation-stage" aria-label="Generated simulation">
        <svg viewBox="0 0 100 100" role="img" aria-label={spec.title}>
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="currentColor" />
            </marker>
          </defs>
          {spec.movements.map((movement) => (
            <line
              key={movement.id}
              x1={movement.fromX}
              y1={movement.fromY}
              x2={movement.toX}
              y2={movement.toY}
              className="movement-line"
              markerEnd="url(#arrow)"
            />
          ))}
          {spec.entities.map((entity, index) => {
            const position = positions.get(entity.id);
            const x = clamp(position?.x ?? 20 + index * 12);
            const y = clamp(position?.y ?? 45 + (index % 3) * 12);
            return (
              <g key={entity.id} transform={`translate(${x} ${y})`} className="entity-node">
                {entity.shape === "square" ? (
                  <rect x="-4" y="-4" width="8" height="8" rx="1.5" fill={entity.color} />
                ) : entity.shape === "triangle" ? (
                  <path d="M0 -5 L5 5 L-5 5 Z" fill={entity.color} />
                ) : (
                  <circle r={entity.shape === "cell" ? 6 : 4.5} fill={entity.color} />
                )}
                <text y="11" textAnchor="middle">{entity.name}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {selectedStep && <p className="selected-step">{selectedStep.text}</p>}
      <div className="timeline-strip" aria-label="Simulation timeline">
        {orderedSteps.map((step) => (
          <button key={step.id} type="button" className={step.id === stepId ? "active" : ""} onClick={() => setStepId(step.id)}>
            {step.order}
          </button>
        ))}
      </div>
      <div className="source-list">
        {spec.entities.slice(0, 4).map((entity) => (
          <span key={entity.id}>{entity.name}: “{entity.source.quote}”</span>
        ))}
      </div>
    </section>
  );
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(94, Math.max(6, value));
}
