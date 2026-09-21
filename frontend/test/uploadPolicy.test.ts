import { describe, expect, it } from "vitest";
import { DEFAULT_AUDIO_MAX_BYTES, DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC, DEFAULT_VOICE_MAX_RECORDING_SEC } from "@alt-assessment/shared";
import { formatBytes, isAcceptedWritingFile, resolveAudioMaxBytes, resolveRealtimeVoiceMaxSessionSec, resolveVoiceMaxRecordingSec, resolveWritingAcceptedMime } from "../src/lib/uploadPolicy";

describe("upload policy", () => {
  it("accepts image and PDF writing artifacts", () => {
    expect(isAcceptedWritingFile({ type: "image/png" })).toBe(true);
    expect(isAcceptedWritingFile({ type: "image/jpeg" })).toBe(true);
    expect(isAcceptedWritingFile({ type: "application/pdf" })).toBe(true);
    expect(isAcceptedWritingFile({ type: "text/plain" })).toBe(false);
  });

  it("formats byte sizes for preview copy", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(2_097_152)).toBe("2.0 MB");
  });

  it("normalizes configured writing mime lists", () => {
    expect(resolveWritingAcceptedMime({
      acceptedMime: [" image/PNG ", "application/pdf", "APPLICATION/PDF", ""]
    })).toEqual(["image/png", "application/pdf"]);
  });

  it("falls back to default voice max recording seconds when config value is invalid", () => {
    expect(resolveVoiceMaxRecordingSec({ maxRecordingSec: "75" })).toBe(DEFAULT_VOICE_MAX_RECORDING_SEC);
    expect(resolveVoiceMaxRecordingSec({ maxRecordingSec: -10 })).toBe(DEFAULT_VOICE_MAX_RECORDING_SEC);
    expect(resolveVoiceMaxRecordingSec({ maxRecordingSec: 89.6 })).toBe(90);
  });

  it("falls back to the default audio byte cap when config value is invalid", () => {
    expect(resolveAudioMaxBytes({ maxAudioBytes: "25000000" })).toBe(DEFAULT_AUDIO_MAX_BYTES);
    expect(resolveAudioMaxBytes({ maxAudioBytes: 0 })).toBe(DEFAULT_AUDIO_MAX_BYTES);
    expect(resolveAudioMaxBytes({ maxAudioBytes: 12_345.6 })).toBe(12346);
  });

  it("bounds realtime voice session length", () => {
    expect(resolveRealtimeVoiceMaxSessionSec({ maxSessionSec: "300" })).toBe(DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC);
    expect(resolveRealtimeVoiceMaxSessionSec({ maxSessionSec: 12 })).toBe(30);
    expect(resolveRealtimeVoiceMaxSessionSec({ maxSessionSec: 2000 })).toBe(1800);
    expect(resolveRealtimeVoiceMaxSessionSec({ maxSessionSec: 455.5 })).toBe(456);
  });
});
