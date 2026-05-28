import {
  DEFAULT_AUDIO_MAX_BYTES,
  DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC,
  DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS,
  DEFAULT_VOICE_MAX_RECORDING_SEC,
  DEFAULT_WRITING_ACCEPTED_MIME,
  DEFAULT_WRITING_MAX_BYTES
} from "@alt-assessment/shared";

export function resolveWritingAcceptedMime(config: Record<string, unknown>): string[] {
  const configured = Array.isArray(config.acceptedMime)
    ? config.acceptedMime.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const normalized = normalizeMimeList(configured);
  if (normalized.length > 0) return normalized;
  return normalizeMimeList([...DEFAULT_WRITING_ACCEPTED_MIME]);
}

export function resolveWritingMaxBytes(config: Record<string, unknown>): number {
  const value = config.maxBytes;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_WRITING_MAX_BYTES;
  }
  return Math.round(value);
}

export function resolveSimulationMinDescriptionChars(config: Record<string, unknown>): number {
  const value = config.minDescriptionChars;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS;
  }
  return Math.round(value);
}

export function resolveVoiceMaxRecordingSec(config: Record<string, unknown>): number {
  const value = config.maxRecordingSec;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_VOICE_MAX_RECORDING_SEC;
  }
  return Math.round(value);
}

export function resolveAudioMaxBytes(config: Record<string, unknown>): number {
  const value = config.maxAudioBytes;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_AUDIO_MAX_BYTES;
  }
  return Math.round(value);
}

export function resolveRealtimeVoiceMaxSessionSec(config: Record<string, unknown>): number {
  const value = config.maxSessionSec;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC;
  }
  return Math.min(1800, Math.max(30, Math.round(value)));
}

export function isAcceptedWritingFile(file: Pick<File, "type">): boolean {
  const normalized = normalizeMimeType(file.type);
  return normalizeMimeList([...DEFAULT_WRITING_ACCEPTED_MIME]).includes(normalized);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function normalizeMimeList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = normalizeMimeType(value);
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}

function normalizeMimeType(value: string): string {
  return value.trim().toLowerCase();
}
