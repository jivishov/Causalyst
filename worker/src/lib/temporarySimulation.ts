import { parse, serialize } from "parse5";
import { prepareGeneratedSimulationHtml } from "./simulationHtmlPolicy";
import { TEMPORARY_LIMITS } from "@alt-assessment/shared";
import { HttpError } from "./http";

export const TEMPORARY_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
/** Trust transformations exactly once, then persist these exact executed bytes. */
export function prepareTemporarySimulationHtml(source: string): string {
  const invalid = () =>
    new HttpError(
      422,
      "Simulation validation failed. Repair the code; preserve the student's explanation.",
      undefined,
      "VALIDATION_FAILED",
    );
  if (
    new TextEncoder().encode(source).byteLength >
      TEMPORARY_LIMITS.sourceBytes ||
    /data-alt-assessment-svgjs-runtime/i.test(source)
  )
    throw invalid();
  let html: string;
  try {
    html = prepareGeneratedSimulationHtml(source);
  } catch {
    throw invalid();
  }
  const document = parse(html),
    head = document.childNodes.find(
      (n) => "tagName" in n && n.tagName === "html",
    );
  if (!head || !("childNodes" in head)) throw invalid();
  const h = head.childNodes.find((n) => "tagName" in n && n.tagName === "head");
  if (!h || !("childNodes" in h)) throw invalid();
  const meta = parse(
    `<html><head><meta http-equiv="Content-Security-Policy" content="${TEMPORARY_CSP}"></head></html>`,
  );
  const root = meta.childNodes.find(
    (n) => "tagName" in n && n.tagName === "html",
  );
  if (root && "childNodes" in root) {
    const mh = root.childNodes.find(
      (n) => "tagName" in n && n.tagName === "head",
    );
    if (mh && "childNodes" in mh) {
      const node = mh.childNodes[0];
      if (node) {
        node.parentNode = h;
        h.childNodes.unshift(node);
      }
    }
  }
  html = serialize(document);
  if (new TextEncoder().encode(html).byteLength > TEMPORARY_LIMITS.bundleBytes)
    throw invalid();
  return html;
}
