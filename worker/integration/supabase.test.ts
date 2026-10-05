import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { isJsonObject, type AppDatabaseClient, type Database } from "../src/lib/database";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
// The CLI owns these local-only credentials; never substitute hosted project keys.
// @ts-expect-error The CLI wrapper is a Node-only JavaScript module.
import { localCredentials } from "../../scripts/supabase-local.mjs";
// @ts-expect-error This native database test helper is a Node-only JavaScript module.
import { runConcurrency } from "../../scripts/test-db/concurrency.mjs";
import { listTeacherGradebook, exportTeacherGradebook } from "../src/routes/teacherGradebook";
import { uploadArtifact } from "../src/routes/artifacts";
import { signUploadToken } from "../src/lib/crypto";
import { claimAttemptSubmission } from "../src/lib/attemptLifecycle";
import { studentSession } from "../src/routes/student";
import { listStudentSubmissions } from "../src/routes/studentSubmissions";
import { reserveSimulationJob } from "../src/lib/simulationJobs";
import { runRetention } from "../src/lib/retention";
import * as openai from "../src/lib/openai";
import { Miniflare, convertV4MiniflareOptions, Response as RuntimeResponse, type Request as RuntimeRequest } from "miniflare";

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const syntheticEnv = { PIN_PEPPER: "disposable-integration-pepper" } as never;
let service: AppDatabaseClient, anonymous: AppDatabaseClient, studentClient: AppDatabaseClient, unrelatedClient: AppDatabaseClient;
let sql: pg.Client;
let teacherId: string, studentId: string, unrelatedId: string;
let courseId: string, assignmentId: string, attemptId: string, artifactId: string;
let studentEmail: string, objectKey: string;
const privateAnswer = `PRIVATE-${randomUUID()}`;
const bytes = new TextEncoder().encode("Synthetic handwriting fixture");

