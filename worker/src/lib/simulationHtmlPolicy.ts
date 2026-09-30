import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { parse as parseJavaScript } from "acorn";
import { analyze } from "eslint-scope";
import svgJsRuntime from "../vendor/svgjs-v3.2.5.min.js.txt";
import { HttpError } from "./http";

const SVG_RUNTIME_MARKER = "data-alt-assessment-svgjs-runtime";

const FORBIDDEN_GENERATED_HTML_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b(?:location|open)\s*(?:\.|\[|=|\()/i, label: "navigation" },
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
  { pattern: /\bdocument\s*\.\s*write\s*\(/i, label: "document.write" },
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
  assertCompleteDocument(html);
  const document = parse(html);
  visitInlineJavaScript(document, (source) => removeCrossWindowMessages(source));
  const reconstructed = serialize(document);
  validateGeneratedSimulationHtml(reconstructed);
  if (reconstructed.includes(SVG_RUNTIME_MARKER)) return reconstructed;
  return injectSvgRuntime(reconstructed);
}

export function validateGeneratedSimulationHtml(html: string): void {
  assertCompleteDocument(html);

  const document = parse(html);
  visitInlineJavaScript(document, (source) => {
    const { ast, unresolvedWindowReferences } = inspectJavaScript(source);
    if (unresolvedWindowReferences.size > 0) {
      throw new HttpError(502, "Simulation HTML used forbidden parent window access");
    }
    walkJavaScript(ast, (node) => {
      if (isCrossWindowReference(node, unresolvedWindowReferences)) {
        throw new HttpError(502, "Simulation HTML used forbidden parent window access");
      }
      if (isDynamicCodeConstructor(node)) {
        throw new HttpError(502, "Simulation HTML used forbidden dynamic code execution");
      }
    });
    return source;
  });


  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if ("tagName" in node) {
      if (["base", "iframe", "frame", "frameset", "object", "embed", "form", "link"].includes(node.tagName)) {
        throw new HttpError(502, `Simulation HTML used forbidden ${node.tagName}`);
      }
      for (const attribute of node.attrs) {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name === "http-equiv" || name === "srcset" || name === "ping" || name === "action" || name === "formaction") {
          throw new HttpError(502, `Simulation HTML used forbidden ${name}`);
        }
        if (["src", "href", "poster", "data"].includes(name) && value && !value.startsWith("#") &&
            !(node.tagName === "img" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value))) {
          throw new HttpError(502, "Simulation HTML used forbidden external URL");
        }
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
    if ("content" in node && node.content) visit(node.content);
  }
  visit(document);

  for (const forbidden of FORBIDDEN_GENERATED_HTML_PATTERNS) {
    if (forbidden.pattern.test(html)) {
      throw new HttpError(502, `Simulation HTML used forbidden ${forbidden.label}`);
    }
  }
}

function assertCompleteDocument(html: string): void {
  if (html.length > 500000) throw new HttpError(502, "Simulation HTML is too large");
  const normalized = html.trim();
  if (!/^<!doctype\s+html\b/i.test(normalized) || !/<html\b/i.test(normalized)) {
    throw new HttpError(502, "Simulation HTML output must be a complete HTML document");
  }


}

type JavaScriptNode = { type: string; start: number; end: number; [key: string]: unknown };

function inspectJavaScript(source: string): { ast: JavaScriptNode; unresolvedWindowReferences: Set<number> } {
  try {
    const ast = parseJavaScript(source, { ecmaVersion: "latest", sourceType: "script", ranges: true, allowReturnOutsideFunction: true });
    const scopes = analyze(ast as unknown as Parameters<typeof analyze>[0], { ecmaVersion: 2022, sourceType: "script" });
    const unresolvedWindowReferences = new Set((scopes.globalScope?.through ?? [])
      .filter((reference) => ["parent", "opener", "top"].includes(reference.identifier.name))
      .map((reference) => reference.identifier.range![0]));
    return { ast: ast as unknown as JavaScriptNode, unresolvedWindowReferences };
  } catch {
    throw new HttpError(502, "Simulation HTML used invalid JavaScript");
  }
}

function walkJavaScript(node: JavaScriptNode, visitor: (node: JavaScriptNode) => void): void {
  visitor(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child === "object" && typeof child.type === "string") walkJavaScript(child, visitor);
    } else if (value && typeof value === "object" && "type" in value && typeof value.type === "string") {
      walkJavaScript(value as JavaScriptNode, visitor);
    }
  }
}

function memberName(node: JavaScriptNode): string | undefined {
  if (node.type !== "MemberExpression") return undefined;
  const property = node.property as JavaScriptNode;
  return !node.computed && property.type === "Identifier" ? property.name as string
    : property.type === "Literal" && typeof property.value === "string" ? property.value : undefined;
}

function isCrossWindowReference(node: JavaScriptNode, unresolved: Set<number>): boolean {
  if (node.type === "Identifier") return unresolved.has(node.start);
  if (node.type !== "MemberExpression" || !["parent", "opener", "top"].includes(memberName(node) ?? "")) return false;
  const object = node.object as JavaScriptNode;
  return object.type === "Identifier" && ["window", "self", "globalThis"].includes(object.name as string);
}

// JavaScript is case-sensitive: an ordinary function () callback is not the
// Function constructor. Inspect executable calls instead of matching HTML text.
function isDynamicCodeConstructor(node: JavaScriptNode): boolean {
  if (node.type !== "CallExpression" && node.type !== "NewExpression") return false;
  const callee = node.callee as JavaScriptNode;
  if (callee.type === "Identifier") return callee.name === "Function";
  if (memberName(callee) !== "Function") return false;
  const object = callee.object as JavaScriptNode;
  return object.type === "Identifier" && ["window", "self", "globalThis"].includes(object.name as string);
}

// The host owns preview health and sizing. Remove only direct outbound frame
// notifications; every other cross-window capability is still rejected.
function removeCrossWindowMessages(source: string): string {
  const { ast, unresolvedWindowReferences } = inspectJavaScript(source);
  const removals: Array<{ start: number; end: number }> = [];
  walkJavaScript(ast, (node) => {
    if (node.type !== "CallExpression") return;
    const callee = node.callee as JavaScriptNode;
    if (memberName(callee) === "postMessage" && isCrossWindowReference(callee.object as JavaScriptNode, unresolvedWindowReferences)) {
      removals.push({ start: node.start, end: node.end });
    }
  });
  const independent = removals.filter((entry) => !removals.some((other) => other.start < entry.start && other.end >= entry.end));
  for (const entry of independent.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, entry.start) + "(void 0)" + source.slice(entry.end);
  }
  return source;
}

function visitInlineJavaScript(node: DefaultTreeAdapterMap["node"], transform: (source: string) => string): void {
  if ("tagName" in node) {
    if (node.tagName === "script" && node.attrs.some((attribute) => attribute.name === "type" && attribute.value.trim().toLowerCase() === "module")) {
      throw new HttpError(502, "Simulation HTML used forbidden module script");
    }
    if (node.tagName === "script" && !node.attrs.some((attribute) => attribute.name === "type" && ["application/json", "application/ld+json"].includes(attribute.value.trim().toLowerCase()))) {
      for (const child of node.childNodes) if (child.nodeName === "#text" && "value" in child) child.value = transform(child.value);
    }
    for (const attribute of node.attrs) if (/^on/i.test(attribute.name)) attribute.value = transform(attribute.value);
  }
  if ("childNodes" in node) for (const child of node.childNodes) visitInlineJavaScript(child, transform);
  if ("content" in node && node.content) visitInlineJavaScript(node.content, transform);
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
