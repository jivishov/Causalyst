import { type CSSProperties, useEffect, useRef, useState } from "react";
import type { SimulationHtmlViewport } from "@alt-assessment/shared";
import { resolveSimulationPreviewMetrics } from "../lib/simulationGenerationUi";

export interface SimulationPreviewHealthReport {
  ok: boolean;
  reasonCodes: string[];
  metrics: Record<string, unknown>;
}

interface SimulationPreviewFrameProps {
  artifactId: string;
  src: string;
  title: string;
  healthNonce?: string | null;
  viewport?: SimulationHtmlViewport | null;
  onHealth?: (report: SimulationPreviewHealthReport, artifactId: string) => void;
  onLoad?: () => void;
  onError?: () => void;
}

interface ElementSize {
  width: number;
  height: number;
}

export function SimulationPreviewFrame({
  artifactId,
  src,
  title,
  healthNonce,
  viewport,
  onHealth,
  onLoad,
  onError
}: SimulationPreviewFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const metrics = resolveSimulationPreviewMetrics({
    containerWidth: size.width,
    containerHeight: size.height,
    viewport
  });
  const hasMeasuredSize = size.width > 0 && size.height > 0;
  const iframeStyle: CSSProperties = {
    width: `${metrics.iframeWidth}px`,
    height: `${metrics.iframeHeight}px`,
    opacity: hasMeasuredSize ? 1 : 0,
    transform: `translate(-50%, -50%) scale(${metrics.scale})`
  };
  const frameStyle: CSSProperties = {
    aspectRatio: `${metrics.iframeWidth} / ${metrics.iframeHeight}`,
    height: `${metrics.wrapperHeight}px`,
    maxHeight: `${metrics.iframeHeight}px`,
    overflow: metrics.wrapperOverflow
  };

  useEffect(() => {
    const element = frameRef.current;
    if (!element) return;

    let frameId: number | null = null;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const nextSize = {
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
      setSize((current) => (
        current.width === nextSize.width && current.height === nextSize.height ? current : nextSize
      ));
    };
    const scheduleUpdate = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = null;
        updateSize();
      });
    };

    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleUpdate);
      return () => {
        if (frameId !== null) window.cancelAnimationFrame(frameId);
        window.removeEventListener("resize", scheduleUpdate);
      };
    }

    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(element);
    return () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!healthNonce || !onHealth) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!isRecord(data) || data.type !== "alt-assessment:simulation-preview-health" || data.nonce !== healthNonce) return;
      onHealth({
        ok: data.ok === true,
        reasonCodes: Array.isArray(data.reasonCodes)
          ? data.reasonCodes.filter((value): value is string => typeof value === "string")
          : [],
        metrics: isRecord(data.metrics) ? data.metrics : {}
      }, artifactId);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [artifactId, healthNonce, onHealth]);

  return (
    <div
      className="simulation-preview-frame"
      ref={frameRef}
      style={frameStyle}
    >
      <iframe
        className="simulation-preview-iframe"
        title={title}
        src={src}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        ref={iframeRef}
        onLoad={onLoad}
        onError={onError}
        scrolling="no"
        style={iframeStyle}
      />
    </div>
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
