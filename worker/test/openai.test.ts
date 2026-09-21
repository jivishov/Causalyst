import { describe, expect, it, vi } from "vitest";
import { buildRefineSimulationHtmlResponsePayload, buildSimulationHtmlResponsePayload, classifySimulationReadiness, createImageResponseWithFallback, createSimulationResponseWithFallback, generateSimulationHtml, generateSimulationHtmlChatCompletion, generateSimulationSketch, refineSimulationHtml, refineSimulationHtmlChatCompletion } from "../src/lib/openai";
import { getSimulationCodeModel } from "../src/lib/models";

describe("createSimulationResponseWithFallback", () => {
  it("retries once with gpt-5.5 when gpt-5.4-mini is unavailable", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce({
        status: 404,
        code: "model_not_found",
        message: "The model `gpt-5.4-mini` does not exist"
      })
      .mockResolvedValueOnce({ id: "resp_fallback" });
    const client = { responses: { create } } as any;

    const result = await createSimulationResponseWithFallback(client, { id: "gpt-5.4-mini", fallbackModelId: "gpt-5.5" }, {
      model: "gpt-5.4-mini",
      input: []
    });

    expect(result.modelUsed).toBe("gpt-5.5");
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0][0].model).toBe("gpt-5.4-mini");
    expect(create.mock.calls[1][0].model).toBe("gpt-5.5");
  });

  it("does not fallback when no fallback model is configured", async () => {
    const unavailable = {
      status: 404,
      code: "model_not_found",
      message: "The model `gpt-5.5` does not exist"
    };
    const create = vi.fn().mockRejectedValueOnce(unavailable);
    const client = { responses: { create } } as any;

    await expect(
      createSimulationResponseWithFallback(client, { id: "gpt-5.5" }, {
        model: "gpt-5.5",
        input: []
      })
    ).rejects.toBe(unavailable);

    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry when fallback model matches the requested model", async () => {
    const unavailable = {
      status: 404,
      code: "model_not_found",
      message: "The model `gpt-5.4-mini` does not exist"
    };
    const create = vi.fn().mockRejectedValueOnce(unavailable);
    const client = { responses: { create } } as any;

    await expect(
      createSimulationResponseWithFallback(client, { id: "gpt-5.4-mini", fallbackModelId: "gpt-5.4-mini" }, {
        model: "gpt-5.4-mini",
        input: []
      })
    ).rejects.toBe(unavailable);

    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("generateSimulationHtml", () => {
  it("returns output_text as html response", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output_text: "<!doctype html><html><body>ok</body></html>"
    });
    const client = { responses: { create } } as any;

    const result = await generateSimulationHtml(client, {
      description: "A to B"
    });

    expect(result.html).toContain("<!doctype html>");
    expect(result.requestedModel).toBe("gpt-5.5");
    expect(result.modelUsed).toBe("gpt-5.5");
  });

  it("asks generated HTML to fit a no-scroll 1024 by 640 viewport without adding unstated facts", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output_text: "<!doctype html><html><body>ok</body></html>"
    });
    const client = { responses: { create } } as any;

    await generateSimulationHtml(client, {
      description: "A tank gets hotter and pressure increases."
    });

    const systemPrompt = String(create.mock.calls[0][0].input[0].content);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.5",
      reasoning: { effort: "medium" },
      text: { verbosity: "low" },
      max_output_tokens: 24000
    });
    expect(systemPrompt).toContain("Write the HTML now. Do not spend many tokens planning.");
    expect(systemPrompt).toContain("Use the app-provided SVG.js v3 global SVG");
    expect(systemPrompt).toContain("Static inline SVG is allowed for simple fixed shapes");
    expect(systemPrompt).toContain("Do not include the SVG.js library source");
    expect(systemPrompt).toContain("Build one fixed 1024px by 640px document and stage");
    expect(systemPrompt).toContain("Design for a laptop preview area");
    expect(systemPrompt).toContain("top-level CSS grid with reserved regions for toolbar, title/subtitle, main simulation stage, and bottom status/explanation");
    expect(systemPrompt).toContain("Keep Play, Pause, Reset, and Step Forward in the toolbar region only");
    expect(systemPrompt).toContain("Let the host preview frame handle final uniform scaling");
    expect(systemPrompt).toContain("html and body to width: 100%; height: 100%; margin: 0; overflow: hidden");
    expect(systemPrompt).toContain("Do not use page, body, app, stage, or canvas min-width or min-height values larger than the viewport");
    expect(systemPrompt).toContain("without document-level horizontal or vertical scrolling");
    expectSimulationHtmlTypographyConstraints(systemPrompt);
    expect(systemPrompt).toContain("Reserve safe visual margins so the central apparatus, arrows, side panels, labels, and footer notes do not touch, overlap, or clip");
    expect(systemPrompt).toContain("Keep bottom status/explanation content inside its reserved footer region");
    expect(systemPrompt).toContain("Do not use internal responsive stage scaling or non-uniform scale transforms for layout");
    expect(systemPrompt).toContain("Do not add formulas, states, labels, mechanisms, causes, effects, or explanatory text");
    expect(systemPrompt).toContain("Prefer simple labeled primitives first: circles, rectangles, lines, arrows, text, groups, and placeholders");
    expect(systemPrompt).toContain("Do not construct polished apparatus, icons, gauges, instruments, particles, formulas, or domain-specific decorations");
    expect(systemPrompt).toContain("If an object is named but visible details are missing");
    expect(systemPrompt).toContain("Do not use p5.js, Konva, Matter.js, Three.js, D3, GSAP");
    expect(systemPrompt).toContain("Use only HTML, CSS, plain DOM JavaScript for controls, and SVG.js for main-stage graphics");
    expect(systemPrompt).not.toContain("Use only HTML, CSS, and vanilla JavaScript");
    expect(systemPrompt).not.toContain("inline vanilla JavaScript only");
    expect(systemPrompt).not.toContain("classic peanut-butter-and-jelly sandwich");
    expect(systemPrompt).not.toContain("1366");
    expect(systemPrompt).not.toContain("900px");
  });

  it("sends the sketch PNG as image input before text when a sketch file id is provided", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output_text: "<!doctype html><html><body>ok</body></html>"
    });
    const client = { responses: { create } } as any;

    await generateSimulationHtml(client, {
      description: "A to B",
      sketchFileId: "file-sketch123"
    });

    const content = create.mock.calls[0][0].input[1].content;
    expect(content[0]).toMatchObject({
      type: "input_image",
      file_id: "file-sketch123"
    });
    expect(content[0]).not.toHaveProperty("detail");
    expect(content[1]).toMatchObject({ type: "input_text" });
    expect(String(content[1].text)).not.toContain("assessmentPrompt");
    expect(String(content[1].text)).toContain("studentDescription");
  });

  it("throws when output_text is missing", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output_text: ""
    });
    const client = { responses: { create } } as any;

    await expect(
      generateSimulationHtml(client, {
        description: "A to B"
      })
    ).rejects.toMatchObject({
      status: 502,
      message: "Model response did not include HTML output"
    });
  });
});

