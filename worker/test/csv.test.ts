import { describe, expect, it } from "vitest";
import { escapeCsvCell, toCsv } from "../src/lib/csv";

describe("csv utility", () => {
  it("escapes commas, quotes, and newlines", () => {
    expect(escapeCsvCell("A,B")).toBe("\"A,B\"");
    expect(escapeCsvCell("A\"B")).toBe("\"A\"\"B\"");
    expect(escapeCsvCell("A\nB")).toBe("\"A\nB\"");
    expect(escapeCsvCell("")).toBe("");
    expect(escapeCsvCell(null)).toBe("");
  });

  it("serializes rows and keeps empty values blank", () => {
    const csv = toCsv(
      ["name", "score", "comment"],
      [
        ["Ada", 95, "Great"],
        ["Grace", null, "Missing"]
      ]
    );
    expect(csv).toBe("name,score,comment\r\nAda,95,Great\r\nGrace,,Missing\r\n");
  });
});
