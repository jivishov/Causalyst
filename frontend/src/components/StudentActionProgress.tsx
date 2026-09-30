import { LoaderCircle } from "lucide-react";
import "./StudentActionProgress.css";

export function StudentActionProgress({ active, title, message }: {
  active: boolean;
  title: string;
  message?: string;
}) {
  if (!active) return null;

  return (
    <div className="student-action-progress">
      <span className="student-action-progress-icon" aria-hidden="true">
        <LoaderCircle size={22} className="student-action-spinner" />
      </span>
      <div className="student-action-progress-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong>{title}</strong>
        <p>{message ?? "Please wait and keep this page open until the response is ready."}</p>
      </div>
      <span className="student-action-progress-badge" aria-hidden="true">Working</span>
      <div className="student-action-progress-track" role="progressbar" aria-label={title} aria-valuetext="In progress">
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
