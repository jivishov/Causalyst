import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { prepareGeneratedSimulationHtml, validateGeneratedSimulationHtml } from "../src/lib/simulationHtmlPolicy";

describe("simulation HTML policy", () => {
  it("accepts science text, comments, and strings mentioning matter, three, or library names", () => {
    const html = '<!doctype html><html><head><title>States of Matter</title></head><body><h1>Transfer matter between three containers.</h1><script>const matter = "Matter.js and THREE are not used"; const three = 3; document.querySelector("h1").dataset.label = matter; // Konva, d3.select(), gsap.to(), and p5() are not used\n</script></body></html>';
    expect(() => prepareGeneratedSimulationHtml(html)).not.toThrow();
  });

  it.each([
    "Matter.Engine.create()", "window['Matter'].Engine.create()", "const engine = globalThis.Matter;",
    "new Konva.Stage({})", "new THREE.Scene()", "d3.select('body')", "gsap.to({}, {})", "new p5(() => {})",
    "const Matter = {}; Matter.Engine.create()"
  ])("still rejects executable framework use: %s", (code) => {
    expect(() => prepareGeneratedSimulationHtml(`<!doctype html><html><body><script>${code}</script></body></html>`)).toThrow(/forbidden (Matter.js|Konva|Three.js|D3|GSAP|p5.js)/);
  });

  it("accepts anonymous callbacks and function expressions used by interactive previews", () => {
    const html = '<!doctype html><html><body><button id="step">Step</button><output id="count">0</output><script>let count = 0; const step = function () { document.getElementById("count").textContent = String(++count); }; document.getElementById("step").addEventListener("click", function () { step(); }); [1, 2].map(function (value) { return value * 2; }); // Function() is not called here\n</script></body></html>';
    expect(() => validateGeneratedSimulationHtml(html)).not.toThrow();
    expect(prepareGeneratedSimulationHtml(html)).toContain('addEventListener("click", function ()');
  });

  it.each([
    'Function("return 1")()',
    'new Function("return 1")()',
    'window.Function("return 1")()',
    'new globalThis["Function"]("return 1")()',
    'self.Function?.("return 1")'
  ])("still rejects dynamic code execution: %s", (code) => {
    expect(() => prepareGeneratedSimulationHtml(`<!doctype html><html><body><script>${code}</script></body></html>`)).toThrow(/forbidden dynamic code execution/);
  });

  it("keeps DOM helper variables and comments named parent without confusing them with a browser window", () => {
    const html = '<!doctype html><html><body><main id="stage"></main><script>function draw(parent) { parent.appendChild(document.createElement("span")); } draw(document.getElementById("stage")); // window.parent is not used\n</script></body></html>';
    expect(() => validateGeneratedSimulationHtml(html)).not.toThrow();
    expect(prepareGeneratedSimulationHtml(html)).toContain('parent.appendChild');
  });

  it.each([
    "window.parent.postMessage({height: 720}, '*');",
    "parent.postMessage({height: 720}, '*');",
    "window['parent']['postMessage']({height: 720}, '*');",
    "window.parent?.postMessage({height: 720}, '*');"
  ])("removes generated host notification %s while keeping simulation behavior", (notification) => {
    const html = `<!doctype html><html><body><script>let step = 0; function next(){step += 1; ${notification} } next();</script></body></html>`;
    const prepared = prepareGeneratedSimulationHtml(html);
    expect(prepared).toContain('step += 1; (void 0)');
    expect(prepared).not.toContain(notification);
    const script = prepared.match(/<script>([\s\S]*?)<\/script>/)![1];
    const isolatedWindow = Object.defineProperty({}, "parent", { get() { throw new Error("Host window accessed"); } });
    expect(runInNewContext(script + "; next(); step;", { window: isolatedWindow })).toBe(2);
  });

  it.each([
    "window.parent.document.body.textContent = 'x';",
    "window['parent'].document;",
    "globalThis.parent.document;",
    "self.top.document;",
    "const host = parent;",
    "function unsafe(){ parent.document.body; } function safe(parent){ parent.appendChild(document.createElement('span')); }",
    "window.parent.postMessage({}, '*'); window.parent.document;"
  ])("still rejects cross-window access after notification removal: %s", (code) => {
    expect(() => prepareGeneratedSimulationHtml(`<!doctype html><html><body><script>${code}</script></body></html>`)).toThrow(/forbidden parent window access/);
  });

  it("validates inline event handlers and rejects malformed scripts", () => {
    expect(() => prepareGeneratedSimulationHtml('<!doctype html><html><body><button onclick="return parent.document;">x</button></body></html>')).toThrow(/forbidden parent window access/);
    expect(() => prepareGeneratedSimulationHtml('<!doctype html><html><body><script>function broken( {</script></body></html>')).toThrow(/invalid JavaScript/);
  });

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
