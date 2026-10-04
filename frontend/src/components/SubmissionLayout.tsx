import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, CircleAlert, FileCheck2, FileText } from "lucide-react";
import type { AssessmentType, StudentPublishedGrade } from "@alt-assessment/shared";

export type SubmissionTab = "submission" | "feedback" | "instructions";

export function SubmissionHeader({ title, type, status, submittedAt, context, attention = false }: {
  title: string;
  type: AssessmentType;
  status: string;
  submittedAt?: string | null;
  context?: string;
  attention?: boolean;
}) {
  return (
    <header className="submission-header">
      <Link className="submission-back" to="/" aria-label="Dashboard" title="Back to dashboard"><ArrowLeft size={18} /></Link>
      <div className="submission-heading">
        <h1>{title}</h1>
        <div className="submission-meta">
          <span>{type === "simulation" ? "Simulation assessment" : type === "voice" ? "Spoken assessment" : "Writing assessment"}</span>
          {context && <span>{context}</span>}
          {submittedAt && <span>Submitted <time dateTime={submittedAt}>{formatSubmissionDate(submittedAt)}</time></span>}
        </div>
      </div>
      <span className={`submission-status${attention ? " needs-attention" : ""}`}>{attention ? <CircleAlert size={13} aria-hidden="true" /> : status === "Draft" ? <FileText size={13} aria-hidden="true" /> : <Check size={13} aria-hidden="true" />}{status}</span>
    </header>
  );
}

export function SubmissionTabs({ id, value, onChange, tabs, children }: {
  id: string;
  value: SubmissionTab;
  onChange: (tab: SubmissionTab) => void;
  tabs: Array<{ value: SubmissionTab; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="submission-toolbar">
      <div className="submission-tabs" role="tablist" aria-label="Submission details">
        {tabs.map((tab, index) => (
          <button key={tab.value} type="button" role="tab" id={`${id}-tab-${tab.value}`} aria-controls={`${id}-panel-${tab.value}`} aria-selected={value === tab.value} tabIndex={value === tab.value ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={event => {
              let next: number;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              onChange(tabs[next].value);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
            }}
          >{tab.label}</button>
        ))}
      </div>
      {children}
    </div>
  );
}

export function SubmissionPanel({ id, tab, active, children }: { id: string; tab: SubmissionTab; active: SubmissionTab; children: ReactNode }) {
  return <div className="submission-tab-panel" role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} hidden={tab !== active} tabIndex={0}>{children}</div>;
}

export function PublishedGradeSummary({ grade, children }: { grade: StudentPublishedGrade; children?: ReactNode }) {
  const status = grade.finalStatus === "approved_ai" ? "Approved AI" : grade.finalStatus === "teacher_override" ? "Teacher Override" : "Missing";
  return (
    <section className={`submission-grade-summary${grade.finalStatus === "missing" ? " is-missing" : ""}`} aria-label="Published final grade">
      <div className="submission-grade-copy">
        <h2><FileCheck2 size={18} aria-hidden="true" />Published Final Grade</h2>
        <p>{status}<span aria-hidden="true"> · </span>Published <time dateTime={grade.publishedAt}>{formatSubmissionDate(grade.publishedAt)}</time></p>
        {children}
      </div>
      <div className="submission-grade-score"><span>Final score</span><strong>{grade.finalScore ?? "Not scored"}</strong></div>
    </section>
  );
}

function formatSubmissionDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}
