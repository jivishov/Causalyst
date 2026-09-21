import svgJsRuntime from "../vendor/svgjs-v3.2.5.min.js.txt";
import { HttpError } from "./http";

const SVG_RUNTIME_MARKER = "data-alt-assessment-svgjs-runtime";

const FORBIDDEN_GENERATED_HTML_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /<script\b[^>]*\bsrc\s*=/i, label: "external script" },
  { pattern: /<script\b[^>]*\btype\s*=\s*["']?module\b/i, label: "module script" },
  { pattern: /<link\b[^>]*\brel\s*=\s*["']?stylesheet\b[^>]*\bhref\s*=/i, label: "external stylesheet" },
  { pattern: /@import\b/i, label: "CSS import" },
  { pattern: /\bimport\s*\(/i, label: "dynamic import" },
  { pattern: /\bimport\s+[^;]+?\s+from\b/i, label: "module import" },
  { pattern: /\bfetch\s*\(/i, label: "fetch" },
  { pattern: /\bXMLHttpRequest\b/i, label: "XMLHttpRequest" },
  { pattern: /\bWebSocket\b/i, label: "WebSocket" },
  { pattern: /\bEventSource\b/i, label: "EventSource" },
  { pattern: /\bsendBeacon\s*\(/i, label: "sendBeacon" },
  { pattern: /\blocalStorage\b/i, label: "localStorage" },
  { pattern: /\bsessionStorage\b/i, label: "sessionStorage" },
  { pattern: /\bindexedDB\b/i, label: "indexedDB" },
  { pattern: /\bcaches\b/i, label: "Cache API" },
  { pattern: /\bdocument\s*\.\s*cookie\b/i, label: "cookies" },
  { pattern: /\beval\s*\(/i, label: "eval" },
  { pattern: /\bnew\s+Function\b/i, label: "Function constructor" },
  { pattern: /(^|[^\w.])Function\s*\(/i, label: "Function constructor" },
  { pattern: /\bdocument\s*\.\s*write\s*\(/i, label: "document.write" },
  { pattern: /\bwindow\s*\.\s*parent\b/i, label: "parent window access" },
  { pattern: /(^|[^\w.])parent\s*\./i, label: "parent window access" },
  { pattern: /\bwindow\s*\.\s*opener\b/i, label: "opener access" },
  { pattern: /(^|[^\w.])opener\s*\./i, label: "opener access" },
  { pattern: /\b(?:src|href|xlink:href)\s*=\s*["']\s*(?:https?:)?\/\//i, label: "external URL" },
  { pattern: /\burl\s*\(\s*["']?\s*(?:https?:)?\/\//i, label: "external URL" },
  { pattern: /\b(?:new\s+)?Konva\b|\bKonva\s*\./i, label: "Konva" },
  { pattern: /\b(?:new\s+)?Matter\b|\bMatter\s*\./i, label: "Matter.js" },
  { pattern: /\b(?:new\s+)?THREE\b|\bTHREE\s*\./i, label: "Three.js" },
  { pattern: /\bd3\s*\./i, label: "D3" },
  { pattern: /\bgsap\s*\./i, label: "GSAP" },
  { pattern: /\bnew\s+p5\b|\bp5\s*\(/i, label: "p5.js" }
];

export function prepareGeneratedSimulationHtml(html: string): string {
  validateGeneratedSimulationHtml(html);
  if (html.includes(SVG_RUNTIME_MARKER)) return html;
  return injectSvgRuntime(html);
}

export function validateGeneratedSimulationHtml(html: string): void {
  const normalized = html.trim();
  if (!/^<!doctype\s+html\b/i.test(normalized) || !/<html\b/i.test(normalized)) {
    throw new HttpError(502, "Simulation HTML output must be a complete HTML document");
  }

  for (const forbidden of FORBIDDEN_GENERATED_HTML_PATTERNS) {
    if (forbidden.pattern.test(html)) {
      throw new HttpError(502, `Simulation HTML used forbidden ${forbidden.label}`);
    }
  }
}

function injectSvgRuntime(html: string): string {
  const runtimeTag = `<script ${SVG_RUNTIME_MARKER}>${svgJsRuntime}</script>`;
  const firstScript = /<script\b/i;
  if (firstScript.test(html)) {
    return html.replace(firstScript, `${runtimeTag}$&`);
  }

  const closingHead = /<\/head\s*>/i;
  if (closingHead.test(html)) {
    return html.replace(closingHead, `${runtimeTag}$&`);
  }

  const openingBody = /<body\b[^>]*>/i;
  if (openingBody.test(html)) {
    return html.replace(openingBody, `$&${runtimeTag}`);
  }

  return `${runtimeTag}${html}`;
}
