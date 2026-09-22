import pg from 'pg';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

export async function runConcurrency(url) {
  const admin = new pg.Client({ connectionString: url });
  const left = new pg.Client({ connectionString: url });
  const right = new pg.Client({ connectionString: url });
  await Promise.all([admin.connect(), left.connect(), right.connect()]);
  try {
    for (const connection of [left, right]) await connection.query("set role service_role; set statement_timeout='10s'");
    const teacher = randomUUID(), student = randomUUID(), course = randomUUID();
    await admin.query('insert into auth.users(id,email,email_confirmed_at) values($1,$3,now()),($2,$4,now())', [teacher, student, `${teacher}@test.invalid`, `${student}@test.invalid`]);
    await admin.query("insert into profiles(id,role) values($1,'teacher')", [teacher]);
    await admin.query('insert into classes(id,code,name,teacher_id) values($1::uuid,$1::text,\'Concurrent fixture\',$2)', [course, teacher]);
    await admin.query('insert into roster_students(class_id,display_name,email) values($1,\'Student\',$2)', [course, `${student}@test.invalid`]);
    await Promise.all([left, right].map(c => c.query('select enroll_student_by_email($1)', [student])));
    assert.equal((await admin.query('select count(*)::int as n from class_memberships where student_id=$1', [student])).rows[0].n, 1);
    async function evidence(kind = 'writing') {
      const assessment = randomUUID(), assignment = randomUUID(), attempt = randomUUID(), artifact = randomUUID();
      await admin.query('insert into assessments(id,type,title,prompt,created_by) values($1,$2,\'Test\',\'Explain\',$3)', [assessment, kind, teacher]);
      await admin.query('insert into assessment_assignments(id,class_id,assessment_id) values($1,$2,$3)', [assignment, course, assessment]);
      await admin.query('insert into attempts(id,assessment_id,assignment_id,student_id) values($1,$2,$3,$4)', [attempt, assessment, assignment, student]);
      await admin.query('insert into attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type) values($1::uuid,$2,$3,$4,$4,$1::text,\'image/png\')', [artifact, attempt, student, kind === 'simulation' ? 'simulation-sketch' : kind]);
      await left.query('select complete_artifact_upload($1,$2,$3)', [student, artifact, 'a'.repeat(64)]);
      return { attempt, artifact };
    }
    const first = await evidence();
    const claims = await Promise.all([left, right].map(c => c.query('select claim_status from claim_attempt_submission($1,$2,now(),$3)', [student, first.attempt, [first.artifact]])));
    assert.deepEqual(claims.map(r => r.rows[0].claim_status).sort(), ['not_draft', 'success']);
    const second = await evidence('simulation');
    const input = { operation: 'generate', provider: 'openai', requestedModel: 'synthetic', htmlReasoningEffort: 'low', sketchArtifactId: second.artifact, sourceDescriptionSha256: 'a'.repeat(64) };
    const jobs = await Promise.all([left, right].map(c => c.query('select reserve_simulation_job($1,$2,$3,$4) as result', [student, second.attempt, 'same-key', input])));
    assert.equal(jobs.filter(r => r.rows[0].result.claimed).length, 1);
    assert.equal(jobs[0].rows[0].result.job.id, jobs[1].rows[0].result.job.id);
    const third = await evidence();
    await admin.query("update attempt_artifacts set cleanup_at=now()-interval '1 day' where id=$1", [third.artifact]);
    const raced = await Promise.allSettled([
      left.query('select claim_status from claim_attempt_submission($1,$2,now(),$3)', [student, third.attempt, [third.artifact]]),
      right.query('select claim_artifact_cleanup($1) as claimed', [third.artifact])
    ]);
    const saved = (await admin.query('select upload_state,frozen_at from attempt_artifacts where id=$1', [third.artifact])).rows[0];
    if (saved.frozen_at) {
      assert.equal(saved.upload_state, 'uploaded');
      assert.equal(raced[1].status, 'fulfilled');
      assert.equal(raced[1].value.rows[0].claimed, false);
    } else {
      assert.equal(saved.upload_state, 'deleted');
      assert.equal(raced[0].status, 'rejected');
      assert.equal(raced[0].reason.code, '23514');
    }
    console.log('PASS native concurrent enrollment, submission, reservation, and retention races');
  } finally { await Promise.all([admin.end(), left.end(), right.end()]); }
}