describe("refineSimulationHtml", () => {
  it("sends the sketch image before repair text and constrains the refinement to visual fidelity", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output_text: "<!doctype html><html><body>refined</body></html>"
    });
    const client = { responses: { create } } as any;

    const result = await refineSimulationHtml(client, {
      description: "A tank gets hotter and pressure increases.",
      sketchFileId: "file-sketch-refine",
      currentHtml: "<!doctype html><html><body>distorted</body></html>"
    });

    expect(result.html).toContain("refined");
    const content = create.mock.calls[0][0].input[1].content;
    expect(content[0]).toMatchObject({
      type: "input_image",
      file_id: "file-sketch-refine"
    });
    expect(content[1]).toMatchObject({ type: "input_text" });
    expect(String(content[1].text)).toContain("currentHtml");
    expect(String(content[1].text)).toContain("distorted");

    const systemPrompt = String(create.mock.calls[0][0].input[0].content);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.5",
      reasoning: { effort: "medium" },
      text: { verbosity: "low" },
      max_output_tokens: 24000
    });
    expect(systemPrompt).toContain("Write the final HTML now. Do not spend many tokens planning.");
    expect(systemPrompt).toContain("Use the app-provided SVG.js v3 global SVG");
    expect(systemPrompt).toContain("Static inline SVG is allowed for simple fixed shapes");
    expect(systemPrompt).toContain("Do not include the SVG.js library source");
    expect(systemPrompt).toContain("matches the attached sketch layout more closely");
    expect(systemPrompt).toContain("Do not add new domain facts, formulas, labels, mechanisms, states, causes, or effects");
    expect(systemPrompt).toContain("Prefer simple labeled primitives first: circles, rectangles, lines, arrows, text, groups, and placeholders");
    expect(systemPrompt).toContain("Do not construct polished apparatus, icons, gauges, instruments, particles, formulas, or domain-specific decorations");
    expect(systemPrompt).toContain("Do not use p5.js, Konva, Matter.js, Three.js, D3, GSAP");
    expect(systemPrompt).toContain("Target one complete 1024px by 640px viewport");
    expect(systemPrompt).toContain("Design for a laptop preview area");
    expect(systemPrompt).toContain("top-level CSS grid with reserved regions: toolbar, title/subtitle, main simulation stage, and bottom status/explanation");
    expect(systemPrompt).toContain("Keep Play, Pause, Reset, and Step Forward in the toolbar region only");
    expect(systemPrompt).toContain("Do not let the title overlap controls, the apparatus, labels, or footer content");
    expectSimulationHtmlTypographyConstraints(systemPrompt);
    expect(systemPrompt).toContain("Keep bottom status/explanation content inside its reserved footer region");
    expect(systemPrompt).toContain("Do not use internal responsive stage scaling or non-uniform scale transforms");
    expect(systemPrompt).toContain("Return only the final HTML document");
    expect(systemPrompt).not.toContain("Before writing the final HTML, internally check");
    expect(systemPrompt).not.toContain("inline vanilla JavaScript only");
    expect(systemPrompt).not.toContain("1366");
    expect(systemPrompt).not.toContain("900px");
  });

  it("uses the requested GPT-5.5 reasoning effort for generated and refined HTML", () => {
    for (const effort of ["low", "medium", "high"] as const) {
      expect(buildSimulationHtmlResponsePayload({
        description: "A to B",
        sketchFileId: "file-sketch",
        htmlReasoningEffort: effort
      }).payload).toMatchObject({
        model: "gpt-5.5",
        reasoning: { effort }
      });
      expect(buildRefineSimulationHtmlResponsePayload({
        description: "A to B",
        sketchFileId: "file-sketch",
        currentHtml: "<!doctype html><html><body>old</body></html>",
        htmlReasoningEffort: effort
      }).payload).toMatchObject({
        model: "gpt-5.5",
        reasoning: { effort }
      });
    }
  });
});

