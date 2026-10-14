const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function temporaryExportParticipants(params: URLSearchParams): string[] {
  const ids = (params.get("participants") ?? "").split(",");
  return ids.length <= 40 && ids.every((id) => uuid.test(id))
    ? [...new Set(ids.map((id) => id.toLowerCase()))]
    : [];
}
/** Preserve only opaque selection metadata across website sign-in. */
export function temporaryReturnPath(
  pathname: string,
  search: string,
): string | null {
  if (pathname !== "/teacher/temporary") return null;
  const input = new URLSearchParams(search),
    output = new URLSearchParams();
  const assignment = input.get("assignment");
  if (assignment && uuid.test(assignment))
    output.set("assignment", assignment.toLowerCase());
  const participants = temporaryExportParticipants(input);
  if (participants.length) output.set("participants", participants.join(","));
  for (const flag of ["export", "earlier"])
    if (input.get(flag) === "1") output.set(flag, "1");
  return "/teacher/temporary" + (output.size ? "?" + output.toString() : "");
}
