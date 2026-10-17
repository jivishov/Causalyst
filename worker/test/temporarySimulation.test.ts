import { describe, it, expect } from "vitest";
import { prepareTemporarySimulationHtml } from "../src/lib/temporarySimulation";
const document = (body: string) =>
  `<!doctype html><html><head></head><body>${body}</body></html>`;
describe("teacher-client simulation trust boundary", () => {
  it("stores its effective runtime and network policy exactly once", () => {
    const html = prepareTemporarySimulationHtml(
      document(
        '<button id="b">Play</button><script>document.getElementById("b").onclick=()=>{document.body.dataset.play="yes"}</script>',
      ),
    );
    expect(html).toContain("Content-Security-Policy");
    expect(html).toContain("connect-src 'none'");
    expect(html.match(/data-alt-assessment-svgjs-runtime/g)).toHaveLength(1);
    expect(() => prepareTemporarySimulationHtml(html)).toThrow();
  });
  it.each([
    "<script data-alt-assessment-svgjs-runtime>window.parent.alert(1)</script>",
    '<script>fetch("https://evil.test")</script>',
    '<img src="https://evil.test/x">',
    '<script>eval("alert(1)")</script>',
    '<iframe src="about:blank"></iframe>',
  ])("rejects unsupported code: %s", (body) =>
    expect(() => prepareTemporarySimulationHtml(document(body))).toThrow(),
  );
  it("enforces UTF-8 bytes rather than just character count", () =>
    expect(() =>
      prepareTemporarySimulationHtml(document("界".repeat(180000))),
    ).toThrow());
});
