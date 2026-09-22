import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const nonemptyString = value => typeof value === 'string' && value.trim().length > 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export function evaluateGrades(data) {
  if (!isRecord(data) || !['dataset', 'model', 'policyVersion'].every(key => nonemptyString(data[key]))) {
    throw new Error('Identify the reviewed dataset revision, provider model and scoring policy.');
  }
  const thresholds = data.thresholds;
  if (!isRecord(thresholds) || !Number.isFinite(thresholds.maximumMeanAbsoluteError)
    || thresholds.maximumMeanAbsoluteError < 0 || thresholds.maximumMeanAbsoluteError > 100
    || !Number.isInteger(thresholds.minimumCases) || thresholds.minimumCases < 1) {
    throw new Error('Agree and fill in evaluation thresholds before using this release gate.');
  }
  if (!Array.isArray(data.cases) || !data.cases.length || data.cases.some(c => !isRecord(c)
    || !nonemptyString(c.id) || !['writing', 'voice', 'voice_realtime'].includes(c.modality)
    || c.teacherReviewed !== true || !Number.isFinite(c.teacherScore) || !Number.isFinite(c.modelScore)
    || c.teacherScore < 0 || c.teacherScore > 100 || c.modelScore < 0 || c.modelScore > 100
    || typeof c.unsupportedEvidence !== 'boolean' || typeof c.policyViolation !== 'boolean')) {
    throw new Error('Every case requires an ID, scored modality, teacherReviewed: true, valid scores and explicit evidence/policy checks.');
  }
  if (new Set(data.cases.map(c => c.id.trim())).size !== data.cases.length) {
    throw new Error('Evaluation case IDs must be unique; repeated cases cannot increase the sample size.');
  }
  const errors = data.cases.map(c => Math.abs(c.teacherScore - c.modelScore));
  const result = {
    dataset: data.dataset, model: data.model, policyVersion: data.policyVersion,
    count: data.cases.length, meanAbsoluteError: errors.reduce((a,b) => a+b,0)/errors.length,
    maximumAbsoluteError: errors.reduce((maximum, error) => Math.max(maximum, error), 0),
    unsupportedEvidence: data.cases.filter(c => c.unsupportedEvidence).length,
    policyViolations: data.cases.filter(c => c.policyViolation).length
  };
  result.passed = result.count >= thresholds.minimumCases && result.meanAbsoluteError <= thresholds.maximumMeanAbsoluteError
    && result.unsupportedEvidence === 0 && result.policyViolations === 0;
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.argv[2];
  if (!path) throw new Error('Usage: node scripts/evaluate-grades.mjs <teacher-reviewed-results.json>');
  const result = evaluateGrades(JSON.parse(await readFile(path, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
}
