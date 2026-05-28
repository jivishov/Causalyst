export type AssessmentType = "voice" | "voice_realtime" | "writing" | "simulation";

export type AttemptStatus = "draft" | "submitted" | "graded" | "error";

export interface SourceSpan {
  quote: string;
  start: number;
  end: number;
}

export interface RubricCriterion {
  name: string;
  maxPoints: number;
  description: string;
}

export interface RubricScore {
  name: string;
  score: number;
  maxPoints: number;
  comment: string;
}

export interface GradeFeedback {
  score: number;
  overallComment: string;
  criteria: RubricScore[];
  confidence: "low" | "medium" | "high";
  reviewFlags: string[];
}

export interface AssessmentSummary {
  id: string;
  type: AssessmentType;
  title: string;
  prompt: string;
  expectedAnswer?: string | null;
  rubric: RubricCriterion[];
  config: Record<string, unknown>;
  dueAt?: string | null;
}

export type StudentAssignmentState =
  | "not_started"
  | "draft"
  | "submitted"
  | "provisional_ready"
  | "final_published"
  | "error_retry";

export type StudentDueState = "none" | "due_soon" | "overdue" | "late_submitted";

export interface StudentAttemptSummary {
  attemptId: string;
  status: AttemptStatus;
  submittedAt: string | null;
  provisionalScore: number | null;
  submittedAfterDue?: boolean;
}

export interface StudentPublishedGrade {
  finalScore: number | null;
  finalStatus: "approved_ai" | "teacher_override" | "missing";
  publishedAt: string;
  feedback?: GradeFeedback | null;
}

export const SIMULATION_HTML_REASONING_EFFORTS = ["low", "medium", "high"] as const;

export type SimulationHtmlReasoningEffort = typeof SIMULATION_HTML_REASONING_EFFORTS[number];

export const DEFAULT_SIMULATION_HTML_REASONING_EFFORT: SimulationHtmlReasoningEffort = "medium";

export interface SimulationHtmlViewport {
  width: number;
  height: number;
}

export interface StudentSimulationPreview {
  artifactId: string;
  previewPath: string;
  previewToken: string;
  outputKind: "html" | "image";
  generationSource?: "model" | "structured_fallback";
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  htmlViewport?: SimulationHtmlViewport;
}

export type StudentSimulationGenerationJobOperation = "generate" | "refine";

export type StudentSimulationGenerationJobStatus =
  | "queued"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "failed"
  | "incomplete"
  | "cancelled"
  | "expired";

export interface StudentSimulationGenerationJob {
  jobId: string;
  operation: StudentSimulationGenerationJobOperation;
  status: StudentSimulationGenerationJobStatus;
  startedAt: string;
  expiresAt: string;
  message: string;
  requestedModel?: string;
  modelUsed?: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  preview?: StudentSimulationPreview;
  errorMessage?: string;
}

export type StudentLifecycleErrorCode =
  | "same_course_identity_conflict"
  | "roster_email_required"
  | "roster_email_mismatch"
  | "student_login_unavailable"
  | "attempt_lifecycle_migration_required"
  | "already_submitted"
  | "final_published"
  | "final_required";

export interface StudentAssignmentSummary {
  assignmentId: string;
  classId: string;
  classCode: string;
  className: string;
  opensAt: string | null;
  dueAt: string | null;
  state?: StudentAssignmentState;
  dueState?: StudentDueState;
  latestAttempt?: StudentAttemptSummary | null;
  publishedGrade?: StudentPublishedGrade | null;
  simulationPreview?: StudentSimulationPreview | null;
  assessment: AssessmentSummary;
}

export interface StudentCourseAssignments {
  classId: string;
  classCode: string;
  className: string;
  assignments: StudentAssignmentSummary[];
}

export type StudentEnrollmentStatus =
  | "matched"
  | "no_roster_match"
  | "claimed_by_other"
  | "teacher_profile"
  | "identity_conflict";

export interface StudentSessionResponse {
  profile: {
    id: string;
    displayName: string;
    email?: string;
    className?: string;
    classCode?: string;
  } | null;
  courses: StudentCourseAssignments[];
  enrollmentStatus: StudentEnrollmentStatus;
}

export interface AttemptResult {
  attemptId: string;
  assignmentId: string | null;
  assessment: AssessmentSummary;
  status: AttemptStatus;
  provisionalScore: number | null;
  provisionalFeedback: GradeFeedback | null;
  transcript: string | null;
  ocrText: string | null;
  simulationSpec: SimulationSpec | null;
  simulationPreview?: StudentSimulationPreview | null;
  simulationSketchPreview?: StudentSimulationPreview | null;
  publishedGrade?: StudentPublishedGrade | null;
  submittedAt: string | null;
}

export interface StudentPublishedFinalResultResponse {
  assignmentId: string;
  classId: string;
  classCode: string;
  className: string;
  opensAt: string | null;
  dueAt: string | null;
  assessment: AssessmentSummary;
  publishedGrade: StudentPublishedGrade;
  latestAttempt?: StudentAttemptSummary | null;
}

export interface SimulationSpec {
  title: string;
  descriptionSummary: string;
  entities: SimulationEntity[];
  labels: SimulationLabel[];
  positions: SimulationPosition[];
  movements: SimulationMovement[];
  interactions: SimulationInteraction[];
  stateChanges: SimulationStateChange[];
  timelineSteps: SimulationTimelineStep[];
}

export interface SimulationEntity {
  id: string;
  kind: "entity";
  name: string;
  shape: "circle" | "square" | "triangle" | "line" | "cell" | "compound" | "custom";
  color: string;
  source: SourceSpan;
}

export interface SimulationLabel {
  id: string;
  kind: "label";
  entityId: string | null;
  text: string;
  source: SourceSpan;
}

export interface SimulationPosition {
  id: string;
  kind: "position";
  entityId: string;
  x: number;
  y: number;
  source: SourceSpan;
}

export interface SimulationMovement {
  id: string;
  kind: "movement";
  entityId: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  durationMs: number;
  source: SourceSpan;
}

export interface SimulationInteraction {
  id: string;
  kind: "interaction";
  actorEntityId: string;
  targetEntityId: string;
  action: string;
  source: SourceSpan;
}

export interface SimulationStateChange {
  id: string;
  kind: "stateChange";
  entityId: string;
  property: string;
  from: string;
  to: string;
  source: SourceSpan;
}

export interface SimulationTimelineStep {
  id: string;
  kind: "timelineStep";
  order: number;
  text: string;
  source: SourceSpan;
}
