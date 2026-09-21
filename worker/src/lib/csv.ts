export type CsvCell = string | number | boolean | null | undefined;

export function toCsvRow(values: CsvCell[]): string {
  return values.map(escapeCsvCell).join(",");
}

export function toCsv(columns: string[], rows: CsvCell[][]): string {
  const lines = [toCsvRow(columns)];
  for (const row of rows) {
    lines.push(toCsvRow(row));
  }
  return `${lines.join("\r\n")}\r\n`;
}

export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (text === "") return "";

  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!/[",\n]/.test(normalized)) return normalized;
  return `"${normalized.replace(/"/g, "\"\"")}"`;
}
