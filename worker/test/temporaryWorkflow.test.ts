import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { z } from "zod";
import { readFile, readdir } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTeacherPluginServer } from "../src/lib/teacherPlugin";
import {
  command,
  digest,
  distribute,
  saveGuest,
  evidence,
  cleanupTemporary,
  publishTemporary,
} from "../src/lib/temporary";
import * as simulationRuntime from "../src/lib/temporarySimulation";
import type { AuthContext } from "../src/lib/auth";
import type { Env } from "../src/lib/env";
vi.mock("../src/routes/teacherAssessments", () => ({
  listTeacherAssessments: vi.fn().mockResolvedValue({ assessments: [] }),
  listTeacherAssignments: vi.fn(),
  createTeacherAssessment: vi.fn(),
  updateTeacherAssessment: vi.fn(),
}));
import { listTeacherAssessments } from "../src/routes/teacherAssessments";

const teacher = "b1000000-0000-4000-8000-000000000001",
  assessmentId = "b2000000-0000-4000-8000-000000000001";
const auth: AuthContext = {
  userId: teacher,
  sessionId: teacher,
  token: "synthetic",
  isAnonymous: false,
  email: "synthetic@example.test",
  authProvider: null,
  authProviders: [],
  authMethods: [],
};
const env = { TEMPORARY_SITE_ORIGIN: "https://explain.test" } as Env;
const pg = new PGlite(),
  objects = new Map<string, string>();
