import { describe, expect, it } from "vitest";
import { prepareGeneratedSimulationHtml, validateGeneratedSimulationHtml } from "../src/lib/simulationHtmlPolicy";

describe("simulation HTML policy", () => {
  it("injects the app-owned SVG.js runtime before generated scripts", () => {
    const html = [
      "<!doctype html>",
      "<html><head><title>Simulation</title></head><body>",
      "<main id=\"stage\"></main>",
      "<script>window.generatedScriptRan = typeof SVG === 'function';</script>",
      "</body></html>"
    ].join("");

    const prepared = prepareGeneratedSimulationHtml(html);

    expect(prepared).toContain("data-alt-assessment-svgjs-runtime");
    expect(prepared).toContain("@svgdotjs/svg.js v3.2.5");
    expect(prepared.indexOf("data-alt-assessment-svgjs-runtime")).toBeLessThan(prepared.indexOf("window.generatedScriptRan"));
  });

  it("accepts inline SVG namespaces and SVG.js stage code without external resources", () => {
    expect(() => validateGeneratedSimulationHtml([
      "<!doctype html>",
      "<html><head><style>.arrow{marker-end:url(#arrow)}</style></head>",
      "<body><svg xmlns=\"http://www.w3.org/2000/svg\"><defs><marker id=\"arrow\"></marker></defs></svg>",
      "<script>var draw = SVG().addTo('#stage'); draw.circle(20).fill('#58a');</script>",
      "</body></html>"
    ].join(""))).not.toThrow();
  });

  it.each([
    ["external scripts", "<script src=\"https://cdn.example.test/lib.js\"></script>"],
    ["module scripts", "<script type=\"module\">import x from './x.js';</script>"],
    ["external stylesheets", "<link rel=\"stylesheet\" href=\"https://example.test/style.css\">"],
    ["dynamic imports", "<script>import('x.js')</script>"],
    ["network APIs", "<script>fetch('/api')</script>"],
    ["storage APIs", "<script>localStorage.setItem('x','y')</script>"],
    ["eval-like APIs", "<script>new Function('return 1')</script>"],
    ["document.write", "<script>document.write('x')</script>"],
    ["parent access", "<script>window.parent.postMessage({}, '*')</script>"],
    ["banned libraries", "<script>new Konva.Stage({ container: 'stage' })</script>"]
  ])("rejects generated HTML with %s", (_label, forbiddenMarkup) => {
    const html = `<!doctype html><html><head><title>x</title></head><body>${forbiddenMarkup}</body></html>`;

    expect(() => validateGeneratedSimulationHtml(html)).toThrow(/Simulation HTML used forbidden/);
  });
});
