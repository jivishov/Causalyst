import type { GradeFeedback, RubricCriterion } from "@alt-assessment/shared";

export function RubricFeedback({
  feedback,
  rubric,
  heading = "Provisional Feedback",
  subheading = "Automated feedback may be reviewed by your teacher."
}: {
  feedback: GradeFeedback | null;
  rubric?: RubricCriterion[];
  heading?: string;
  subheading?: string;
}) {
  if (!feedback) {
    return (
      <section className="feedback-panel">
        <h2>Rubric</h2>
        <div className="criterion-list">
          {(rubric ?? []).map((criterion) => (
            <article key={criterion.name} className="criterion-row">
              <span>{criterion.name}</span>
              <strong>{criterion.maxPoints} pts</strong>
              <p>{criterion.description}</p>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="feedback-panel">
      <div className="feedback-header">
        <div>
          <h2>{heading}</h2>
          <p>{subheading}</p>
        </div>
        <div className="score-dial" aria-label={`Score ${feedback.score} percent`}>
          {feedback.score}
        </div>
      </div>
      <p className="overall-comment">{feedback.overallComment}</p>
      <div className="criterion-list">
        {feedback.criteria.map((criterion) => (
          <article key={criterion.name} className="criterion-row">
            <span>{criterion.name}</span>
            <strong>
              {criterion.score}/{criterion.maxPoints}
            </strong>
            <p>{criterion.comment}</p>
          </article>
        ))}
      </div>
      {feedback.reviewFlags.length > 0 && (
        <div className="review-flags">
          {feedback.reviewFlags.map((flag) => (
            <span key={flag}>{flag}</span>
          ))}
        </div>
      )}
    </section>
  );
}
