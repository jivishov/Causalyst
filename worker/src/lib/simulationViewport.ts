import {
  LEGACY_SIMULATION_HTML_VIEWPORT,
  SIMULATION_HTML_VIEWPORT,
  type SimulationHtmlViewport
} from "@alt-assessment/shared";

export const CURRENT_SIMULATION_HTML_VIEWPORT: SimulationHtmlViewport = {
  width: SIMULATION_HTML_VIEWPORT.width,
  height: SIMULATION_HTML_VIEWPORT.height
};

export const LEGACY_HTML_PREVIEW_VIEWPORT: SimulationHtmlViewport = {
  width: LEGACY_SIMULATION_HTML_VIEWPORT.width,
  height: LEGACY_SIMULATION_HTML_VIEWPORT.height
};

export function simulationHtmlViewportColumns(viewport: SimulationHtmlViewport = CURRENT_SIMULATION_HTML_VIEWPORT) {
  return {
    simulation_html_viewport_width: viewport.width,
    simulation_html_viewport_height: viewport.height
  };
}

export function normalizeSimulationHtmlViewport(
  value: {
    simulation_html_viewport_width?: unknown;
    simulation_html_viewport_height?: unknown;
  } | null | undefined,
  fallback: SimulationHtmlViewport = LEGACY_HTML_PREVIEW_VIEWPORT
): SimulationHtmlViewport {
  const width = value?.simulation_html_viewport_width;
  const height = value?.simulation_html_viewport_height;
  if (isValidViewportDimension(width) && isValidViewportDimension(height)) {
    return { width, height };
  }
  return fallback;
}

function isValidViewportDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
