import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { generateSimulationHtml, generateSimulationSketch } from "../src/lib/openai";
import { getSimulationCodeModel, toOpenAIModelCatalogEntry } from "../src/lib/models";

// Exercise the installed SDK's serialization and response handling, not a mock of its methods.
describe("OpenAI SDK request compatibility", () => {
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
