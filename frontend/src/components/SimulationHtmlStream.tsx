import { useEffect, useRef, useState } from "react";
import { Code2, LoaderCircle } from "lucide-react";
import "./SimulationHtmlStream.css";

export function SimulationHtmlStream({ active, source, startedAt, live, finalizing }: {
  active: boolean;
  source: string;
  startedAt?: string;
  live: boolean;
  finalizing: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  const codeRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const parsed = Date.parse(startedAt ?? "");
    const start = Number.isFinite(parsed) ? parsed : Date.now();
    const update = () => setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    update();
    if (!active) return;
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  useEffect(() => {
    if (active && codeRef.current) codeRef.current.scrollTop = codeRef.current.scrollHeight;
  }, [active, source]);
  if (!active && !source) return null;
  const elapsed = seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const lines = source ? source.split("\n").length : 0;
  return (
    <div className="simulation-html-stream" aria-label="HTML generation activity">
      <div className="simulation-html-stream-header">
        <span className="simulation-html-stream-icon" aria-hidden="true">
          {active ? <LoaderCircle size={18} className="student-action-spinner" /> : <Code2 size={18} />}
        </span>
        <div role="status" aria-live="polite" aria-atomic="true">
          <strong>{active ? finalizing ? "Checking your preview" : source ? "HTML is arriving" : "Building your simulation" : "HTML received"}</strong>
          <p>{active ? finalizing ? "Your HTML has arrived. Checking and saving the simulation." : live ? source ? "The simulation will open when the code is complete and checked." : "Waiting for the first code. Your generation is still running." : "Checking progress. Your generation is still running." : "Generation has finished. See the preview status below."}</p>
        </div>
        <span className="simulation-html-stream-metrics">{active && <span>{elapsed}</span>}{source && <span>{lines.toLocaleString()} lines · {source.length.toLocaleString()} characters</span>}</span>
      </div>
      {source && <details className="simulation-html-stream-code" open={active}>
        <summary>Generated HTML · latest lines{active ? " · live" : ""}</summary>
        {/* Render as text. Partial HTML/JavaScript must never run in the host or
            replace a student's currently working simulation. */}
        <pre ref={codeRef} tabIndex={0} aria-label="Generated HTML code"><code>{source.slice(-16000)}</code></pre>
      </details>}
    </div>
  );
}
