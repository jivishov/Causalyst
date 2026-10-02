import { describe, expect, it } from "vitest";
import type { SimulationHtmlStreamEvent } from "@alt-assessment/shared";
import { consumeSimulationHtmlStream } from "../src/lib/simulationStream";

describe("student HTML stream", () => {
  it("accepts a complete reconnect snapshot without duplicating prior HTML", async () => {
    const source = '<html><script>const label="plant";</script></html>';
    const event = { type: "html_snapshot", source, cursor: 8 };
    const response = new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    const received: SimulationHtmlStreamEvent[] = [];
    await consumeSimulationHtmlStream(response, value => received.push(value));
    expect(received).toEqual([event]);
  });
  it("decodes split UTF-8, CRLF, multiline SSE and complete events before the response ends", async () => {
    const html: SimulationHtmlStreamEvent = { type: "html_delta", delta: '<p>Energy → plants</p>\n<script>unfinished', cursor: 3 };
    const bytes = new TextEncoder().encode(`: keepalive\r\n\r\ndata: ${JSON.stringify(html)}\r\n\r\ndata: {"type":\r\ndata: "checkpoint", "cursor": 4}\r\n\r\ndata: {"type":"html_delta","delta":"cut off`);
    const response = new Response(new ReadableStream({ start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    } }), { headers: { "Content-Type": "text/event-stream" } });
    const events: SimulationHtmlStreamEvent[] = [];
    await consumeSimulationHtmlStream(response, event => events.push(event));
    expect(events).toEqual([html, { type: "checkpoint", cursor: 4 }]);
  });

  it("aborts a pending read and releases the connection", async () => {
    let cancelled = false;
    const abort = new AbortController();
    const response = new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { "Content-Type": "text/event-stream" } });
    const reading = consumeSimulationHtmlStream(response, () => { throw new Error("No event expected"); }, abort.signal);
    abort.abort();
    await reading;
    expect(cancelled).toBe(true);
  });

  it("rejects malformed events and buffered non-streaming responses for polling recovery", async () => {
    const response = new Response('data: {"type":"html_delta","delta":"<html>"}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    await expect(consumeSimulationHtmlStream(response, () => {})).rejects.toThrow("invalid event");
    await expect(consumeSimulationHtmlStream(Response.json({}), () => {})).rejects.toThrow("unavailable");
  });
});
