import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error This standalone Node command is a JavaScript module.
import { runGradeEvaluation } from "../../scripts/run-grade-evaluation.mjs";

let folder = "";
afterEach(async () => { if (folder) await rm(folder, { recursive: true, force: true }); folder = ""; });
const digest = (content: Buffer | string) => createHash("sha256").update(content).digest("hex");

async function fixture() {
  folder = await mkdtemp(join(tmpdir(), "causalyst-validator-only-"));
  const assets = [Buffer.from("%PDF-1.4\nsynthetic validator bytes"),
    Buffer.from("RIFF0000WAVEsynthetic validator bytes"),
    Buffer.from(JSON.stringify({ sealedTranscript: "Student: gas and mass", continuityDiagnostics: { gapCount: 0 } }))];
  const modalities = ["writing", "voice", "voice_realtime"];
  const cases = await Promise.all(modalities.map(async (modality, index) => {
    const assetPath = join(folder, `asset-${index}`);
    await writeFile(assetPath, assets[index]);
    return { id: `case-${index}`, modality, teacherReviewed: true,
      teacherReviewedAt: index === 2 ? "2026-01-01T00:03:00.000Z" : "2026-01-01T00:01:00.000Z",
      teacherReviewMode: index === 2 ? "blinded_post_model" : "pre_model",
      blindedReview: index === 2,
      teacherScore: [60, 80, 90][index], expectedCapIds: index === 0 ? ["no_reason"] : [],
      requiredAssetKind: ["handwritten_pdf", "recorded_wav", "realtime_checkpoint_json"][index],
      assetPath, assetSha256: digest(assets[index]) };
  }));
  const packet = { dataset: "synthetic-validator-only", policyVersion: "rubric-v2",
    thresholds: { minimumCases: 3,
      minimumCasesByModality: { writing: 1, voice: 1, voice_realtime: 1 },
      maximumMeanAbsoluteErrorByModality: { writing: 5, voice: 5, voice_realtime: 5 },
      minimumSafetyCases: 1, maximumMeanAbsoluteError: 5, maximumAbsoluteError: 5 },
    assessment: { syntheticOnly: true, rubric: [{ id: "gas", name: "Gas", maxPoints: 10, description: "Test only" }],
      scoringPolicy: { mode: "capped", caps: [{ id: "no_reason", maximumPercent: 60, condition: "Test only" }] } },
    cases, safetyCases: [{ id: "no-audio", modality: "voice", teacherReviewed: true,
      teacherReviewedAt: "2026-01-01T00:01:00.000Z", expectedOutcome: "no_grade", reason: "No speech" }] };
  const packetPath = join(folder, "packet.json");
  await writeFile(packetPath, JSON.stringify(packet));
  const { packetSha256 } = await runGradeEvaluation(packetPath);
  const results = { packetSha256, model: "fixture-only", policyVersion: "rubric-v2",
    cases: cases.map((c, index) => ({ id: c.id, modelScore: c.teacherScore,
      modelGradedAt: "2026-01-01T00:02:00.000Z", modelRevealedAt: index === 2 ? "2026-01-01T00:04:00.000Z" : undefined,
      appliedCapIds: index === 0 ? ["no_reason"] : [], unsupportedEvidence: false, policyViolation: false })),
    safetyCases: [{ id: "no-audio", modelOutcome: "no_grade", modelObservedAt: "2026-01-01T00:02:00.000Z" }] };
  const resultPath = join(folder, "results.json");
  await writeFile(resultPath, JSON.stringify(results));
  return { packetPath, resultPath, packet, results, assets };
}

describe("private grade packet importer (synthetic validator fixtures only)", () => {
  it("imports reviewed files, checks modality metrics and requires the scoring cap", async () => {
    const data = await fixture();
    expect(await runGradeEvaluation(data.packetPath, data.resultPath)).toMatchObject({
      passed: true, count: 3, modalityCounts: { writing: 1, voice: 1, voice_realtime: 1 } });
    data.results.cases[0].appliedCapIds = [];
    await writeFile(data.resultPath, JSON.stringify(data.results));
    expect(await runGradeEvaluation(data.packetPath, data.resultPath)).toMatchObject({
      passed: false, policyViolations: 1 });
  });
  it("refuses changed evidence and impossible teacher/model chronology", async () => {
    const data = await fixture();
    data.results.cases[0].modelGradedAt = "2026-01-01T00:00:00.000Z";
    await writeFile(data.resultPath, JSON.stringify(data.results));
    await expect(runGradeEvaluation(data.packetPath, data.resultPath)).rejects.toThrow(/timestamps contradict/);
    data.packet.cases[0].assetSha256 = digest("different bytes");
    await writeFile(data.packetPath, JSON.stringify(data.packet));
    await expect(runGradeEvaluation(data.packetPath)).rejects.toThrow(/hash differs/);
  });
});
