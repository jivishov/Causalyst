const formatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short"
});

export function ReviewTimestamp({ value, empty = "Unavailable" }: { value?: string | null; empty?: string }) {
  const date = value ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return <span className="review-timestamp">{empty}</span>;
  return <time className="review-timestamp" dateTime={date.toISOString()} title={date.toISOString()}>{formatter.format(date)}</time>;
}
