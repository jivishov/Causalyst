import type { AppDatabaseClient } from "./database";
import { HttpError } from "./http";
export async function reserveAiBudget(db: AppDatabaseClient, userId: string, attemptId: string, operation: string, units: number): Promise<void> {
  const { error } = await db.rpc("consume_ai_budget", { p_user_id: userId, p_attempt_id: attemptId, p_operation: operation, p_units: units });
  if (error) throw new HttpError(error.code === "P0001" ? 429 : error.code === "23514" ? 409 : 503,
    error.code === "P0001" ? "Daily AI allowance reached. Ask your teacher for help or return tomorrow." : "Could not reserve AI work", error.message);
}
export function boundStudentText(value: string): void {
  if (value.length > 12000) throw new HttpError(413, "Student description is limited to 12,000 characters");
}
