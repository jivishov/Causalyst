import { z } from "zod";
import {
  TEMPORARY_CONTRACT,
  TEMPORARY_LIMITS,
  type TemporaryAssignment,
  type TemporaryReport,
  type TemporaryRevision,
} from "@alt-assessment/shared";
import type { AppDatabaseClient, Json } from "./database";
import { toJson } from "./database";
import type { AuthContext } from "./auth";
import type { Env } from "./env";
import { HttpError } from "./http";
import {
  loadTeacherPromptContext,
  resolvePromptContext,
  promptRevision,
} from "./aiPrompts";
import { listTeacherAssessments } from "../routes/teacherAssessments";
import { prepareTemporarySimulationHtml } from "./temporarySimulation";

export type TemporaryFunctions = {
  temporary_command: {
    Args: {
      p_op: string;
      p_actor: string | null;
      p_connection: string | null;
      p_input: Json;
    };
    Returns: Json;
  };
  teacher_admission: {
    Args: { p_user: string; p_session: string };
    Returns: Json;
  };
};
type Row = { [key: string]: Json | undefined };
const object = (value: Json | undefined): Row => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
};
const rows = (value: Json | undefined): Row[] =>
  Array.isArray(value) ? value.map(object) : [];
const str = (r: Row, k: string): string =>
  typeof r[k] === "string" ? r[k] : "";
const num = (r: Row, k: string): number =>
  typeof r[k] === "number" ? r[k] : 0;
