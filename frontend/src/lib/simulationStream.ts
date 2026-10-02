import { MAX_SIMULATION_STREAM_CHARS, type SimulationHtmlStreamEvent } from "@alt-assessment/shared";

// fetch-based SSE keeps the student's bearer token out of URLs and supports
// chunk boundaries anywhere in JSON, CRLF separators, and UTF-8 characters.
export async function consumeSimulationHtmlStream(response: Response, onEvent: (event: SimulationHtmlStreamEvent) => void, signal?: AbortSignal): Promise<void> {
  if (!response.body || !response.headers.get("Content-Type")?.includes("text/event-stream")) {
    throw new Error("Live output is unavailable for this response.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      if (done || signal?.aborted) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
      // JSON escaping can expand a full reconnect snapshot up to sixfold.
      if (buffer.length > 6 * MAX_SIMULATION_STREAM_CHARS + 4096) throw new Error("Live output exceeded the display limit.");
      let boundary: number;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).replace(/^ /, "")).join("\n");
        if (!data) continue;
        const event: unknown = JSON.parse(data);
        if (!isSimulationHtmlStreamEvent(event)) throw new Error("Live output contained an invalid event.");
        onEvent(event);
      }
    }
    // An interrupted, unterminated event must be replayed from the last cursor.
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function isSimulationHtmlStreamEvent(value: unknown): value is SimulationHtmlStreamEvent {
  if (!value || typeof value !== "object" || !("type" in value)) return false;
  const event = value as Record<string, unknown>;
  if (event.type === "heartbeat" || event.type === "unavailable") return true;
  if (event.type === "html_delta" || event.type === "checkpoint" || event.type === "html_snapshot") {
    return Number.isSafeInteger(event.cursor) && Number(event.cursor) >= 0
      && (event.type === "checkpoint" || (event.type === "html_snapshot"
        ? typeof event.source === "string" && event.source.length <= MAX_SIMULATION_STREAM_CHARS
        : typeof event.delta === "string" && event.delta.length <= MAX_SIMULATION_STREAM_CHARS));
  }
  if (event.type === "job" && event.job && typeof event.job === "object") {
    const job = event.job as Record<string, unknown>;
    return typeof job.jobId === "string" && typeof job.message === "string"
      && ["queued", "in_progress", "finalizing", "completed", "failed", "incomplete", "cancelled", "expired"].includes(String(job.status));
  }
  return false;
}
