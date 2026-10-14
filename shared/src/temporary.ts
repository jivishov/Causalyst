/** Public, versioned wire contract. Content is never a database row projection. */
export const TEMPORARY_CONTRACT = "explain-temporary-v1" as const;
export const TEMPORARY_LIMITS = Object.freeze({
  responseBytes: 32_000,
  sourceBytes: 500_000,
  bundleBytes: 750_000,
  participants: 40,
  revisions: 6,
  storedBytes: 40_000_000,
  exportBytes: 40_000_000,
  batch: 3,
  leaseSeconds: 900,
  attempts: 3,
});
export type TemporaryErrorCode =
  | "ACCESS_REVOKED"
  | "NOT_FOUND"
  | "ASSIGNMENT_CLOSED"
  | "ASSIGNMENT_EXPIRED"
  | "REVISION_CONFLICT"
  | "LEASE_EXPIRED"
  | "VALIDATION_FAILED"
  | "QUOTA_EXCEEDED"
  | "RATE_LIMITED"
  | "UNAVAILABLE";
export interface TemporaryAssignment {
  id: string;
  publicId: string;
  assessmentId: string;
  publishedAt: string;
  closesAt: string;
  expiresAt: string;
}
export interface TemporaryQuestion {
  title: string;
  prompt: string;
  rubric: unknown[];
}
export interface TemporaryGenerationContext {
  contract: typeof TEMPORARY_CONTRACT;
  system: string;
  userTemplate: string;
  promptVersion: string;
}
export interface TemporaryRevision {
  id: string;
  participantId: string;
  code: string;
  revision: number;
  submittedAt: string | null;
  status: "draft" | "queued" | "processing" | "ready" | "failed";
  artifactId: string | null;
  gradeId: string | null;
  gradeVersion?: number;
}
export interface TemporaryReport {
  assignment: TemporaryAssignment;
  question: TemporaryQuestion;
  revision: TemporaryRevision;
  response: string;
  simulation: {
    html: string;
    generatedAt: string;
    model: string | null;
    client: string | null;
    assumptions: string[];
  } | null;
  grade: {
    score: number;
    comment: string;
    gradedAt: string;
    evidenceArtifactId?: string | null;
  } | null;
}
export interface GuestState {
  assignment: TemporaryAssignment;
  question: TemporaryQuestion;
  code: string;
  draft: string;
  draftVersion: number;
  latest: TemporaryRevision | null;
  simulation: TemporaryReport["simulation"];
  csrf: string;
}