const bucket = "temporary-evidence";
const errorCodes = new Set([
  "ACCESS_REVOKED",
  "NOT_FOUND",
  "ASSIGNMENT_CLOSED",
  "ASSIGNMENT_EXPIRED",
  "REVISION_CONFLICT",
  "LEASE_EXPIRED",
  "VALIDATION_FAILED",
  "QUOTA_EXCEEDED",
  "RATE_LIMITED",
]);
export function temporaryFailure(code: string): HttpError {
  const safe = errorCodes.has(code) ? code : "UNAVAILABLE";
  return new HttpError(
    safe === "NOT_FOUND"
      ? 404
      : safe === "ACCESS_REVOKED"
        ? 403
        : safe === "RATE_LIMITED"
          ? 429
          : safe === "UNAVAILABLE"
            ? 503
            : 409,
    safe.replaceAll("_", " "),
    undefined,
    safe,
  );
}
export async function command(
  db: AppDatabaseClient,
  op: string,
  actor: string | null,
  connection: string | null,
  input: unknown = {},
): Promise<Row> {
  const { data, error } = await db.rpc("temporary_command", {
    p_op: op,
    p_actor: actor,
    p_connection: connection,
    p_input: toJson(input),
  });
  if (error)
    throw temporaryFailure(
      errorCodes.has(error.message) ? error.message : "UNAVAILABLE",
    );
  return object(data);
}
export async function admitTeacher(
  db: AppDatabaseClient,
  auth: AuthContext,
): Promise<void> {
  if (!auth.sessionId) throw temporaryFailure("ACCESS_REVOKED");
  const { error } = await db.rpc("teacher_admission", {
    p_user: auth.userId,
    p_session: auth.sessionId,
  });
  if (error) throw temporaryFailure(error.message);
}
export function randomCapability(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function digest(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
}
export function assignment(r: Row): TemporaryAssignment {
  return {
    id: str(r, "id"),
    publicId: str(r, "public_id"),
    assessmentId: str(r, "assessment_id"),
    publishedAt: str(r, "published_at"),
    closesAt: str(r, "closes_at"),
    expiresAt: str(r, "expires_at"),
  };
}
function revision(
  r: Row,
  j: Row,
  code: string,
  gradeId: string | null = null,
): TemporaryRevision {
  const status = ["queued", "processing", "ready", "failed"].includes(
    str(j, "status"),
  )
    ? (str(j, "status") as TemporaryRevision["status"])
    : "queued";
  return {
    id: str(r, "id"),
    participantId: str(r, "participant_id"),
    code,
    revision: num(r, "revision"),
    submittedAt: str(r, "submitted_at") || null,
    status,
    artifactId: str(j, "artifact_id") || null,
    gradeId,
  };
}
function objectPath(a: string, id: string): string {
  return `${a}/${id}.json`;
}
export async function stage(
  db: AppDatabaseClient,
  actor: string | null,
  connection: string | null,
  assignmentId: string,
  kind: string,
  content: unknown,
): Promise<Row> {
  const text = JSON.stringify(content),
    bytes = new TextEncoder().encode(text).byteLength;
  const o = await command(db, "stage", actor, connection, {
    assignmentId,
    kind,
    bytes,
    digest: await digest(text),
  });
  const { error } = await db.storage
    .from(bucket)
    .upload(objectPath(str(o, "assignment_id"), str(o, "id")), text, {
      contentType: "application/json",
      upsert: false,
      cacheControl: "0",
    });
  if (error) throw temporaryFailure("UNAVAILABLE"); // The inventory survives failed uploads and is swept.
  return o;
}
export async function stored(
  db: AppDatabaseClient,
  assignmentId: string,
  id: string,
): Promise<Json> {
  if (!id) return null;
  const { data, error } = await db.storage
    .from(bucket)
    .download(objectPath(assignmentId, id));
  if (error || !data || data.size > TEMPORARY_LIMITS.bundleBytes)
    throw temporaryFailure("UNAVAILABLE");
  const integrity = await command(db, "cleanup_integrity", null, null, {
      assignmentId,
      objectId: id,
    }),
    text = await data.text();
  if (
    data.size !== num(integrity, "bytes") ||
    (await digest(text)) !== str(integrity, "digest")
  )
    throw temporaryFailure("UNAVAILABLE");
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw temporaryFailure("UNAVAILABLE");
  }
}
export async function capabilities(db: AppDatabaseClient, auth: AuthContext) {
  const c = await command(
    db,
    "capabilities",
    auth.userId,
    auth.sessionId ?? null,
  );
  return {
    contract: TEMPORARY_CONTRACT,
    executionMode: "teacher_client",
    ...c,
    limits: {
      ...TEMPORARY_LIMITS,
      participants: num(c, "participantLimit"),
      revisions: num(c, "revisionLimit"),
      storedBytes: num(c, "storedByteLimit"),
      activeJobs: num(c, "activeJobLimit"),
    },
    retentionHours: [24, 48, 72].filter((n) => n <= num(c, "maxHours")),
    processing:
      "Teacher initiated; keep the connected client open. No provider fallback.",
    operations: [
      "publish_temporary_assignment",
      "list_temporary_submissions",
      "claim_generation_batch",
      "renew_generation_claim",
      "release_generation_claim",
      "retry_temporary_generation",
      "save_simulation_result",
      "read_temporary_submission",
      "save_temporary_grade",
      "prepare_evidence_export",
    ],
  };
}
export const publishSchema = z
  .object({
    assessmentId: z.string().uuid(),
    hours: z.union([z.literal(24), z.literal(48), z.literal(72)]),
    closesAt: z.string().datetime({ offset: true }),
    key: z.string().uuid(),
  })
  .strict();
