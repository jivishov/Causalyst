import pg from "pg";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

/** Native PostgreSQL only; this function is called by the disposable DB runner. */
export async function runTemporaryConcurrency(url) {
  const pool = new pg.Pool({ connectionString: url, max: 32 });
  const teacher = randomUUID(),
    sessions = [randomUUID(), randomUUID()],
    assessment = randomUUID();
  const call = async (op, actor, connection, input) =>
    (
      await pool.query(
        "select public.temporary_command($1,$2,$3,$4::jsonb) as result",
        [op, actor, connection, JSON.stringify(input)],
      )
    ).rows[0].result;
  try {
    await pool.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [teacher, `${teacher}@temporary.test`],
    );
    await pool.query("insert into profiles(id,role) values($1,'teacher')", [
      teacher,
    ]);
    for (const session of sessions)
      await pool.query("insert into auth.sessions(id,user_id) values($1,$2)", [
        session,
        teacher,
      ]);
    await pool.query(
      "insert into explain_temporary.teacher_access(email,teacher_id,actor_id) values($1,$2,$2)",
      [`${teacher}@temporary.test`, teacher],
    );
    await pool.query(
      "update explain_temporary.temporary_settings set enabled=true,processing_enabled=true",
    );
    const source = (
      await pool.query(
        "insert into assessments(id,type,title,prompt,created_by) values($1,'simulation','Concurrency fixture','Explain',$2) returning updated_at::text as updated_at",
        [assessment, teacher],
      )
    ).rows[0];
    const publish = {
      assessmentId: assessment,
      hours: 72,
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      sourceUpdatedAt: source.updated_at,
      key: randomUUID(),
    };
    const published = await Promise.all(
      sessions.map((session) => call("publish", teacher, session, publish)),
    );
    assert.equal(
      published[0].id,
      published[1].id,
      "Concurrent publication retry duplicated the assignment",
    );
    const a = published[0],
      stage = async (kind, conn = sessions[0], actor = teacher) =>
        call("stage", actor, conn, {
          assignmentId: a.id,
          kind,
          bytes: 100,
          digest: "a".repeat(64),
        });
    const question = await stage("question"),
      context = await stage("context");
    await call("publish_commit", teacher, sessions[0], {
      assignmentId: a.id,
      questionId: question.id,
      contextId: context.id,
    });
    const participants = Array.from({ length: 30 }, (_, i) => ({
      id: randomUUID(),
      code: `P${String(i + 1).padStart(2, "0")}-ABCD`,
      tokenHash: String(i).padStart(64, "a"),
    }));
    await call("participants", teacher, sessions[0], {
      assignmentId: a.id,
      participants,
    });
    const results = await Promise.all(
      participants.map(async (p, i) => {
        const session = String(i).padStart(64, "b");
        await call("exchange", null, null, {
          publicId: a.public_id,
          tokenHash: p.tokenHash,
          sessionHash: session,
        });
        const response = await stage("response", session, null),
          ctx = await stage("context", session, null);
        const submit = {
          objectId: response.id,
          identity: response.digest,
          contextId: ctx.id,
          key: randomUUID(),
          expectedVersion: 0,
        };
        const both = await Promise.all([
          call("submit", null, session, submit),
          call("submit", null, session, submit),
        ]);
        assert.equal(
          both[0].id,
          both[1].id,
          "Lost-reply submit retry duplicated a revision",
        );
        return both[0];
      }),
    );
    assert.equal(new Set(results.map((r) => r.id)).size, 30);
    const batches = await Promise.all(
      sessions.map((session) =>
        call("claim", teacher, session, {
          assignmentId: a.id,
          key: randomUUID(),
          limit: 3,
        }),
      ),
    );
    const ids = batches.flatMap((b) => b.jobs.map((j) => j.id));
    assert.equal(ids.length, 6);
    assert.equal(
      new Set(ids).size,
      6,
      "Overlapping clients accepted the same reservation",
    );
    const old = batches[0].jobs[0];
    await pool.query(
      "update explain_temporary.external_generation_jobs set lease_until=now()-interval '1 minute' where id=$1",
      [old.id],
    );
    // Isolate the stale lease case without assuming which concurrent client won FIFO order.
    await pool.query(
      "update explain_temporary.external_generation_jobs set status='failed',attempts=3,connection=null,lease_until=null where assignment_id=$1 and id<>$2",
      [a.id, old.id],
    );
    const next = await call("claim", teacher, sessions[1], {
      assignmentId: a.id,
      key: randomUUID(),
      limit: 1,
    });
    assert.equal(next.jobs[0].id, old.id);
    assert.ok(next.jobs[0].fence > old.fence);
    await assert.rejects(
      call("renew", teacher, sessions[0], {
        assignmentId: a.id,
        jobId: old.id,
        responseId: old.response_id,
        fence: old.fence,
      }),
      /LEASE_EXPIRED/,
    );
    const locker = await pool.connect();
    try {
      await locker.query("begin");
      await locker.query(
        "update explain_temporary.temporary_assignments set published_at=clock_timestamp()-interval '2 hours',closes_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()+interval '300 milliseconds' where id=$1",
        [a.id],
      );
      const late = call("evidence", teacher, sessions[0], {
        assignmentId: a.id,
        responseId: old.response_id,
      });
      const denied = assert.rejects(late, /ASSIGNMENT_EXPIRED/);
      await delay(700);
      await locker.query("commit");
      await denied;
    } finally {
      locker.release();
    }
    console.log(
      "PASS native temporary 30-way submissions, duplicate retries, parallel claims and stale reservation fencing",
    );
  } finally {
    await pool.end();
  }
}
