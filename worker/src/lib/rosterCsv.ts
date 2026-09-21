export interface RosterCsvRow {
  rowNumber: number;
  displayName: string;
  studentIdentifier: string | null;
  email: string | null;
  section: string | null;
}

export interface RosterCsvError {
  rowNumber: number;
  field: "display_name" | "student_identifier" | "email" | "section" | "csv";
  message: string;
}

export interface RosterCsvParseResult {
  rows: RosterCsvRow[];
  errors: RosterCsvError[];
}

const REQUIRED_HEADER = "display_name";
const SUPPORTED_HEADERS = ["display_name", "student_identifier", "email", "section"] as const;

export function parseRosterCsv(text: string): RosterCsvParseResult {
  const table = parseCsvTable(text);
  if (table.length === 0 || table.every((row) => row.every((cell) => !cell.trim()))) {
    return {
      rows: [],
      errors: [{ rowNumber: 1, field: "csv", message: "CSV is empty" }]
    };
  }

  const header = table[0].map((cell, index) => normalizeHeader(index === 0 ? stripBom(cell) : cell));
  if (!header.includes(REQUIRED_HEADER)) {
    return {
      rows: [],
      errors: [{ rowNumber: 1, field: "display_name", message: "Missing required header: display_name" }]
    };
  }

  const columnIndex = indexHeaders(header);
  const errors: RosterCsvError[] = [];
  const rows: RosterCsvRow[] = [];

  for (let rowIndex = 1; rowIndex < table.length; rowIndex += 1) {
    const raw = table[rowIndex];
    const rowNumber = rowIndex + 1;
    if (raw.every((cell) => !cell.trim())) continue;

    const displayName = readCell(raw, columnIndex.display_name);
    const studentIdentifier = normalizeOptionalCell(readCell(raw, columnIndex.student_identifier));
    const email = normalizeEmail(readCell(raw, columnIndex.email));
    const section = normalizeOptionalCell(readCell(raw, columnIndex.section));

    if (!displayName) {
      errors.push({ rowNumber, field: "display_name", message: "display_name is required" });
      continue;
    }
    if (email && !isLikelyEmail(email)) {
      errors.push({ rowNumber, field: "email", message: "email is not a valid address" });
      continue;
    }

    rows.push({ rowNumber, displayName, studentIdentifier, email, section });
  }

  return { rows, errors };
}

function indexHeaders(header: string[]) {
  const output: Partial<Record<(typeof SUPPORTED_HEADERS)[number], number>> = {};
  for (let index = 0; index < header.length; index += 1) {
    const key = toSupportedHeader(header[index]);
    if (!key || key in output) continue;
    output[key] = index;
  }
  return output;
}

function toSupportedHeader(input: string): (typeof SUPPORTED_HEADERS)[number] | null {
  if (input === "display_name") return "display_name";
  if (input === "student_identifier" || input === "student_id") return "student_identifier";
  if (input === "email") return "email";
  if (input === "section") return "section";
  return null;
}

function readCell(row: string[], index: number | undefined): string {
  if (typeof index !== "number") return "";
  return (row[index] ?? "").trim();
}

function normalizeOptionalCell(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeEmail(value: string): string | null {
  const normalized = normalizeOptionalCell(value);
  return normalized ? normalized.toLowerCase() : null;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function stripBom(value: string): string {
  return value.replace(/^\ufeff/, "");
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseCsvTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}
