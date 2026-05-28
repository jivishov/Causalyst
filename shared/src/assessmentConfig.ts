export const DEFAULT_VOICE_MAX_RECORDING_SEC = 120;
export const DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC = 300;
export const DEFAULT_AUDIO_MAX_BYTES = 25_000_000;
export const DEFAULT_WRITING_ACCEPTED_MIME = ["image/png", "image/jpeg", "application/pdf"] as const;
export const DEFAULT_WRITING_MAX_BYTES = 10_485_760;
export const DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS = 40;

export const SIMULATION_CODE_MODEL_OPTIONS = [
  { id: "openai:gpt-5.5", label: "OpenAI GPT-5.5", provider: "openai" },
  { id: "openai:gpt-5.4", label: "OpenAI GPT-5.4", provider: "openai" },
  { id: "openai:gpt-5.4-mini", label: "OpenAI GPT-5.4 Mini", provider: "openai" },
  { id: "kimi:kimi-k2.6", label: "Kimi K2.6", provider: "kimi" },
  { id: "zai:glm-5v-turbo", label: "Z.AI GLM-5V Turbo", provider: "zai" }
] as const;

export type SimulationCodeModelId = typeof SIMULATION_CODE_MODEL_OPTIONS[number]["id"];
export type SimulationCodeModelProvider = typeof SIMULATION_CODE_MODEL_OPTIONS[number]["provider"];

export const DEFAULT_SIMULATION_CODE_MODEL_ID: SimulationCodeModelId = "openai:gpt-5.5";

export function isSimulationCodeModelId(value: unknown): value is SimulationCodeModelId {
  return typeof value === "string" && SIMULATION_CODE_MODEL_OPTIONS.some((option) => option.id === value);
}

export function getSimulationCodeModelLabel(value: unknown): string {
  const modelId = isSimulationCodeModelId(value) ? value : DEFAULT_SIMULATION_CODE_MODEL_ID;
  return SIMULATION_CODE_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ?? modelId;
}

export function getSimulationCodeModelProvider(value: unknown): SimulationCodeModelProvider {
  const modelId = isSimulationCodeModelId(value) ? value : DEFAULT_SIMULATION_CODE_MODEL_ID;
  return SIMULATION_CODE_MODEL_OPTIONS.find((option) => option.id === modelId)?.provider ?? "openai";
}