const fixtureDb = {
  async rpc(name: string, args: Record<string, unknown>) {
    if (
      ![
        "temporary_command",
        "teacher_admission",
        "get_teacher_prompt_context",
      ].includes(name)
    )
      throw new Error("Unexpected fixture RPC");
    const entries = Object.entries(args);
    try {
      const result = await pg.query<{ result: never }>(
        `select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) as result`,
        entries.map(([, v]) =>
          typeof v === "object" && v !== null ? JSON.stringify(v) : v,
        ),
      );
      return { data: result.rows[0]?.result, error: null };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : "error" },
      };
    }
  },
  storage: {
    from: () => ({
      async upload(path: string, text: string) {
        objects.set(path, text);
        return { data: { path }, error: null };
      },
      async download(path: string) {
        const value = objects.get(path);
        return {
          data: value === undefined ? null : new Blob([value]),
          error: value === undefined ? { message: "not found" } : null,
        };
      },
      async remove(paths: string[]) {
        for (const path of paths) objects.delete(path);
        return { error: null };
      },
      async list(
        prefix: string,
        { offset = 0, limit = 100 }: { offset?: number; limit?: number },
      ) {
        const names = prefix
          ? [...objects.keys()]
              .filter((k) => k.startsWith(prefix + "/"))
              .map((k) => k.slice(prefix.length + 1))
          : [...new Set([...objects.keys()].map((k) => k.split("/")[0]))];
        return {
          data: names
            .sort()
            .slice(offset, offset + limit)
            .map((name) => ({ name })),
          error: null,
        };
      },
    }),
  },
};
const db = fixtureDb as never;
beforeAll(async () => {
  await pg.exec(
    await readFile(
      new URL("../../scripts/test-db/bootstrap.sql", import.meta.url),
      "utf8",
    ),
  );
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrations))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await pg.exec(
      (await readFile(new URL(name, migrations), "utf8")).replace(
        "create extension if not exists pgcrypto;",
        "",
      ),
    );
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'synthetic@example.test',now());",
    [teacher],
  );
  await pg.query("insert into auth.sessions(id,user_id) values($1,$1)", [
    teacher,
  ]);
  await pg.query(
    "insert into profiles(id,role,display_name) values($1,'teacher','Synthetic')",
    [teacher],
  );
  await pg.query(
    "insert into explain_temporary.teacher_access(email,teacher_id,actor_id) values('synthetic@example.test',$1,$1)",
    [teacher],
  );
  await pg.exec(
    "update explain_temporary.temporary_settings set enabled=true,processing_enabled=true",
  );
  await pg.query(
    "insert into assessments(id,created_by,type,title,prompt) values($1,$2,'simulation','A synthetic model','Explain volume and pressure.')",
    [assessmentId, teacher],
  );
  const updatedAt = (
    await pg.query<{ updated_at: Date }>(
      "select updated_at from assessments where id=$1",
      [assessmentId],
    )
  ).rows[0].updated_at.toISOString();
  vi.mocked(listTeacherAssessments).mockResolvedValue({
    assessments: [
      {
        id: assessmentId,
        type: "simulation",
        title: "A synthetic model",
        prompt: "Explain volume and pressure.",
        rubric: [],
        updatedAt,
      },
    ],
  } as never);
}, 30000);
afterAll(async () => {
  await pg.close();
});
describe("synthetic student-to-MCP-to-evidence path", () => {
  it("saves 30 submissions, transports a claimed result, pins grading and deletes all hosted bytes", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Network is forbidden in this test"));
    const server = createTeacherPluginServer(
        db,
        env,
        auth,
        "https://explain.test/mcp/teacher",
      ),
      client = new Client({ name: "synthetic-acceptance", version: "1" });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    await client.connect(ct);
    try {
      const c = await client.callTool({
        name: "get_explain_capabilities",
        arguments: {},
      });
      expect(c.isError).not.toBe(true);
      expect(c.structuredContent).toMatchObject({
        executionMode: "teacher_client",
      });
      const published = await client.callTool({
        name: "publish_temporary_assignment",
        arguments: {
          assessmentId,
          hours: 72,
          closesAt: new Date(Date.now() + 86400000).toISOString(),
          key: crypto.randomUUID(),
        },
      });
      expect(published.isError).not.toBe(true);
      const a = z
        .object({
          assignment: z.object({ id: z.string(), publicId: z.string() }),
        })
        .parse(published.structuredContent).assignment;
      expect(a.id).toBeTruthy();
      expect(JSON.stringify(published)).not.toContain("tokenHash");
      const links = await distribute(
          db,
          auth,
          a.id,
          30,
          "https://explain.test",
        ),
        sessions = await Promise.all(
          links.links.map(async (link, i) => {
            const hash = await digest(`synthetic-session-${i}`);
            await command(db, "exchange", null, null, {
              publicId: a.publicId,
              tokenHash: await digest(new URL(link.url).hash.slice(1)),
              sessionHash: hash,
            });
            return hash;
          }),
        );
      await Promise.all(
        sessions.map((session, i) =>
          saveGuest(db, session, {
            text: `Synthetic participant ${i}: volume decreases while pressure increases.\nα Ş`,
            expectedVersion: 0,
            key: crypto.randomUUID(),
            submit: true,
          }),
        ),
      );
      expect(
        (
          await pg.query<{ n: number }>(
            "select count(*)::int n from explain_temporary.response_revisions",
          )
        ).rows[0].n,
      ).toBe(30);
      const claimed = await client.callTool({
        name: "claim_generation_batch",
        arguments: { assignmentId: a.id, key: crypto.randomUUID(), limit: 1 },
      });
      const jobs = z
        .object({
          jobs: z.array(
            z.object({
              jobId: z.string(),
              responseId: z.string(),
              fence: z.number(),
            }),
          ),
        })
        .parse(claimed.structuredContent).jobs;
      expect(jobs).toHaveLength(1);
      expect(JSON.stringify(claimed)).not.toMatch(
        /storage_key|OPENAI_API_KEY|provider_settings|token_hash/,
      );
      const source =
        '<!doctype html><html><head></head><body><button id="b">Play</button><script>document.getElementById("b").onclick=()=>{document.body.dataset.play="yes"}</script></body></html>';
      const input = {
        ...jobs[0],
        assignmentId: a.id,
        contract: "explain-temporary-v1",
        html: source,
        model: null,
        client: null,
        assumptions: [],
      };
      // Use only the documented commit fields, never returned evidence as tool arguments.
      const commit = {
        assignmentId: a.id,
        responseId: input.responseId,
        jobId: input.jobId,
        fence: input.fence,
        contract: input.contract,
        html: source,
        model: null,
        client: null,
        assumptions: [],
      };
      const saved = await client.callTool({
        name: "save_simulation_result",
        arguments: commit,
      });
      expect(saved.isError).not.toBe(true);
      const again = await client.callTool({
        name: "save_simulation_result",
        arguments: commit,
      });
      expect(again.structuredContent).toEqual(saved.structuredContent);
      const transform = vi
        .spyOn(simulationRuntime, "prepareTemporarySimulationHtml")
        .mockImplementation(() => {
          throw new Error("A later runtime must not change accepted evidence");
        });
      try {
        const replay = await client.callTool({
          name: "save_simulation_result",
          arguments: commit,
        });
        expect(replay.structuredContent).toEqual(saved.structuredContent);
        const changed = await client.callTool({
          name: "save_simulation_result",
          arguments: { ...commit, html: source + "<!-- changed -->" },
        });
        expect(changed.structuredContent).toMatchObject({
          code: "REVISION_CONFLICT",
        });
        expect(transform).not.toHaveBeenCalled();
      } finally {
        transform.mockRestore();
      }
      const gradeInput = {
        assignmentId: a.id,
        responseId: input.responseId,
        artifactId: z
          .object({ artifactId: z.string() })
          .parse(saved.structuredContent).artifactId,
        score: 82,
        comment: "Teacher approved synthetic grade",
        expectedGradeVersion: 0,
        key: crypto.randomUUID(),
        approved: true,
      };
      const grade = await client.callTool({
        name: "save_temporary_grade",
        arguments: gradeInput,
      });
      expect(grade.isError).not.toBe(true);
      const objectCount = objects.size;
      await pg.query(
        "update explain_temporary.temporary_assignments set used_bytes=(select max_bytes from explain_temporary.temporary_settings) where id=$1",
        [a.id],
      );
      const gradeReplay = await client.callTool({
        name: "save_temporary_grade",
        arguments: gradeInput,
      });
      expect(gradeReplay.structuredContent).toEqual(grade.structuredContent);
      expect(objects.size).toBe(objectCount);
      const changedGrade = await client.callTool({
        name: "save_temporary_grade",
        arguments: { ...gradeInput, score: 99 },
      });
      expect(changedGrade.structuredContent).toMatchObject({
        code: "REVISION_CONFLICT",
      });
      const invalidSelection = await client.callTool({
        name: "prepare_evidence_export",
        arguments: {
          assignmentId: a.id,
          participantIds: [crypto.randomUUID()],
        },
      });
      expect(invalidSelection.structuredContent).toMatchObject({
        code: "NOT_FOUND",
      });
      const report = await evidence(db, auth, {
        assignmentId: a.id,
        responseId: input.responseId,
      });
      expect(report.response).toContain("α Ş");
      expect(report.simulation?.html).toContain("Content-Security-Policy");
      expect(report.grade?.score).toBe(82);
      const bytes = report.simulation!.html;
      await pg.exec(
        "update explain_temporary.temporary_assignments set published_at=now()-interval '4 days',closes_at=now()-interval '3 days',expires_at=now()-interval '1 day'",
      );
      await cleanupTemporary(db);
      expect(objects.size).toBe(0);
      expect(bytes).toContain("document.getElementById");
      await expect(
        evidence(db, auth, {
          assignmentId: a.id,
          responseId: input.responseId,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      await client.close();
      await server.close();
    }
  }, 30000);
  it("recovers accepted publication and submission replies without uploading again, while respecting revocation and expiry", async () => {
    const publication = {
      assessmentId,
      hours: 72 as const,
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      key: crypto.randomUUID(),
    };
    const a = await publishTemporary(db, auth, publication);
    vi.mocked(listTeacherAssessments).mockClear();
    const objectsBefore = objects.size;
    await pg.exec(
      "update explain_temporary.temporary_settings set enabled=false",
    );
    expect(await publishTemporary(db, auth, publication)).toEqual(a);
    expect(listTeacherAssessments).not.toHaveBeenCalled();
    expect(objects.size).toBe(objectsBefore);
    await expect(
      publishTemporary(db, auth, { ...publication, hours: 24 }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await pg.exec(
      "update explain_temporary.temporary_settings set enabled=true",
    );
    const link = (await distribute(db, auth, a.id, 1, "https://explain.test"))
      .links[0];
    const session = await digest(crypto.randomUUID());
    await command(db, "exchange", null, null, {
      publicId: a.publicId,
      tokenHash: await digest(new URL(link.url).hash.slice(1)),
      sessionHash: session,
    });
    const submission = {
      text: "Əlaqə: təzyiq ↑\n日本語 😀 e\u0301",
      expectedVersion: 0,
      key: crypto.randomUUID(),
      submit: true,
    };
    const saved = await saveGuest(db, session, submission, a.publicId);
    const count = objects.size;
    // A lost reply can be retried immediately at the rate/quota boundary.
    await pg.query(
      "update explain_temporary.temporary_assignments set used_bytes=(select max_bytes from explain_temporary.temporary_settings) where id=$1",
      [a.id],
    );
    expect(await saveGuest(db, session, submission, a.publicId)).toEqual(saved);
    await pg.query(
      "update explain_temporary.temporary_assignments set published_at=now()-interval '2 hours',closes_at=now()-interval '1 hour' where id=$1",
      [a.id],
    );
    expect(await saveGuest(db, session, submission, a.publicId)).toEqual(saved);
    expect(objects.size).toBe(count);
    await expect(
      saveGuest(
        db,
        session,
        { ...submission, text: "Different evidence" },
        a.publicId,
      ),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(
      saveGuest(
        db,
        session,
        { ...submission, key: crypto.randomUUID() },
        a.publicId,
      ),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_CLOSED" });
    await expect(
      saveGuest(db, session, submission, crypto.randomUUID()),
    ).rejects.toMatchObject({ code: "ACCESS_REVOKED" });
    const report = await evidence(db, auth, {
      assignmentId: a.id,
      responseId: String(saved.id),
    });
    expect(report.response).toBe(submission.text);
    await pg.exec("update explain_temporary.teacher_access set active=false");
    await expect(publishTemporary(db, auth, publication)).rejects.toMatchObject(
      { code: "ACCESS_REVOKED" },
    );
    await pg.exec("update explain_temporary.teacher_access set active=true");
    await pg.query(
      "update explain_temporary.temporary_assignments set published_at=now()-interval '4 days',closes_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=$1",
      [a.id],
    );
    await expect(
      saveGuest(db, session, submission, a.publicId),
    ).rejects.toMatchObject({ code: "ASSIGNMENT_EXPIRED" });
    await expect(publishTemporary(db, auth, publication)).rejects.toMatchObject(
      { code: "ASSIGNMENT_EXPIRED" },
    );
    await cleanupTemporary(db);
  }, 30000);
});
