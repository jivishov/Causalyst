import { HttpError } from "./http";

export const ATTEMPT_LIFECYCLE_MIGRATION_MESSAGE =
  "Attempt lifecycle requires a database update before submissions can run.";

export function attemptLifecycleMigrationRequired(): HttpError {
  return new HttpError(409, ATTEMPT_LIFECYCLE_MIGRATION_MESSAGE, undefined, "attempt_lifecycle_migration_required");
}
