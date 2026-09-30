import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { generateSimulationHtml, generateSimulationSketch, startSimulationHtmlBackgroundResponse, streamSimulationBackgroundResponse } from "../src/lib/openai";
import { getSimulationCodeModel, toOpenAIModelCatalogEntry } from "../src/lib/models";

// Exercise the installed SDK's serialization and response handling, not a mock of its methods.
describe("OpenAI SDK request compatibility", () => {
  it("acknowledges a streaming background job before HTML finishes and resumes it without another generation", async () => {
    const requests: { method: string; url: string }[] = [];
    const model = toOpenAIModelCatalogEntry(getSimulationCodeModel("openai:gpt-5.6-terra"));
    let initialDisconnected = false;
    const client = new OpenAI({ apiKey: "synthetic-test-key", maxRetries: 0, fetch: async (url, options) => {
      requests.push({ method: options?.method ?? "GET", url: String(url) });
      if (options?.method === "POST") {
        expect(JSON.parse(String(options.body))).toMatchObject({ model: model.id, background: true, stream: true, store: true, reasoning: { effort: "max" } });
        return new Response(new ReadableStream({
          start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "response.created", sequence_number: 0, response: { id: "resp_background", status: "queued" } })}\n\n`)); },
          cancel() { initialDisconnected = true; }
        }), { headers: { "Content-Type": "text/event-stream" } });
      }
      expect(String(url)).toBe("https://api.openai.com/v1/responses/resp_background?stream=true&starting_after=7");
      return new Response(`data: ${JSON.stringify({ type: "response.output_text.delta", sequence_number: 8, delta: "<h1>Resumed HTML</h1>" })}\n\n`, { headers: { "Content-Type": "text/event-stream" } });
    } });
    const job = await startSimulationHtmlBackgroundResponse(client, { description: "Two circles", model });
    expect(job).toMatchObject({ responseId: "resp_background", modelUsed: "gpt-5.6-terra", status: "queued" });
    expect(initialDisconnected).toBe(true);
    const stream = await streamSimulationBackgroundResponse(client, job.responseId, 7);
    const events = [];
    for await (const event of stream) events.push(event);
    expect(events).toEqual([expect.objectContaining({ sequence_number: 8, delta: "<h1>Resumed HTML</h1>" })]);
    expect(requests.map(r => r.method)).toEqual(["POST", "GET"]);
    expect(requests.some(r => r.url.includes("/cancel"))).toBe(false);
  });

  it("sends Max reasoning and image inputs through Responses for every selected text model", async () => {
    for (const id of ["openai:gpt-5.6-sol", "openai:gpt-5.6-terra", "openai:gpt-5.6-luna"] as const) {
      const model = toOpenAIModelCatalogEntry(getSimulationCodeModel(id));
      const client = new OpenAI({
        apiKey: "synthetic-test-key", maxRetries: 0,
        fetch: async (url, options) => {
          expect(String(url)).toBe("https://api.openai.com/v1/responses");
          expect(options?.method).toBe("POST");
          const body = JSON.parse(String(options?.body));
          expect(body.model).toBe(model.id);
          expect(body.reasoning).toEqual({ effort: "max" });
          expect(body.input[1].content[0]).toMatchObject({ type: "input_image", file_id: "file_synthetic", detail: "auto" });
          expect(body).not.toHaveProperty("temperature");
          return Response.json({ id: "resp_synthetic", object: "response", status: "completed", model: model.id,
            output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "<html>diagram</html>", annotations: [] }] }] });
        }
      });
      const result = await generateSimulationHtml(client, { description: "Two circles", sketchFileId: "file_synthetic", model });
      expect(result.html).toBe("<html>diagram</html>");
    }
  });

  it("decodes Images output and keeps an unavailable-model fallback within Image 2.5", async () => {
    const requested: string[] = [];
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const client = new OpenAI({
      apiKey: "synthetic-test-key", maxRetries: 0,
      fetch: async (url, options) => {
        expect(String(url)).toBe("https://api.openai.com/v1/images/generations");
        const body = JSON.parse(String(options?.body));
        requested.push(body.model);
        expect(body).toMatchObject({ output_format: "png", quality: "medium", size: "1536x1024", n: 1 });
        expect(body).not.toHaveProperty("reasoning");
        expect(body).not.toHaveProperty("response_format");
        if (requested.length === 1) {
          return Response.json({ error: { code: "model_not_found", message: "The model is not available" } }, { status: 404 });
        }
        return Response.json({ created: 0, data: [{ b64_json: Buffer.from(png).toString("base64") }] });
      }
    });
    const result = await generateSimulationSketch(client, { description: "Two circles" });
    expect(requested).toEqual(["gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);
    expect(result.bytes).toEqual(png);
    expect(result.modelUsed).toBe("gpt-image-2.5-sunburst");
  });
});
