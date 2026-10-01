import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssignmentPrompt } from "../src/components/AssignmentPrompt";

const render = (text: string) => renderToStaticMarkup(<AssignmentPrompt text={text} />);

describe("assignment instruction formatting", () => {
  it("preserves chemical notation, decimals, hard line breaks and isolated numbers", () => {
    const source = "Use 1.5 mol of NaCl and describe 1s, 2s, 2p.\nAnswer question 2. Explain the 10–20 electron species.";
    const html = render(source);
    expect(html).toContain(source);
    expect(html).not.toContain("<li");
  });

  it("shows every inline requirement and separates the important instruction", () => {
    const html = render("Choose a species. Your description must explicitly include: • its electrons; • its ground-state configuration. Important: use energy levels and electron–nucleus attraction.");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain("its electrons;");
    expect(html).toContain("its ground-state configuration.");
    expect(html).toContain('class="assignment-prompt-note"');
    expect(html).toContain("use energy levels and electron–nucleus attraction.");
  });

  it("formats sequential numbered tasks while retaining the intro and final guidance", () => {
    const html = render("Complete each section. 1. Main finding: State the finding. 2. Evidence: List two details. 3. Final question: Revise it. Do not omit the comparison.");
    expect(html).toContain("<ol");
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toContain("Complete each section.");
    expect(html).toContain("<strong>Main finding:</strong>");
    expect(html).toContain("Do not omit the comparison.");
  });

  it("supports line-based bullet lists without losing the preceding text", () => {
    const html = render("Include these details:\n- System/population\n- Measurable outcome");
    expect(html).toContain("<ul");
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain("System/population");
    expect(html).toContain("Measurable outcome");
    expect(html).toContain("Include these details:");
  });

  it("keeps prose containing nonsequential numbers or a dot product as prose", () => {
    const html = render("See example 1. Compare sample 3. Explain E • B.");
    expect(html).not.toContain("<li");
    expect(html).toContain("See example 1. Compare sample 3. Explain E • B.");
  });

  it("renders teacher-supplied markup as text", () => {
    const html = render('<script>alert("x")</script>\n<img src=x onerror=alert(1)>');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });
});