export async function publishTemporary(
  db: AppDatabaseClient,
  auth: AuthContext,
  input: z.infer<typeof publishSchema>,
) {
  const accepted = await command(
    db,
    "publish_status",
    auth.userId,
    auth.sessionId ?? null,
    input,
  );
  if (str(accepted, "snapshot_id")) return assignment(accepted);
  const source = (
    await listTeacherAssessments(db, auth.userId, false)
  ).assessments.find(
    (a) => a.id === input.assessmentId && a.type === "simulation",
  );
  if (!source) throw temporaryFailure("NOT_FOUND");
  const a = await command(db, "publish", auth.userId, auth.sessionId ?? null, {
    ...input,
    sourceUpdatedAt: source.updatedAt,
  });
  if (str(a, "snapshot_id")) return assignment(a);
  const prompts = await loadTeacherPromptContext(
    db,
    auth.userId,
    "simulation",
    source.id,
    null,
  );
  const pair = resolvePromptContext(prompts, "assessment", source.id).prompts
    .simulationHtml;
  if (!pair) throw temporaryFailure("UNAVAILABLE");
  const question = await stage(
    db,
    auth.userId,
    auth.sessionId ?? null,
    str(a, "id"),
    "question",
    { title: source.title, prompt: source.prompt, rubric: source.rubric },
  );
  const context = await stage(
    db,
    auth.userId,
    auth.sessionId ?? null,
    str(a, "id"),
    "context",
    {
      contract: TEMPORARY_CONTRACT,
      system: pair.system,
      userTemplate: pair.user,
      promptVersion: promptRevision(prompts),
    },
  );
  return assignment(
    await command(db, "publish_commit", auth.userId, auth.sessionId ?? null, {
      assignmentId: str(a, "id"),
      questionId: str(question, "id"),
      contextId: str(context, "id"),
    }),
  );
}
export async function listTemporary(db: AppDatabaseClient, auth: AuthContext) {
  const r = await command(db, "list", auth.userId, auth.sessionId ?? null);
  return { assignments: rows(r.assignments).map(assignment) };
}
export async function temporaryDetail(
  db: AppDatabaseClient,
  auth: AuthContext,
  assignmentId: string,
) {
  const r = await command(db, "detail", auth.userId, auth.sessionId ?? null, {
    assignmentId,
  });
  return {
    assignment: assignment(object(r.assignment)),
    participants: rows(r.participants),
    revisions: r.revisions ?? [],
  };
}
export async function distribute(
  db: AppDatabaseClient,
  auth: AuthContext,
  assignmentId: string,
  count: number,
  site: string,
) {
  const detail = await temporaryDetail(db, auth, assignmentId);
  const links = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const token = randomCapability(),
        id = crypto.randomUUID(),
        suffix = id.slice(0, 4).toUpperCase();
      return {
        id,
        code: `P${String(detail.participants.length + i + 1).padStart(2, "0")}-${suffix}`,
        token,
        tokenHash: await digest(token),
      };
    }),
  );
  await command(db, "participants", auth.userId, auth.sessionId ?? null, {
    assignmentId,
    participants: links.map(({ token, ...p }) => p),
  });
  return {
    links: links.map(({ id, code, token }) => ({
      id,
      code,
      url: `${site}/s/${detail.assignment.publicId}#${token}`,
    })),
  };
}
export async function reissue(
  db: AppDatabaseClient,
  auth: AuthContext,
  assignmentId: string,
  participantId: string,
  site: string,
) {
  const token = randomCapability();
  const r = await command(db, "reissue", auth.userId, auth.sessionId ?? null, {
    assignmentId,
    participantId,
    tokenHash: await digest(token),
  });
  const a = (await temporaryDetail(db, auth, assignmentId)).assignment;
  return {
    id: str(r, "id"),
    code: str(r, "code"),
    url: `${site}/s/${a.publicId}#${token}`,
  };
}
export async function guestState(
  db: AppDatabaseClient,
  sessionHash: string,
  publicId?: string,
) {
  const r = await command(
      db,
      "guest",
      null,
      sessionHash,
      publicId ? { publicId } : {},
    ),
    a = object(r.assignment),
    p = object(r.participant),
    j = object(r.job),
    response = object(r.response);
  const question = await stored(db, str(a, "id"), str(a, "snapshot_id"));
  const draft = object(await stored(db, str(a, "id"), str(p, "draft_id")));
  const previous = object(
    await stored(db, str(a, "id"), str(response, "response_id")),
  );
  const simulation = await stored(db, str(a, "id"), str(j, "artifact_id"));
  await command(db, "guest", null, sessionHash); // Recheck expiry after object reads.
  return {
    assignment: assignment(a),
    question,
    code: str(p, "code"),
    draft: str(p, "draft_id") ? str(draft, "text") : str(previous, "text"),
    draftVersion: num(p, "draft_version"),
    latest: str(response, "id") ? revision(response, j, str(p, "code")) : null,
    simulation,
  };
}
export async function saveGuest(
  db: AppDatabaseClient,
  sessionHash: string,
  input: {
    text: string;
    expectedVersion: number;
    key: string;
    submit: boolean;
  },
  publicId?: string,
) {
  if (
    new TextEncoder().encode(input.text).byteLength >
      TEMPORARY_LIMITS.responseBytes ||
    (input.submit && !input.text.trim())
  )
    throw temporaryFailure("VALIDATION_FAILED");
  const identity = await digest(JSON.stringify({ text: input.text }));
  const state = await command(
      db,
      input.submit ? "submit_status" : "guest",
      null,
      sessionHash,
      { ...(publicId ? { publicId } : {}), key: input.key, identity },
    ),
    a = object(state.assignment);
  if (input.submit && str(object(state.response), "id"))
    return object(state.response);
  const o = await stage(
    db,
    null,
    sessionHash,
    str(a, "id"),
    input.submit ? "response" : "draft",
    { text: input.text },
  );
  let contextId: string | undefined;
  if (input.submit) {
    const prompts = await loadTeacherPromptContext(
      db,
      str(a, "teacher_id"),
      "simulation",
      str(a, "assessment_id"),
      null,
    );
    const pair = resolvePromptContext(
      prompts,
      "assessment",
      str(a, "assessment_id"),
    ).prompts.simulationHtml;
    if (!pair) throw temporaryFailure("UNAVAILABLE");
    const c = await stage(db, null, sessionHash, str(a, "id"), "context", {
      contract: TEMPORARY_CONTRACT,
      system: pair.system,
      userTemplate: pair.user,
      promptVersion: promptRevision(prompts),
    });
    contextId = str(c, "id");
  }
  return command(db, input.submit ? "submit" : "draft", null, sessionHash, {
    expectedVersion: input.expectedVersion,
    key: input.key,
    identity,
    objectId: str(o, "id"),
    contextId,
  });
}
export async function claim(
  db: AppDatabaseClient,
  auth: AuthContext,
  input: { assignmentId: string; key: string; limit: number },
) {
  const r = await command(
      db,
      "claim",
      auth.userId,
      auth.sessionId ?? null,
      input,
    ),
    a = object(r.assignment),
    jobs = [];
  for (const j of rows(r.jobs)) {
    const e = await command(
        db,
        "evidence",
        auth.userId,
        auth.sessionId ?? null,
        { assignmentId: input.assignmentId, responseId: str(j, "response_id") },
      ),
      response = object(e.response);
    jobs.push({
      jobId: str(j, "id"),
      responseId: str(j, "response_id"),
      fence: num(j, "fence"),
      leaseUntil: str(j, "lease_until"),
      generationVersion: num(j, "generation_version"),
      response: await stored(
        db,
        input.assignmentId,
        str(response, "response_id"),
      ),
      question: await stored(db, input.assignmentId, str(a, "snapshot_id")),
      generationContext: await stored(
        db,
        input.assignmentId,
        str(j, "context_id"),
      ),
      contract: TEMPORARY_CONTRACT,
    });
  }
  await command(db, "detail", auth.userId, auth.sessionId ?? null, {
    assignmentId: input.assignmentId,
  });
  return { jobs }; // Explicit allowlist: no provider settings, credentials or storage IDs.
}
export const resultSchema = z
  .object({
    assignmentId: z.string().uuid(),
    responseId: z.string().uuid(),
    jobId: z.string().uuid(),
    fence: z.number().int().positive(),
    contract: z.literal(TEMPORARY_CONTRACT),
    html: z.string().min(1).max(TEMPORARY_LIMITS.sourceBytes),
    model: z.string().max(100).nullable().default(null),
    client: z.string().max(100).nullable().default(null),
    assumptions: z.array(z.string().max(1000)).max(20).default([]),
  })
  .strict();