async function authUser(client: AppDatabaseClient) {
  const email = `${randomUUID()}@test.invalid`;
  const password = `Test-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw new Error(`Fixture user creation failed: ${created.error?.message}`);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw new Error(`Fixture sign-in failed: ${signedIn.error.message}`);
  return { id: created.data.user.id, email };
}

beforeAll(async () => {
  const config = localCredentials();
  service = createClient<Database>(config.API_URL, config.SERVICE_ROLE_KEY, options);
  anonymous = createClient<Database>(config.API_URL, config.ANON_KEY, options);
  studentClient = createClient<Database>(config.API_URL, config.ANON_KEY, options);
  unrelatedClient = createClient<Database>(config.API_URL, config.ANON_KEY, options);
  const teacher = await authUser(createClient<Database>(config.API_URL, config.ANON_KEY, options));
  const student = await authUser(studentClient);
  const unrelated = await authUser(unrelatedClient);
  teacherId = teacher.id; studentId = student.id; studentEmail = student.email; unrelatedId = unrelated.id;
  sql = new pg.Client({ connectionString: config.DB_URL });
  await sql.connect();
  await sql.query("insert into public.profiles(id,role) values($1,'teacher')", [teacherId]);
  courseId = randomUUID(); assignmentId = randomUUID(); attemptId = randomUUID(); artifactId = randomUUID();
  const assessmentId = randomUUID();
  objectKey = `${studentId}/${attemptId}/${artifactId}.txt`;
  await sql.query("insert into public.classes(id,code,name,teacher_id) values($1,$2,'Integration',$3)", [courseId, `T${randomUUID()}`, teacherId]);
  const rows = Array.from({ length: 1201 }, (_, i) => ({ id: randomUUID(), displayName: `Student ${String(i).padStart(4, '0')}`,
    email: i === 0 ? studentEmail : `${randomUUID()}@test.invalid`, pinHash: `synthetic-${randomUUID()}` }));
  const imported = await service.rpc('import_course_roster', { p_teacher_id: teacherId, p_course_id: courseId, p_rows: rows });
  expect(imported.error).toBeNull();
  const enrolled = await studentSession(service, studentId);
  expect(enrolled.enrollmentStatus).toBe('matched');
  expect(enrolled.profile).toMatchObject({ id: studentId, displayName: 'Student 0000', email: studentEmail });
  await sql.query("insert into public.assessments(id,type,title,prompt,expected_answer,created_by) values($1,'writing','Integration','Explain',$2,$3)", [assessmentId, privateAnswer, teacherId]);
  await sql.query('insert into public.assessment_assignments(id,class_id,assessment_id) values($1,$2,$3)', [assignmentId, courseId, assessmentId]);
  await sql.query('insert into public.attempts(id,assessment_id,assignment_id,student_id) values($1,$2,$3,$4)', [attemptId, assessmentId, assignmentId, studentId]);
  await sql.query("insert into public.attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type,byte_size) values($1,$2,$3,'writing','writing',$4,'image/png',$5)", [artifactId, attemptId, studentId, objectKey, bytes.length]);
});

afterAll(async () => {
  await Promise.allSettled([studentClient?.auth.signOut(), unrelatedClient?.auth.signOut()]);
  await sql?.end();
  // The entire test stack is disposable; teardown removes its databases and files.
});

describe('real Supabase service boundaries', () => {
  it('denies private keys, snapshots and privileged RPCs to anonymous and signed-in clients', async () => {
    for (const client of [anonymous, studentClient, unrelatedClient]) {
      const keys = await client.from('assessments').select('expected_answer');
      expect(keys.error).not.toBeNull();
      expect(keys.data).toBeNull();
      const snapshots = await client.from('assessment_versions').select('definition');
      expect(snapshots.error).not.toBeNull();
      const claim = await client.rpc('enroll_student_by_email', { p_user_id: studentId });
      expect(claim.error).not.toBeNull();
    }
    const grader = await service.from('assessments').select('expected_answer').eq('created_by', teacherId).single();
    expect(grader.error).toBeNull();
    expect(grader.data?.expected_answer).toBe(privateAnswer);
  });

  it('keeps frozen context when the teacher edits the assessment', async () => {
    const before = await service.from('attempts').select('assessment_id,assessment_version_id').eq('id', attemptId).single();
    expect(before.error).toBeNull();
    const edited = await service.from('assessments').update({ expected_answer: 'Changed teacher key' }).eq('id', before.data!.assessment_id);
    expect(edited.error).toBeNull();
    const snapshot = await service.from('assessment_versions').select('definition').eq('id', before.data!.assessment_version_id).single();
    expect(snapshot.error).toBeNull();
    expect(isJsonObject(snapshot.data?.definition) && snapshot.data.definition.expected_answer).toBe(privateAnswer);
  });

  it('uploads through the Worker boundary, rejects cross-owner access and freezes original bytes', async () => {
    const token = await signUploadToken(artifactId, studentId, syntheticEnv);
    const request = () => new Request('https://worker.test/upload', { method: 'PUT', headers: { 'X-Upload-Token': token }, body: bytes });
    await expect(uploadArtifact(request(), syntheticEnv, service, unrelatedId, artifactId)).rejects.toMatchObject({ status: 403 });
    const otherToken = await signUploadToken(artifactId, unrelatedId, syntheticEnv);
    await expect(uploadArtifact(new Request('https://worker.test/upload', { method: 'PUT', headers: { 'X-Upload-Token': otherToken }, body: bytes }),
      syntheticEnv, service, unrelatedId, artifactId)).rejects.toMatchObject({ status: 404 });
    await uploadArtifact(request(), syntheticEnv, service, studentId, artifactId);
    await uploadArtifact(request(), syntheticEnv, service, studentId, artifactId);
    for (const client of [anonymous, studentClient, unrelatedClient]) {
      expect((await client.storage.from('writing').download(objectKey)).error).not.toBeNull();
      expect((await client.storage.from('writing').upload(objectKey, bytes, { upsert: true })).error).not.toBeNull();
    }
    await claimAttemptSubmission(service, studentId, attemptId, new Date().toISOString(), [artifactId]);
    await expect(uploadArtifact(request(), syntheticEnv, service, studentId, artifactId)).rejects.toMatchObject({ status: 409 });
    const saved = await service.storage.from('writing').download(objectKey);
    expect(saved.error).toBeNull();
    expect(await saved.data!.text()).toBe(new TextDecoder().decode(bytes));
    const manifest = await service.from('submission_artifacts').select('content_sha256').eq('attempt_id', attemptId).single();
    expect(manifest.error).toBeNull();
    expect(manifest.data?.content_sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('exports all 1,201 rows through real PostgREST with a 73-row cap', async () => {
    const raw = await service.from('roster_students').select('id').eq('class_id', courseId);
    expect(raw.error).toBeNull();
    expect(raw.data).toHaveLength(73);
    const gradebook = await listTeacherGradebook(new Request(`https://worker.test/api/teacher/gradebook?courseId=${courseId}`), service, teacherId);
    expect(gradebook.entries).toHaveLength(1201);
    const exported = await exportTeacherGradebook(new Request('https://worker.test/export', { method: 'POST', body: JSON.stringify({
      courseId, format: 'long', includeUnpublished: true, columns: ['student_name', 'final_score']
    }) }), service, teacherId);
    expect(exported.rowCount).toBe(1201);
    expect(exported.csv?.trim().split(/\r?\n/)).toHaveLength(1202);
  });

  it('replays role and transaction assertions against Supabase-owned schemas', async () => {
    const location = new URL('../../scripts/test-db/', import.meta.url);
    for (const name of (await readdir(location)).filter(name => name.endsWith('.test.sql')).sort()) {
      await sql.query(await readFile(new URL(name, location), 'utf8'));
    }
    await runConcurrency(localCredentials().DB_URL);
  });

  it('saves a foreground job through real durable alarms and Supabase without an open student connection', async () => {
    const assessment = randomUUID(), assignment = randomUUID(), attempt = randomUUID(), sketch = randomUUID();
    const description = "Two circles move apart when Play is pressed and return when Reset is pressed.";
    const sourceHash = createHash("sha256").update(description).digest("hex");
    await sql.query("insert into assessments(id,type,title,prompt,created_by) values($1,'simulation','Durable runtime','Explain',$2)", [assessment, teacherId]);
    await sql.query('insert into assessment_assignments(id,class_id,assessment_id) values($1,$2,$3)', [assignment, courseId, assessment]);
    expect((await service.from('attempts').insert({ id: attempt, assessment_id: assessment, assignment_id: assignment, student_id: studentId })).error).toBeNull();
    await sql.query("insert into attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type,upload_state,openai_file_id,source_description_sha256) values($1::uuid,$2,$3,'simulation-sketch','simulation-sketch',$1::text,'image/png','uploaded','file-synthetic',$4)", [sketch, attempt, studentId, sourceHash]);
    const reservation = await reserveSimulationJob(service, { userId: studentId, attemptId: attempt, operation: 'generate',
      sketchArtifactId: sketch, sourceDescriptionSha256: sourceHash, htmlReasoningEffort: 'medium', provider: 'openai', requestedModel: 'gpt-6.1-sol', htmlServiceTierRequested: 'fast' });
    await service.from('simulation_generation_jobs').update({ provider_status: 'managed_queued' }).eq('id', reservation.job.id);
    await sql.query("update simulation_generation_jobs set updated_at=now()-interval '10 minutes' where id=$1", [reservation.job.id]);
    await runRetention(service, {} as never);
    expect((await service.from('simulation_generation_jobs').select('status').eq('id', reservation.job.id).single()).data?.status).toBe('queued');
    const html = '<!doctype html><html><head><style>body{margin:0}</style></head><body><button>Play</button><button>Pause</button><button>Reset</button><button>Step Forward</button><svg viewBox="0 0 800 500"><circle cx="200" cy="200" r="40"/><circle cx="500" cy="200" r="40"/></svg></body></html>';
    let providerCalls = 0;
    let uploadRejectedOnce = false;
    const sse = [ { type: "response.created", response: { id: "resp-synthetic-runtime", status: "in_progress", service_tier: "fast" } },
      { type: "response.output_text.delta", delta: html },
      { type: "response.completed", response: { id: "resp-synthetic-runtime", status: "completed", model: "gpt-6.1-sol", service_tier: "fast",
        output: [{ type: "message", content: [{ type: "output_text", text: html }] }] } }
    ].map(event => `data: ${JSON.stringify(event)}\n\n`).join("");
    const config = localCredentials();
    const bundleDirectory = new URL("../../.worker-build/", import.meta.url);
    const bundleFiles = (await readdir(bundleDirectory)).filter(name => name.endsWith(".js") || name.endsWith(".txt"))
      .sort((a, b) => a === "index.js" ? -1 : b === "index.js" ? 1 : a.localeCompare(b));
    const modules = await Promise.all(bundleFiles.map(async name => ({ type: name.endsWith(".txt") ? "Text" as const : "ESModule" as const,
      path: fileURLToPath(new URL(name, bundleDirectory)), contents: await readFile(new URL(name, bundleDirectory), "utf8") })));
    const runtime = new Miniflare(convertV4MiniflareOptions({ modules, modulesRoot: fileURLToPath(bundleDirectory), compatibilityDate: "2026-04-28",
      outboundService: async (request: RuntimeRequest) => {
        const target = new URL(request.url);
        if (target.origin === "https://api.openai.com" && target.pathname === "/v1/responses" && request.method === "POST") {
          providerCalls++;
          expect(await request.json()).toMatchObject({ background: false, stream: true, store: true, model: "gpt-6.1-sol",
            service_tier: "fast", reasoning: { effort: "medium" }, max_output_tokens: 64000 });
          return new RuntimeResponse(sse, { headers: { "content-type": "text/event-stream" } });
        }
        if (target.origin !== new URL(config.API_URL).origin) throw new Error("Unexpected runtime subrequest");
        if (!uploadRejectedOnce && request.method === "POST" && target.pathname.startsWith("/storage/v1/object/simulation-derived/")) {
          uploadRejectedOnce = true;
          return new RuntimeResponse(JSON.stringify({ message: "Synthetic storage outage" }), { status: 503,
            headers: { "content-type": "application/json" } });
        }
        const forwarded = await fetch(request.url, { method: request.method, headers: Object.fromEntries(request.headers),
          ...(["GET", "HEAD"].includes(request.method) ? {} : { body: new Uint8Array(await request.arrayBuffer()) }) });
        if (!forwarded.ok) {
          const problem = await forwarded.clone().json().catch(() => ({})) as { code?: string; error?: string; message?: string };
          console.error("Disposable runtime dependency failure", { path: target.pathname, status: forwarded.status,
            code: problem.code ?? problem.error, message: problem.message });
        }
        return new RuntimeResponse([204, 205, 304].includes(forwarded.status) ? null : await forwarded.arrayBuffer(),
          { status: forwarded.status, headers: Object.fromEntries(forwarded.headers) });
      },
      bindings: { SUPABASE_URL: config.API_URL, SUPABASE_SERVICE_ROLE_KEY: config.SERVICE_ROLE_KEY, OPENAI_API_KEY: "synthetic", PIN_PEPPER: "disposable-integration-pepper", APP_ENV: "test" },
      durableObjects: { SIMULATION_GENERATIONS: { className: "SimulationGeneration", useSQLite: true },
        SIMULATION_SCHEDULER: { className: "SimulationScheduler", useSQLite: true }, REALTIME_SESSIONS: { className: "RealtimeEvidence", useSQLite: true } }
    }));
    try {
      const namespace = await runtime.getDurableObjectNamespace("SIMULATION_GENERATIONS") as unknown as DurableObjectNamespace;
      const owner = namespace.get(namespace.idFromName(reservation.job.id));
      const initialized = await owner.fetch("https://internal/init", { method: "POST", body: JSON.stringify({
        job: reservation.job, description, model: { id: "gpt-6.1-sol", reasoningEffort: "medium", verbosity: "low", maxOutputTokens: 64000, fastMode: true }
      }) });
      expect(initialized.ok).toBe(true);
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        const result = await service.from("simulation_generation_jobs").select("status,result_artifact_id,service_tier_used").eq("id", reservation.job.id).single();
        expect(result.error).toBeNull();
        if (result.data?.status === "completed") {
          expect(result.data.result_artifact_id).toBe(reservation.job.id);
          expect(result.data.service_tier_used).toBe("fast");
          const artifact = await service.from("attempt_artifacts").select("bucket,storage_key,upload_state").eq("id", result.data.result_artifact_id!).single();
          expect(artifact.data?.upload_state).toBe("uploaded");
          const document = await service.storage.from(artifact.data!.bucket).download(artifact.data!.storage_key);
          expect(document.error).toBeNull(); expect(await document.data!.text()).toContain("<circle");
          expect(providerCalls).toBe(1);
          expect(uploadRejectedOnce).toBe(true);
          const artifacts = await service.from("attempt_artifacts").select("id").eq("attempt_id", attempt).eq("kind", "simulation-derived");
          expect(artifacts.data).toHaveLength(1);
          return;
        }
        if (result.data?.status === "failed") throw new Error("Durable runtime generation failed");
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error("Durable alarm did not save the HTML within the test deadline");
    } finally { await runtime.dispose(); }
  }, 30_000);

  it('expires other jobs during a provider outage and retries cancellation without restarting generation', async () => {
    const jobs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const assessment = randomUUID(), assignment = randomUUID(), attempt = randomUUID(), artifact = randomUUID();
      await sql.query("insert into assessments(id,type,title,prompt,created_by) values($1,'simulation','Retention','Explain',$2)", [assessment, teacherId]);
      await sql.query('insert into assessment_assignments(id,class_id,assessment_id) values($1,$2,$3)', [assignment, courseId, assessment]);
      // Exercise the typed client insert: the trigger, not the caller, chooses the snapshot.
      const created = await service.from('attempts').insert({ id: attempt, assessment_id: assessment, assignment_id: assignment, student_id: studentId });
      expect(created.error).toBeNull();
      await sql.query("insert into attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type) values($1::uuid,$2,$3,'simulation-sketch','simulation-sketch',$1::text,'image/png')", [artifact, attempt, studentId]);
      const reserved = await reserveSimulationJob(service, { userId: studentId, attemptId: attempt, operation: 'generate',
        sketchArtifactId: artifact, sourceDescriptionSha256: 'a'.repeat(64), htmlReasoningEffort: 'low', provider: 'openai', requestedModel: 'synthetic' });
      expect(reserved.claimed).toBe(true);
      jobs.push(reserved.job.id);
      await sql.query("update simulation_generation_jobs set provider_response_id=$2,expires_at=now()-interval '1 minute' where id=$1", [reserved.job.id, `synthetic-response-${i}`]);
    }
    const cancel = vi.fn(async (id: string) => {
      if (id === 'synthetic-response-0') throw { status: 503 };
      return {};
    });
    const client = vi.spyOn(openai, 'openaiClient').mockReturnValue({ responses: { cancel }, files: { delete: vi.fn() } } as never);
    try {
      await runRetention(service, {} as never);
      const first = await service.from('simulation_generation_jobs').select('id,status,provider_status').in('id', jobs);
      expect(first.error).toBeNull();
      expect(first.data).toHaveLength(2);
      expect(first.data?.every(job => job.status === 'expired')).toBe(true);
      expect(first.data?.find(job => job.id === jobs[0])?.provider_status).toBe('cancellation_pending');
      expect(first.data?.find(job => job.id === jobs[1])?.provider_status).toBeNull();
      cancel.mockImplementation(async () => ({}));
      await runRetention(service, {} as never);
      expect(cancel).toHaveBeenCalledTimes(3);
      const retried = await service.from('simulation_generation_jobs').select('status,provider_status').eq('id', jobs[0]).single();
      expect(retried.error).toBeNull();
      expect(retried.data).toEqual({ status: 'expired', provider_status: null });
    } finally { client.mockRestore(); }
  });
  it('restores archived and legacy submissions through real PostgREST despite a newer draft and the 73-row response cap', async () => {
    const assessment = randomUUID(), assignment = randomUUID(), draft = randomUUID(), legacy = randomUUID(), foreign = randomUUID();
    await sql.query("insert into public.assessments(id,type,title,prompt,expected_answer,created_by) values($1,'writing','History original title','Explain',$2,$3)",
      [assessment, privateAnswer, teacherId]);
    await sql.query('insert into public.assessment_assignments(id,class_id,assessment_id) values($1,$2,$3)', [assignment, courseId, assessment]);
    const savedIds = Array.from({ length: 80 }, () => randomUUID());
    const inserted = await service.from('attempts').insert(savedIds.map((id, index) => ({
      id, assessment_id: assessment, assignment_id: assignment, student_id: studentId,
      status: 'submitted', created_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
      submitted_at: new Date(Date.now() - (index + 1) * 86_400_000 + 3_600_000).toISOString()
    })));
    expect(inserted.error).toBeNull();
    expect((await service.from('attempts').insert({ id: draft, assessment_id: assessment, assignment_id: assignment, student_id: studentId })).error).toBeNull();
    expect((await service.from('attempts').insert({ id: legacy, assessment_id: assessment, assignment_id: null, student_id: studentId,
      status: 'graded', submitted_at: new Date().toISOString() })).error).toBeNull();
    await sql.query("insert into public.profiles(id,role) values($1,'student') on conflict(id) do nothing", [unrelatedId]);
    expect((await service.from('attempts').insert({ id: foreign, assessment_id: assessment, assignment_id: null, student_id: unrelatedId,
      status: 'submitted', submitted_at: new Date().toISOString() })).error).toBeNull();
    expect((await service.from('assessment_assignments').update({ archived_at: new Date().toISOString() }).eq('id', assignment)).error).toBeNull();
    expect((await service.from('assessments').update({ title: 'History edited title', archived_at: new Date().toISOString() }).eq('id', assessment)).error).toBeNull();
    const history = await listStudentSubmissions(service, studentId);
    const restored = history.submissions.filter(item => item.assignmentId === assignment);
    expect(restored).toHaveLength(80);
    expect(new Set(restored.map(item => item.attemptId))).toEqual(new Set(savedIds));
    expect(restored.every(item => item.assessment?.title === 'History original title')).toBe(true);
    expect(history.submissions.some(item => item.attemptId === legacy && item.assignmentId === null)).toBe(true);
    expect(history.submissions.some(item => item.attemptId === draft || item.attemptId === foreign)).toBe(false);
    expect(JSON.stringify(history)).not.toContain(privateAnswer);
  });

});
