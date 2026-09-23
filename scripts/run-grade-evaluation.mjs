import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateGrades } from './evaluate-grades.mjs';

const repo = resolve(fileURLToPath(new URL('../', import.meta.url)));
const requiredKinds = { writing: 'handwritten_pdf', voice: 'recorded_wav', voice_realtime: 'realtime_checkpoint_json' };
const requiredDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sameIds = (left, right) => left.length === right.length &&
  new Set(left).size === left.length && new Set(right).size === right.length &&
  left.every(id => right.includes(id));

async function checkAsset(item) {
  assert(item.requiredAssetKind === requiredKinds[item.modality], `${item.id}: asset kind does not match modality`);
  assert(typeof item.assetPath === 'string' && isAbsolute(item.assetPath), `${item.id}: provide an absolute local path to private evidence`);
  const path = await realpath(resolve(item.assetPath));
  const actualRepo = await realpath(repo);
  assert(path !== actualRepo && !path.startsWith(actualRepo + '/'), `${item.id}: keep review evidence outside the public repository`);
  assert(typeof item.assetSha256 === 'string' && /^[a-f0-9]{64}$/.test(item.assetSha256), `${item.id}: provide the SHA-256 of the evidence file`);
  const info = await stat(path);
  assert(info.isFile() && info.size > 0 && info.size <= 10 * 1024 * 1024, `${item.id}: evidence file is empty, missing or too large`);
  const bytes = await readFile(path);
  assert(hash(bytes) === item.assetSha256, `${item.id}: evidence file hash differs from the teacher-reviewed file`);
  if (item.requiredAssetKind === 'handwritten_pdf') {
    assert(bytes.subarray(0, 5).toString() === '%PDF-', `${item.id}: expected a PDF of actual handwriting`);
  } else if (item.requiredAssetKind === 'recorded_wav') {
    assert(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WAVE', `${item.id}: expected a WAV recording`);
  } else {
    const capture = JSON.parse(bytes.toString('utf8'));
    assert(typeof capture.sealedTranscript === 'string' && capture.sealedTranscript.trim()
      && capture.continuityDiagnostics && typeof capture.continuityDiagnostics === 'object',
      `${item.id}: expected a private sealed realtime checkpoint and diagnostics`);
  }
}

async function readPacket(path) {
  const bytes = await readFile(path);
  const packet = JSON.parse(bytes.toString('utf8'));
  assert(Array.isArray(packet.cases) && packet.cases.length > 0 && Array.isArray(packet.safetyCases), 'Review packet needs scored and safety cases');
  assert(packet.assessment?.syntheticOnly === true && Array.isArray(packet.assessment.rubric) && packet.assessment.rubric.length > 0,
    'This command only accepts a synthetic, rubric-backed packet');
  // Validate thresholds before model execution; nulls cannot silently pass.
  const sample = packet.cases.map(c => ({ id: c.id, modality: c.modality, teacherReviewed: true,
    teacherScore: 0, modelScore: 0, unsupportedEvidence: false, policyViolation: false }));
  const planned = evaluateGrades({ dataset: packet.dataset, model: 'teacher-only-threshold-check', policyVersion: packet.policyVersion,
    thresholds: packet.thresholds, cases: sample,
    safetyCases: packet.safetyCases.map(c => ({ id: c.id, modality: c.modality, teacherReviewed: true,
      expectedOutcome: c.expectedOutcome, modelOutcome: 'no_grade', reason: c.reason })) });
  assert(planned.passed, 'Predeclared minimum sample/coverage cannot be met by this packet');
  const capIds = new Set(packet.assessment.scoringPolicy?.caps?.map(cap => cap.id) ?? []);
  for (const c of packet.cases) {
    assert(Array.isArray(c.expectedCapIds) && c.expectedCapIds.every(id => capIds.has(id)),
      `${c.id}: expected scoring caps must match the assessment policy`);
    assert(c.teacherReviewed === true && Number.isFinite(c.teacherScore) && c.teacherScore >= 0 && c.teacherScore <= 100
      && requiredDate(c.teacherReviewedAt), `${c.id}: a teacher must independently score evidence and date the review`);
    assert(c.modality === 'voice_realtime'
      ? c.teacherReviewMode === 'blinded_post_model' && c.blindedReview === true
      : c.teacherReviewMode === 'pre_model', `${c.id}: record the actual independent teacher review workflow`);
    await checkAsset(c);
  }
  for (const c of packet.safetyCases) {
    assert(c.teacherReviewed === true && requiredDate(c.teacherReviewedAt), `${c.id}: a teacher must review the no-grade expectation first`);
  }
  return { packet, packetSha256: hash(bytes) };
}

export async function runGradeEvaluation(packetPath, resultPath) {
  const { packet, packetSha256 } = await readPacket(packetPath);
  if (!resultPath) return { reviewPacketValid: true, packetSha256, scoredCases: packet.cases.length, safetyCases: packet.safetyCases.length };
  const results = JSON.parse(await readFile(resultPath, 'utf8'));
  assert(results.packetSha256 === packetSha256, 'The teacher review packet changed after its review-packet hash was recorded');
  assert(results.policyVersion === packet.policyVersion && typeof results.model === 'string' && results.model.trim() &&
    !results.model.startsWith('Record '), 'Provide the actual configured/returned provider model and policy');
  assert(Array.isArray(results.cases) && sameIds(packet.cases.map(c => c.id), results.cases.map(c => c.id)),
    'Model results must match every scored case ID exactly');
  assert(Array.isArray(results.safetyCases) && sameIds(packet.safetyCases.map(c => c.id), results.safetyCases.map(c => c.id)),
    'Model results must match every no-grade case ID exactly');
  const byId = new Map(results.cases.map(c => [c.id, c]));
  const safetyById = new Map(results.safetyCases.map(c => [c.id, c]));
  const capIds = new Set(packet.assessment.scoringPolicy?.caps?.map(cap => cap.id) ?? []);
  const cases = packet.cases.map(c => {
    const model = byId.get(c.id);
    assert(requiredDate(model.modelGradedAt) && (c.teacherReviewMode === 'pre_model'
      ? Date.parse(model.modelGradedAt) > Date.parse(c.teacherReviewedAt)
      : Date.parse(model.modelGradedAt) < Date.parse(c.teacherReviewedAt)),
    `${c.id}: the model/teacher timestamps contradict the selected blinded review workflow`);
    if (c.teacherReviewMode === 'blinded_post_model') {
      assert(requiredDate(model.modelRevealedAt) && Date.parse(model.modelRevealedAt) > Date.parse(c.teacherReviewedAt),
        `${c.id}: record reveal of model feedback only after blinded teacher scoring`);
    }
    assert(Array.isArray(model.appliedCapIds) && model.appliedCapIds.every(id => capIds.has(id)),
      `${c.id}: model cap IDs must match the frozen policy`);
    assert(typeof model.policyViolation === 'boolean', `${c.id}: review whether the model violated the policy`);
    const requiredCapsApplied = c.expectedCapIds.every(id => model.appliedCapIds.includes(id));
    const appliedCapsRespected = model.appliedCapIds.every(id => model.modelScore <=
      packet.assessment.scoringPolicy.caps.find(cap => cap.id === id).maximumPercent);
    return { id: c.id, modality: c.modality, teacherReviewed: true, teacherScore: c.teacherScore,
      modelScore: model.modelScore, unsupportedEvidence: model.unsupportedEvidence,
      policyViolation: model.policyViolation || !requiredCapsApplied || !appliedCapsRespected };
  });
  const safetyCases = packet.safetyCases.map(c => {
    const model = safetyById.get(c.id);
    assert(requiredDate(model.modelObservedAt) && Date.parse(model.modelObservedAt) > Date.parse(c.teacherReviewedAt),
      `${c.id}: safety observation must postdate the teacher review`);
    return { id: c.id, modality: c.modality, teacherReviewed: true, expectedOutcome: c.expectedOutcome,
      modelOutcome: model.modelOutcome, reason: c.reason };
  });
  return evaluateGrades({ dataset: packet.dataset, model: results.model, policyVersion: packet.policyVersion,
    thresholds: packet.thresholds, cases, safetyCases });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || process.argv.length > 4) throw new Error('Usage: node scripts/run-grade-evaluation.mjs <review-packet.json> [model-results.json]');
  const result = await runGradeEvaluation(process.argv[2], process.argv[3]);
  console.log(JSON.stringify(result, null, 2));
  if (result.passed === false) process.exitCode = 1;
}