export async function saveResult(
  db: AppDatabaseClient,
  auth: AuthContext,
  input: z.infer<typeof resultSchema>,
) {
  // Identity follows the submitted source, independent of future runtime transforms.
  const e = await command(
      db,
      "evidence",
      auth.userId,
      auth.sessionId ?? null,
      input,
    ),
    j = object(e.job);
  const reported = {
    model: input.model,
    client: input.client,
    assumptions: input.assumptions,
  };
  const identity = await digest(
    JSON.stringify({
      contract: input.contract,
      source: input.html,
      ...reported,
    }),
  );
  const commit = {
    assignmentId: input.assignmentId,
    responseId: input.responseId,
    jobId: input.jobId,
    fence: input.fence,
    identity,
  };
  if (str(j, "status") === "ready")
    return command(db, "result", auth.userId, auth.sessionId ?? null, commit);
  const html = prepareTemporarySimulationHtml(input.html);
  const o = await stage(
    db,
    auth.userId,
    auth.sessionId ?? null,
    input.assignmentId,
    "simulation",
    { html, ...reported, generatedAt: new Date().toISOString() },
  );
  // Identity and stored-byte digest are separate, both kept server-side.
  return command(db, "result", auth.userId, auth.sessionId ?? null, {
    ...commit,
    objectId: str(o, "id"),
    digest: str(o, "digest"),
  });
}
const questionSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  rubric: z.array(z.unknown()),
});
const simulationSchema = z.object({
  html: z.string(),
  generatedAt: z.string(),
  model: z.string().nullable(),
  client: z.string().nullable(),
  assumptions: z.array(z.string()),
});
const gradeSchema = z.object({
  score: z.number().min(0).max(100),
  comment: z.string(),
  gradedAt: z.string(),
});
export async function evidence(
  db: AppDatabaseClient,
  auth: AuthContext,
  input: {
    assignmentId: string;
    responseId: string;
    artifactId?: string | null;
    gradeId?: string | null;
  },
): Promise<TemporaryReport> {
  const e = await command(
      db,
      "evidence",
      auth.userId,
      auth.sessionId ?? null,
      input,
    ),
    a = object(e.assignment),
    r = object(e.response),
    j = object(e.job),
    g = object(e.grade);
  const aid = str(a, "id"),
    artifactId =
      "artifactId" in input ? input.artifactId : str(j, "artifact_id");
  const report: TemporaryReport = {
    assignment: assignment(a),
    question: questionSchema.parse(
      await stored(db, aid, str(a, "snapshot_id")),
    ),
    revision: revision(r, j, str(e, "code"), str(g, "id") || null),
    response: str(object(await stored(db, aid, str(r, "response_id"))), "text"),
    simulation: artifactId
      ? simulationSchema.parse(await stored(db, aid, artifactId))
      : null,
    grade: str(g, "object_id")
      ? gradeSchema.parse(await stored(db, aid, str(g, "object_id")))
      : null,
  };
  report.revision.gradeVersion = num(g, "revision");
  report.revision.artifactId = artifactId || null;
  if (report.grade)
    report.grade.evidenceArtifactId = str(g, "artifact_id") || null;
  await command(db, "evidence", auth.userId, auth.sessionId ?? null, input);
  return report;
}
export async function saveGrade(
  db: AppDatabaseClient,
  auth: AuthContext,
  input: {
    assignmentId: string;
    responseId: string;
    artifactId: string | null;
    score: number;
    comment: string;
    expectedGradeVersion: number;
    key: string;
    approved: boolean;
  },
) {
  if (!input.approved) throw temporaryFailure("VALIDATION_FAILED");
  const identity = await digest(
    JSON.stringify({
      artifactId: input.artifactId,
      score: input.score,
      comment: input.comment,
      expectedGradeVersion: input.expectedGradeVersion,
    }),
  );
  const accepted = await command(
    db,
    "grade_status",
    auth.userId,
    auth.sessionId ?? null,
    {
      ...input,
      identity,
    },
  );
  if (str(accepted, "gradeId")) return accepted;
  const o = await stage(
    db,
    auth.userId,
    auth.sessionId ?? null,
    input.assignmentId,
    "grade",
    {
      score: input.score,
      comment: input.comment,
      gradedAt: new Date().toISOString(),
    },
  );
  return command(db, "grade", auth.userId, auth.sessionId ?? null, {
    ...input,
    identity,
    objectId: str(o, "id"),
  });
}
export async function draftEvidence(
  db: AppDatabaseClient,
  auth: AuthContext,
  input: { assignmentId: string; participantId: string; draftVersion: number },
): Promise<TemporaryReport> {
  const e = await command(
      db,
      "draft_evidence",
      auth.userId,
      auth.sessionId ?? null,
      input,
    ),
    a = object(e.assignment);
  const report: TemporaryReport = {
    assignment: assignment(a),
    question: questionSchema.parse(
      await stored(db, input.assignmentId, str(a, "snapshot_id")),
    ),
    revision: {
      id: `draft-${input.participantId}-${input.draftVersion}`,
      participantId: input.participantId,
      code: str(e, "code"),
      revision: input.draftVersion,
      submittedAt: null,
      status: "draft",
      artifactId: null,
      gradeId: null,
    },
    response: str(
      object(await stored(db, input.assignmentId, str(e, "objectId"))),
      "text",
    ),
    simulation: null,
    grade: null,
  };
  await command(
    db,
    "draft_evidence",
    auth.userId,
    auth.sessionId ?? null,
    input,
  );
  return report;
}
export async function cleanupTemporary(db: AppDatabaseClient): Promise<void> {
  const r = await command(db, "cleanup_list", null, null);
  for (const o of rows(r.objects)) {
    try {
      const { error } = await db.storage
        .from(bucket)
        .remove([objectPath(str(o, "assignment_id"), str(o, "id"))]);
      if (error) throw new Error("delete");
      await command(db, "cleanup_deleted", null, null, {
        objectId: str(o, "id"),
      });
    } catch {
      await command(db, "cleanup_failed", null, null, {
        objectId: str(o, "id"),
      });
      console.error("temporary_cleanup_retry");
    }
  }
  await command(db, "cleanup_finish", null, null);
  await sweepTemporaryOrphans(db);
}
async function sweepTemporaryOrphans(db: AppDatabaseClient): Promise<void> {
  const pending = await command(db, "cleanup_orphans", null, null);
  for (const path of Array.isArray(pending.objects) ? pending.objects : []) {
    if (typeof path !== "string") continue;
    const { error } = await db.storage.from(bucket).remove([path]);
    await command(
      db,
      error ? "cleanup_orphan_failed" : "cleanup_orphan_deleted",
      null,
      null,
      { path },
    );
    if (error) console.error("temporary_orphan_cleanup_retry");
  }
  const cursor = await command(db, "cleanup_cursor", null, null);
  let prefix = str(cursor, "prefix"),
    offset = num(cursor, "offset"),
    objectOffset = num(cursor, "objectOffset");
  if (!prefix) {
    const { data, error } = await db.storage
      .from(bucket)
      .list("", { limit: 1, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw temporaryFailure("UNAVAILABLE");
    prefix = data?.[0]?.name ?? "";
    if (!prefix) {
      await command(db, "cleanup_cursor_set", null, null, {
        offset: 0,
        prefix: null,
        objectOffset: 0,
      });
      return;
    }
  }
  if (!/^[a-f0-9-]{36}$/.test(prefix)) {
    await command(db, "cleanup_cursor_set", null, null, {
      offset: offset + 1,
      prefix: null,
      objectOffset: 0,
    });
    return;
  }
  const { data, error } = await db.storage.from(bucket).list(prefix, {
    limit: 200,
    offset: objectOffset,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw temporaryFailure("UNAVAILABLE");
  const files = (data ?? []).filter((f) =>
    /^[a-f0-9-]{36}\.json$/.test(f.name),
  );
  const inventory = await command(db, "cleanup_probe", null, null, {
    assignmentId: prefix,
    ids: files.map((f) => f.name.slice(0, -5)),
  });
  const ids = Array.isArray(inventory.ids) ? inventory.ids : [];
  for (const f of files)
    if (!ids.includes(f.name.slice(0, -5)))
      await command(db, "cleanup_orphan", null, null, {
        path: `${prefix}/${f.name}`,
      });
  await command(
    db,
    "cleanup_cursor_set",
    null,
    null,
    (data?.length ?? 0) < 200
      ? { offset: offset + 1, prefix: null, objectOffset: 0 }
      : { offset, prefix, objectOffset: objectOffset + 200 },
  );
}
export function temporarySite(env: Env): string {
  const u = new URL(env.TEMPORARY_SITE_ORIGIN ?? "https://explain.az");
  if (u.protocol !== "https:" && env.APP_ENV === "production")
    throw temporaryFailure("UNAVAILABLE");
  return u.origin;
}
