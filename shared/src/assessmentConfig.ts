export const DEFAULT_VOICE_MAX_RECORDING_SEC = 120;
export const DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC = 300;
export const DEFAULT_AUDIO_MAX_BYTES = 25_000_000;
export const DEFAULT_WRITING_ACCEPTED_MIME = ["image/png", "image/jpeg", "application/pdf"] as const;
export const DEFAULT_WRITING_MAX_BYTES = 10_485_760;
export const DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS = 40;

export const SIMULATION_CODE_MODEL_OPTIONS = [
  // Keep stored assignment IDs stable; the server maps Sol to its current API ID.
  { id: "openai:gpt-5.6-sol", label: "OpenAI GPT-6.1 Sol", provider: "openai" },
  { id: "openai:gpt-5.6-terra", label: "OpenAI GPT-5.6 Terra", provider: "openai" },
  { id: "openai:gpt-5.6-luna", label: "OpenAI GPT-5.6 Luna", provider: "openai" },
  { id: "kimi:kimi-k2.6", label: "Kimi K2.6", provider: "kimi" },
  { id: "zai:glm-5v-turbo", label: "Z.AI GLM-5V Turbo", provider: "zai" }
] as const;

export type SimulationCodeModelProvider = typeof SIMULATION_CODE_MODEL_OPTIONS[number]["provider"];
export type SimulationCodeModelId = `${SimulationCodeModelProvider}:${string}`;

export const DEFAULT_SIMULATION_CODE_MODEL_ID: SimulationCodeModelId = "openai:gpt-5.6-sol";

export function isSimulationCodeModelId(value: unknown): value is SimulationCodeModelId {
  if (["openai:gpt-5.5", "openai:gpt-5.4", "openai:gpt-5.4-mini", "openai:gpt-5.4-pro"].includes(String(value))) return false;
  return typeof value === "string" && /^(openai|kimi|zai):[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

// Resolve saved assessments and requests from older browser tabs without
// advertising retired models or sending their IDs to the provider.
export function resolveSimulationCodeModelId(value: unknown): SimulationCodeModelId | null {
  if (value === "openai:gpt-5.5" || value === "openai:gpt-5.4") return "openai:gpt-5.6-sol";
  if (value === "openai:gpt-5.4-mini") return "openai:gpt-5.6-terra";
  if (isSimulationCodeModelId(value)) return value;
  return null;
}

export function getSimulationCodeModelLabel(value: unknown): string {
  const modelId = resolveSimulationCodeModelId(value) ?? DEFAULT_SIMULATION_CODE_MODEL_ID;
  return SIMULATION_CODE_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ?? modelId;
}

export function getSimulationCodeModelProvider(value: unknown): SimulationCodeModelProvider {
  const modelId = resolveSimulationCodeModelId(value) ?? DEFAULT_SIMULATION_CODE_MODEL_ID;
  return modelId.split(":")[0] as SimulationCodeModelProvider;
}