describe("OpenAI-compatible simulation chat completions", () => {
  it("sends Kimi sketch data URLs before student text", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      id: "chatcmpl-kimi",
      model: "kimi-k2.6",
      choices: [{ message: { content: "<!doctype html><html><body>kimi</body></html>" } }]
    });
    const client = { chat: { completions: { create } } } as any;

    const result = await generateSimulationHtmlChatCompletion(client, getSimulationCodeModel("kimi:kimi-k2.6"), {
      description: "A to B",
      sketchDataUrl: "data:image/png;base64,cG5n"
    });

    expect(result).toEqual({
      html: "<!doctype html><html><body>kimi</body></html>",
      modelUsed: "kimi-k2.6",
      requestedModel: "kimi-k2.6",
      providerResponseId: "chatcmpl-kimi"
    });
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "kimi-k2.6",
      max_tokens: 24000
    });
    const content = create.mock.calls[0][0].messages[1].content;
    expect(content[0]).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,cG5n" }
    });
    expect(content[1]).toMatchObject({ type: "text" });
    expect(String(content[1].text)).toContain("studentDescription");
    expect(String(content[1].text)).not.toContain("file_id");
  });

  it("sends Z.AI sketch data URLs for refinement with current HTML", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      id: "chatcmpl-zai",
      model: "glm-5v-turbo",
      choices: [{ message: { content: "<!doctype html><html><body>zai</body></html>" } }]
    });
    const client = { chat: { completions: { create } } } as any;

    const result = await refineSimulationHtmlChatCompletion(client, getSimulationCodeModel("zai:glm-5v-turbo"), {
      description: "A to B",
      sketchDataUrl: "data:image/png;base64,cG5n",
      currentHtml: "<!doctype html><html><body>old</body></html>"
    });

    expect(result.modelUsed).toBe("glm-5v-turbo");
    expect(result.requestedModel).toBe("glm-5v-turbo");
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "glm-5v-turbo",
      max_tokens: 24000
    });
    const content = create.mock.calls[0][0].messages[1].content;
    expect(content[0]).toMatchObject({
      type: "image_url",
      image_url: { url: "data:image/png;base64,cG5n" }
    });
    expect(String(content[1].text)).toContain("currentHtml");
    expect(String(content[1].text)).toContain("old");
    expect(String(content[1].text)).not.toContain("file_id");
  });
});

function expectSimulationHtmlTypographyConstraints(systemPrompt: string) {
  expect(systemPrompt).toContain("fitting text inside boxes takes priority over decorative hierarchy");
  expect(systemPrompt).toContain("Main title or h1 text must be at most 24px with font-weight at most 700");
  expect(systemPrompt).toContain("Subtitle text must be at most 14px with font-weight at most 500");
  expect(systemPrompt).toContain("Panel headings, card headings, and callout labels must be at most 16px with font-weight at most 700");
  expect(systemPrompt).toContain("Body text, list text, and status text must be 13px to 15px with font-weight at most 500");
  expect(systemPrompt).toContain("Large state buttons must use font-size at most 22px with font-weight at most 700");
  expect(systemPrompt).toContain("Do not use font-weight 800, font-weight 900, or the CSS keyword bold");
  expect(systemPrompt).toContain("Do not use oversized all-caps explanatory text, text-shadow, text stroke, or SVG stroke text");
  expect(systemPrompt).toContain("do not exceed them with more specific selectors, inline styles, SVG text attributes, clamp(), viewport units, or transform: scale()");
  expect(systemPrompt).toContain("Fixed-height text boxes must size text to fit without clipping");
  expect(systemPrompt).toContain("line-height between 1.15 and 1.35");
  expect(systemPrompt).toContain("shorten the repeated UI copy while preserving the student's domain facts elsewhere");
  expect(systemPrompt).toContain("Footer and status text must not overlap or push beyond reserved regions");
}

