import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { randomUUID } from "node:crypto";
import type { AppDatabaseClient, Database } from "../src/lib/database";
import type { AuthContext } from "../src/lib/auth";
import {
  claim,
  cleanupTemporary,
  command,
  digest,
  distribute,
  evidence,
  publishTemporary,
  saveGuest,
  saveResult,
} from "../src/lib/temporary";
// @ts-expect-error Local-only CLI wrapper; never use hosted credentials here.
import { localCredentials } from "../../scripts/supabase-local.mjs";

let sql: pg.Client,
  service: AppDatabaseClient,
  anonymous: AppDatabaseClient,
  signedIn: AppDatabaseClient;
let auth: AuthContext, assessmentId: string;
let flags: {
  enabled: boolean;
  processing_enabled: boolean;
  enforce_admission: boolean;
};
beforeAll(async () => {
  const config = localCredentials();
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  service = createClient<Database>(
    config.API_URL,
    config.SERVICE_ROLE_KEY,
    options,
  );
  anonymous = createClient<Database>(config.API_URL, config.ANON_KEY, options);
  signedIn = createClient<Database>(config.API_URL, config.ANON_KEY, options);
  sql = new pg.Client({ connectionString: config.DB_URL });
  await sql.connect();
  flags = (
    await sql.query(
      "select enabled,processing_enabled,enforce_admission from explain_temporary.temporary_settings",
    )
  ).rows[0];
  const email = `${randomUUID()}@test.invalid`,
    password = `Test-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (created.error || !created.data.user)
    throw new Error("Synthetic teacher creation failed");
  const login = await signedIn.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error("Synthetic teacher sign-in failed");
  const id = created.data.user.id;
  await sql.query("insert into public.profiles(id,role) values($1,'teacher')", [
    id,
  ]);
  await sql.query(
    "insert into explain_temporary.teacher_access(email,teacher_id,actor_id) values($1,$2,$2)",
    [email, id],
  );
  const session = (
    await sql.query(
      "select id from auth.sessions where user_id=$1 order by created_at desc limit 1",
      [id],
    )
  ).rows[0].id;
  auth = {
    userId: id,
    sessionId: session,
    token: "synthetic",
    isAnonymous: false,
    email,
    authProvider: null,
    authProviders: [],
    authMethods: [],
  };
  assessmentId = randomUUID();
  await sql.query(
    "insert into public.assessments(id,type,title,prompt,created_by) values($1,'simulation','Temporary integration','Explain the relationships.',$2)",
    [assessmentId, id],
  );
  await sql.query(
    "update explain_temporary.temporary_settings set enabled=true,processing_enabled=true",
  );
});
afterAll(async () => {
  if (flags && sql)
    await sql.query(
      "update explain_temporary.temporary_settings set enabled=$1,processing_enabled=$2,enforce_admission=$3",
      [flags.enabled, flags.processing_enabled, flags.enforce_admission],
    );
  await signedIn?.auth.signOut();
  await sql?.end();
});

it("round-trips private temporary evidence through real PostgREST/Storage and retains cleanup inventory until deletion succeeds", async () => {
  const a = await publishTemporary(service, auth, {
    assessmentId,
    hours: 24,
    closesAt: new Date(Date.now() + 3600000).toISOString(),
    key: randomUUID(),
  });
  const link = (
    await distribute(service, auth, a.id, 1, "https://explain.test")
  ).links[0];
  const session = await digest(randomUUID());
  await command(service, "exchange", null, null, {
    publicId: a.publicId,
    tokenHash: await digest(new URL(link.url).hash.slice(1)),
    sessionHash: session,
  });
  const text = "Əlaqə ↑\n日本語 😀 e\u0301";
  const submission = {
    text,
    expectedVersion: 0,
    key: randomUUID(),
    submit: true,
  };
  const saved = await saveGuest(service, session, submission, a.publicId);
  expect(await saveGuest(service, session, submission, a.publicId)).toEqual(
    saved,
  );
  const job = (
    await claim(service, auth, {
      assignmentId: a.id,
      key: randomUUID(),
      limit: 1,
    })
  ).jobs[0];
  const source =
    "<!doctype html><html><head></head><body><button id='play'>Play</button><script>document.getElementById('play').onclick=()=>{document.body.dataset.play='yes'}</script></body></html>";
  await saveResult(service, auth, {
    assignmentId: a.id,
    responseId: job.responseId,
    jobId: job.jobId,
    fence: job.fence,
    contract: "explain-temporary-v1",
    html: source,
    model: null,
    client: null,
    assumptions: [],
  });
  const report = await evidence(service, auth, {
    assignmentId: a.id,
    responseId: String(saved.id),
  });
  expect(report.response).toBe(text);
  expect(report.simulation?.html).toContain("Content-Security-Policy");
  const object = (
    await sql.query(
      "select id from explain_temporary.temporary_objects where assignment_id=$1 and kind='question'",
      [a.id],
    )
  ).rows[0].id;
  const path = `${a.id}/${object}.json`;
  for (const client of [anonymous, signedIn]) {
    expect(
      (await client.storage.from("temporary-evidence").download(path)).error,
    ).not.toBeNull();
    expect(
      (
        await client.storage
          .from("temporary-evidence")
          .upload(`${a.id}/${randomUUID()}.json`, "{}")
      ).error,
    ).not.toBeNull();
    expect(
      (
        await client.rpc("temporary_command", {
          p_op: "detail",
          p_actor: auth.userId,
          p_connection: auth.sessionId!,
          p_input: { assignmentId: a.id },
        })
      ).error,
    ).not.toBeNull();
  }
  await sql.query(
    "update explain_temporary.temporary_assignments set published_at=now()-interval '4 days',closes_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=$1",
    [a.id],
  );
  await expect(
    evidence(service, auth, {
      assignmentId: a.id,
      responseId: String(saved.id),
    }),
  ).rejects.toMatchObject({ code: "ASSIGNMENT_EXPIRED" });
  // Inject one Storage failure without discarding the real PostgREST authority.
  const flaky = {
    rpc: service.rpc.bind(service),
    storage: {
      from(bucket: string) {
        const storage = service.storage.from(bucket);
        return {
          list: storage.list.bind(storage),
          remove: (paths: string[]) =>
            paths.includes(path)
              ? Promise.resolve({
                  error: { message: "Synthetic storage failure" },
                })
              : storage.remove(paths),
        };
      },
    },
  } as unknown as AppDatabaseClient;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await cleanupTemporary(flaky);
  } finally {
    log.mockRestore();
  }
  expect(
    (
      await sql.query(
        "select failures from explain_temporary.temporary_objects where id=$1",
        [object],
      )
    ).rows[0].failures,
  ).toBe(1);
  expect(
    (await service.storage.from("temporary-evidence").download(path)).error,
  ).toBeNull();
  await sql.query(
    "update explain_temporary.temporary_objects set retry_at=now() where assignment_id=$1",
    [a.id],
  );
  await cleanupTemporary(service);
  expect(
    (await service.storage.from("temporary-evidence").download(path)).error,
  ).not.toBeNull();
  expect(
    (
      await sql.query(
        "select id from explain_temporary.temporary_assignments where id=$1",
        [a.id],
      )
    ).rows,
  ).toHaveLength(0);
  expect(report.response).toBe(text);
  expect(report.simulation!.html).toContain("document.getElementById");
});
