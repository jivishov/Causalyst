# Teacher evaluation gate

Technical checks do not establish grading accuracy. Before classroom deployment, agree the sample size and acceptable error with the teacher and fill `teacher-review-template.json` using independently teacher-scored examples.

Each case needs a synthetic `id`, `modality`, `teacherReviewed: true`, `teacherScore` (0–100), `modelScore` (0–100), and explicit booleans `unsupportedEvidence` and `policyViolation`. Retain the frozen assessment version and provider model in the restricted evaluation record. Do not commit student names, recordings, handwriting, or answer keys here.

Cover correct and incorrect answers, incomplete scaffolds, each configured score cap, unclear handwriting, missing pages, empty audio, interrupted speech, and instructions embedded in student work. Review evidence fidelity as well as score agreement. Evaluate live voice separately from recorded audio; a provider transcript establishes captured words, not speaker identity or independent work.

Run `node scripts/evaluate-grades.mjs /path/to/teacher-reviewed-results.json`. The harness refuses missing thresholds and unreviewed or empty datasets, reports mean and maximum absolute score error, and fails on any marked unsupported evidence or policy violation. The template contains no fabricated results. No model-quality evaluation has been performed by the implementation tests.
