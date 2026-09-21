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

export interface TeacherProfile {
  id: string;
  email: string | null;
  displayName: string;
}

export interface TeacherSetupStatusResponse {
  setupAvailable: boolean;
}

export interface TeacherSessionResponse {
  profile: TeacherProfile;
}

export interface TeacherCourse {
  id: string;
  code: string;
  name: string;
  section: string | null;
  term: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TeacherCoursesResponse {
  courses: TeacherCourse[];
}

export interface TeacherAssessment {
  id: string;
  type: AssessmentType;
  title: string;
  prompt: string;
  expectedAnswer: string | null;
  rubric: RubricCriterion[];
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface TeacherAssessmentsResponse {
  assessments: TeacherAssessment[];
}

export interface TeacherAssignment {
  id: string;
  assessmentId: string;
  classId: string;
  opensAt: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  assessment: {
    id: string;
    type: AssessmentType;
    title: string;
    archivedAt: string | null;
  };
  course: {
    id: string;
    code: string;
    name: string;
    archivedAt: string | null;
  };
}

export interface TeacherAssignmentsResponse {
  assignments: TeacherAssignment[];
}

export interface TeacherAttemptReviewArtifact {
  id: string;
  kind: "audio" | "writing" | "simulation-derived" | "simulation-sketch";
  mimeType: string;
  byteSize: number;
  originalFilename: string;
  uploadState: "pending" | "uploaded" | "processed" | "deleted";
  previewPath: string | null;
  downloadPath: string;
  htmlViewport?: SimulationHtmlViewport;
}

export interface TeacherRealtimeEvent {
  id: string;
  sessionId: string;
  sequence: number;
  eventType: string;
  role: "student" | "assistant" | "system" | "status" | null;
  text: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface TeacherRealtimeTrustHistory {
  sessionId: string;
  status: "connecting" | "active" | "finalizing" | "finalized" | "error";
  startedAt: string;
  endedAt: string | null;
  expiresAt: string | null;
  eventCount: number;
  studentTurnCount: number;
  assistantTurnCount: number;
  statusTurnCount: number;
  gapCount: number;
  duplicateCount: number;
  flags: string[];
  score: number;
}

export interface TeacherRealtimeTrust {
  score: number;
  level: "low" | "medium" | "high";
  flags: string[];
  summary: string;
  history: TeacherRealtimeTrustHistory[];
}

export interface TeacherAttemptReviewListItem {
  attemptId: string;
  assignmentId: string | null;
  assessmentId: string;
  assessmentType: AssessmentType;
  assessmentTitle: string;
  status: AttemptStatus;
  submittedAt: string | null;
  provisionalScore: number | null;
  reviewFlags: string[];
  student: {
    id: string;
    displayName: string;
  };
  course: {
    id: string;
    code: string;
    name: string;
  };
  assignment: {
    id: string | null;
    opensAt: string | null;
    dueAt: string | null;
  };
}

export interface TeacherAttemptReviewListResponse {
  attempts: TeacherAttemptReviewListItem[];
}

export interface TeacherAttemptReviewDetail {
  attemptId: string;
  assignmentId: string | null;
  status: AttemptStatus;
  submittedAt: string | null;
  provisionalScore: number | null;
  provisionalFeedback: GradeFeedback | null;
  reviewFlags: string[];
  transcript: string | null;
  ocrText: string | null;
  simulationDescription: string | null;
  simulationSpec: SimulationSpec | null;
  gradebookEntry: TeacherGradebookEntry | null;
  student: {
    id: string;
    displayName: string;
  };
  course: {
    id: string;
    code: string;
    name: string;
  };
  assignment: {
    id: string | null;
    opensAt: string | null;
    dueAt: string | null;
  };
  assessment: AssessmentSummary;
  artifacts: TeacherAttemptReviewArtifact[];
  realtimeEvents: TeacherRealtimeEvent[];
  realtimeTrust?: TeacherRealtimeTrust | null;
}

export interface TeacherAttemptReviewDetailResponse {
  attempt: TeacherAttemptReviewDetail;
}

export type TeacherGradebookFinalStatus = "teacher_override" | "approved_ai" | "missing" | "blank";

export interface TeacherGradebookEntry {
  id: string;
  assignmentId: string;
  rosterStudentId: string;
  approvedAttemptId: string | null;
  approvedScore: number | null;
  teacherOverrideScore: number | null;
  teacherOverrideNote: string | null;
  missing: boolean;
  publishedAt: string | null;
  finalScore: number | null;
  finalStatus: TeacherGradebookFinalStatus;
  createdAt: string;
  updatedAt: string;
  student: {
    id: string;
    displayName: string;
    studentIdentifier: string | null;
    email: string | null;
    section: string | null;
    active: boolean;
    claimed: boolean;
  };
  course: {
    id: string;
    code: string;
    name: string;
  };
  assignment: {
    id: string;
    opensAt: string | null;
    dueAt: string | null;
    archivedAt: string | null;
    assessmentId: string;
    assessmentType: AssessmentType;
    assessmentTitle: string;
  };
  latestAttempt: {
    attemptId: string;
    status: AttemptStatus;
    submittedAt: string | null;
    provisionalScore: number | null;
  } | null;
}

export interface TeacherGradebookListResponse {
  entries: TeacherGradebookEntry[];
}

export interface TeacherGradebookRebuildResponse {
  courseId: string;
  insertedRows: number;
  touchedAssignments: number;
  touchedStudents: number;
}

export type TeacherGradeExportFormat = "long" | "wide";
export type TeacherGradeExportMissingMode = "blank" | "zero";

export interface TeacherGradebookExportRequest {
  format: TeacherGradeExportFormat;
  courseId: string;
  assignmentIds?: string[];
  includeUnpublished?: boolean;
  missingMode?: TeacherGradeExportMissingMode;
  columns?: string[];
  columnLabels?: Record<string, string>;
  previewOnly?: boolean;
}

export interface TeacherGradebookExportResponse {
  format: TeacherGradeExportFormat;
  filename: string;
  rowCount: number;
  previewCount: number;
  columnKeys: string[];
  auditId: string | null;
  csv: string | null;
}

export interface TeacherRosterImportPreviewRow {
  rowNumber: number;
  displayName: string;
  studentIdentifier: string | null;
  email: string | null;
  section: string | null;
}

export interface TeacherRosterImportPreviewError {
  rowNumber: number;
  field: "display_name" | "student_identifier" | "email" | "section" | "csv";
  message: string;
}

export interface TeacherRosterImportPreviewResponse {
  courseId: string;
  totalRows: number;
  acceptedRows: TeacherRosterImportPreviewRow[];
  errors: TeacherRosterImportPreviewError[];
}

export interface TeacherRosterStudent {
  id: string;
  displayName: string;
  studentIdentifier: string | null;
  email: string | null;
  section: string | null;
  claimed: boolean;
  claimedBy: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export interface TeacherRosterResponse {
  courseId: string;
  students: TeacherRosterStudent[];
}

export interface TeacherRosterIssuedPin {
  rosterStudentId: string;
  displayName: string;
  studentIdentifier: string | null;
  email: string | null;
  section: string | null;
  pin: string;
}

export interface TeacherRosterImportCommitResponse {
  courseId: string;
  createdCount: number;
  pins: TeacherRosterIssuedPin[];
}

export interface TeacherRosterDeleteResponse {
  courseId: string;
  deletedRosterStudents: number;
  deletedAccessCodes: number;
  retainedClaimedStudents: number;
  confirmationPhrase: string;
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
