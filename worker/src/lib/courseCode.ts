export function normalizeCourseCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}
