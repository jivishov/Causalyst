import type { Env } from "./env";
import { HttpError } from "./http";
import type { SimulationGenerationJobRow } from "./simulationJobs";
import type { ModelCatalogEntry } from "./models";

export interface ManagedSimulationInput {
  prompts?: import("@alt-assessment/shared").AiPromptBundle;
  promptRevision?: string;
  job: SimulationGenerationJobRow;
  description: string;
  currentHtml?: string;
  model: ModelCatalogEntry;
}

export function isManagedSimulationJob(job: Pick<SimulationGenerationJobRow, "provider_status">): boolean {
  return job.provider_status?.startsWith("managed_") === true;
}

export function simulationOwner(env: Env, id: string): DurableObjectStub {
  if (!env.SIMULATION_GENERATIONS || !env.SIMULATION_SCHEDULER) {
    throw new HttpError(503, "Simulation generation is temporarily unavailable. Your sketch is saved.");
  }
  return env.SIMULATION_GENERATIONS.get(env.SIMULATION_GENERATIONS.idFromName(id));
}

export function simulationScheduler(env: Env): DurableObjectStub {
  if (!env.SIMULATION_SCHEDULER) throw new HttpError(503, "Simulation generation is temporarily unavailable.");
  return env.SIMULATION_SCHEDULER.get(env.SIMULATION_SCHEDULER.idFromName("simulation-html-v1"));
}

export async function managedRequest(stub: DurableObjectStub, path: string, input?: unknown): Promise<Response> {
  const response = await stub.fetch(new Request(`https://simulation.internal${path}`, input === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input)
  }));
  if (!response.ok) throw new HttpError(503, "Simulation generation is temporarily unavailable. Your sketch is saved.");
  return response;
}
