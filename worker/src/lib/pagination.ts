import { HttpError } from "./http";

type PageResult = { data: unknown[] | null; error: { message?: string } | null; count?: number | null };
type PageQuery = PromiseLike<PageResult> & {
  order(column: string, options: { ascending: boolean }): PageQuery;
  range(from: number, to: number): PageQuery;
};

/** Continue to an empty page, not a short page: PostgREST may cap below the
 * requested size. Add a unique tie-breaker and reject count drift on export. */
export async function readAllPages(query: unknown): Promise<PageResult> {
  const ordered = (query as PageQuery).order("id", { ascending: true });
  const rows: unknown[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  while (true) {
    const page = await ordered.range(rows.length, rows.length + 199);
    if (page.error) return { data: null, error: page.error };
    if (page.count != null) {
      if (expected !== null && expected !== page.count) throw new HttpError(409, "Records changed while loading; refresh and try again");
      expected = page.count;
    }
    if (!page.data?.length) break;
    for (const row of page.data) {
      const id = (row as { id?: string }).id;
      if (id && seen.has(id)) throw new HttpError(409, "Records changed while loading; refresh and try again");
      if (id) seen.add(id);
      rows.push(row);
    }
    if (rows.length > 100000) throw new HttpError(413, "Result exceeds the export limit; select a single assignment");
  }
  if (expected !== null && rows.length !== expected) throw new HttpError(409, "Incomplete result; refresh and try again");
  return { data: rows, error: null, count: rows.length };
}

export async function readAllForIds(ids: string[], build: (ids: string[]) => unknown): Promise<PageResult> {
  const rows: unknown[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const page = await readAllPages(build(ids.slice(offset, offset + 100)));
    if (page.error) return page;
    rows.push(...(page.data ?? []));
    if (rows.length > 100000) throw new HttpError(413, "Result exceeds the export limit; select a single assignment");
  }
  return { data: rows, error: null, count: rows.length };
}
