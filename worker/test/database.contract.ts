import type { AppDatabaseClient } from "../src/lib/database";

// Compiled by typecheck, never executed. These assertions fail if a client
// boundary silently loses its schema type and falls back to `any`.
function databaseContract(db: AppDatabaseClient) {
  db.from("attempts").insert({ assessment_id: "assessment", student_id: "student" });
  // @ts-expect-error The database trigger owns snapshot selection.
  db.from("attempts").insert({ assessment_id: "assessment", student_id: "student", assessment_version_id: "chosen-by-client" });
  // @ts-expect-error Unknown tables must fail at compile time.
  db.from("attempt_typo");
  // @ts-expect-error Unknown columns must fail at compile time.
  db.from("attempts").update({ provisional_score_typo: 100 });
  // @ts-expect-error Scores are numeric.
  db.from("attempts").update({ provisional_score: "100" });
  // @ts-expect-error The privileged RPC requires an authenticated user ID.
  db.rpc("claim_realtime_submission", { p_session_id: "session", p_transcript: "text" });
  // @ts-expect-error Unknown RPCs must fail at compile time.
  db.rpc("claim_submission_typo");
}
void databaseContract;