describe("generateSimulationSketch", () => {
  it("returns decoded PNG bytes from image generation output", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      data: [{ b64_json: Buffer.from("png-bytes").toString("base64") }]
    });
    const client = { images: { generate: create } } as any;

    const result = await generateSimulationSketch(client, {
      description: "Cells divide into two daughter cells."
    });

    expect(result.requestedModel).toBe("gpt-image-2");
    expect(result.modelUsed).toBe("gpt-image-2");
    expect(result.mimeType).toBe("image/png");
    expect(new TextDecoder().decode(result.bytes)).toBe("png-bytes");
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-image-2",
      output_format: "png",
      quality: "medium",
      size: "1536x1024",
      n: 1
    });
    expect(create.mock.calls[0][0].prompt).not.toContain("assessmentPrompt");
    expect(create.mock.calls[0][0].prompt).toContain("studentDescription");
  });

  it("throws when image generation output is missing base64 image data", async () => {
    const client = { images: { generate: vi.fn().mockResolvedValueOnce({ data: [{}] }) } } as any;

    await expect(generateSimulationSketch(client, {
      description: "A to B"
    })).rejects.toMatchObject({
      status: 502,
      message: "Image model response did not include image data"
    });
  });
});

describe("classifySimulationReadiness", () => {
  it("uses gpt-5.4-mini with xhigh reasoning and structured output", async () => {
    const create = vi.fn().mockResolvedValueOnce({
      output_parsed: {
        decision: "allow",
        reasonCode: "allow",
        relatedToPrompt: true,
        hasDrawableStudentEvidence: true,
        isMostlyPromptEcho: false
      }
    });
    const client = { responses: { create } } as any;

    const result = await classifySimulationReadiness(client, {
      assessmentPrompt: "Describe a gas law example.",
      studentDescription: "A tank gets hotter and pressure increases.",
      deterministicSignals: {
        descriptionLength: 42,
        minimumDescriptionChars: 40,
        uniqueSubstantiveTokenCount: 6,
        uniqueSubjectTokenCount: 3,
        promptEchoRatio: 0.2,
        repeatedSentenceRatio: 0,
        hasDrawableSubject: true,
        hasExplicitRelationship: true,
        isMostlyPromptEcho: false,
        isHighlyRepetitive: false,
        nonEvidencePhraseCount: 0
      }
    });

    expect(result.result.decision).toBe("allow");
    expect(result.requestedModel).toBe("gpt-5.4-mini");
    expect(result.modelUsed).toBe("gpt-5.4-mini");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({
      model: "gpt-5.4-mini",
      reasoning: { effort: "xhigh" },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "simulation_readiness",
          strict: true
        }
      }
    });
  });

  it("does not retry with a fallback model when classification fails", async () => {
    const unavailable = {
      status: 404,
      code: "model_not_found",
      message: "The model `gpt-5.4-mini` does not exist"
    };
    const create = vi.fn().mockRejectedValueOnce(unavailable);
    const client = { responses: { create } } as any;

    await expect(classifySimulationReadiness(client, {
      assessmentPrompt: "Describe a gas law example.",
      studentDescription: "A tank gets hotter and pressure increases.",
      deterministicSignals: {
        descriptionLength: 42,
        minimumDescriptionChars: 40,
        uniqueSubstantiveTokenCount: 6,
        uniqueSubjectTokenCount: 3,
        promptEchoRatio: 0.2,
        repeatedSentenceRatio: 0,
        hasDrawableSubject: true,
        hasExplicitRelationship: true,
        isMostlyPromptEcho: false,
        isHighlyRepetitive: false,
        nonEvidencePhraseCount: 0
      }
    })).rejects.toBe(unavailable);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("createImageResponseWithFallback", () => {
  it("retries once with image fallback when the preferred image model is unavailable", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce({
        status: 404,
        code: "model_not_found",
        message: "The model `gpt-image-2` does not exist"
      })
      .mockResolvedValueOnce({ data: [{ b64_json: "abc" }] });
    const client = { images: { generate } } as any;

    const result = await createImageResponseWithFallback(client, { id: "gpt-image-2", fallbackModelId: "gpt-image-1.5" }, {
      model: "gpt-image-2",
      prompt: "Draw",
      n: 1
    });

    expect(result.modelUsed).toBe("gpt-image-1.5");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1][0].model).toBe("gpt-image-1.5");
  });
});
