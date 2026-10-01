type PromptBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] };

// Format teacher-authored text without interpreting HTML or changing its words.
// Inline numbers count as a list only when they form a sequence starting at 1;
// decimal quantities, subshell names, and isolated numbers stay in the prose.
function promptBlocks(text: string): PromptBlock[] {
  const paragraphs = text.replace(/\r\n?/g, "\n")
    .replace(/[ \t]+(?=(?:Stimulus paragraph|Your description must explicitly include|Important):)/g, "\n\n")
    .split(/\n\s*\n/).filter((part) => part.trim());
  return paragraphs.flatMap((paragraph): PromptBlock[] => {
    const bullets = [...paragraph.matchAll(/(?:^|\s)•\s+/g)];
    if (bullets.length >= 2 || (bullets.length === 1 && /^\s*•\s+/.test(paragraph))) {
      const intro = paragraph.slice(0, bullets[0].index).trim();
      const items = bullets.map((marker, index) => paragraph.slice(marker.index! + marker[0].length, bullets[index + 1]?.index ?? paragraph.length).trim());
      return [
        ...(intro.trim() ? [{ kind: "paragraph" as const, text: intro.trim() }] : []),
        { kind: "list", ordered: false, items }
      ];
    }
    const lines = paragraph.split("\n");
    const firstBullet = lines.findIndex((line) => /^\s*[-*]\s+\S/.test(line));
    if (firstBullet !== -1 && lines.slice(firstBullet).every((line) => /^\s*[-*]\s+\S/.test(line))) {
      const intro = lines.slice(0, firstBullet).join("\n").trim();
      return [
        ...(intro ? [{ kind: "paragraph" as const, text: intro }] : []),
        { kind: "list", ordered: false, items: lines.slice(firstBullet).map((line) => line.replace(/^\s*[-*]\s+/, "")) }
      ];
    }
    const markers = [...paragraph.matchAll(/(?:^|\s)(\d{1,2})\.\s+/g)];
    if (markers.length >= 2 && markers.every((marker, index) => Number(marker[1]) === index + 1)) {
      const intro = paragraph.slice(0, markers[0].index).trim();
      return [
        ...(intro ? [{ kind: "paragraph" as const, text: intro }] : []),
        { kind: "list", ordered: true, items: markers.map((marker, index) => paragraph.slice(marker.index! + marker[0].length, markers[index + 1]?.index ?? paragraph.length).trim()) }
      ];
    }
    return [{ kind: "paragraph", text: paragraph.trim() }];
  });
}

function LabeledText({ text }: { text: string }) {
  // Emphasize a short leading label, never chemistry expressions or long prose.
  const label = text.match(/^([^:\n]{2,38}:)(\s|$)/);
  return label ? <><strong>{label[1]}</strong>{text.slice(label[1].length)}</> : <>{text}</>;
}

export function AssignmentPrompt({ text }: { text: string }) {
  return (
    <div className="assignment-prompt" aria-label="Assignment instructions">
      {promptBlocks(text).map((block, index) => {
        if (block.kind === "paragraph") {
          return <p key={index} className={block.text.startsWith("Important:") ? "assignment-prompt-note" : undefined}><LabeledText text={block.text} /></p>;
        }
        const List = block.ordered ? "ol" : "ul";
        return <List key={index} className="assignment-prompt-list">{block.items.map((item, itemIndex) => <li key={itemIndex}><LabeledText text={item} /></li>)}</List>;
      })}
    </div>
  );
}
