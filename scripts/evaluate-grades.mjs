import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const nonemptyString = value => typeof value === 'string' && value.trim().length > 0;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const modalities = ['writing', 'voice', 'voice_realtime'];

export function evaluateGrades(data) {
  if (!isRecord(data) || !['dataset', 'model', 'policyVersion'].every(key => nonemptyString(data[key]))) {
    throw new Error('Identify the reviewed dataset revision, provider model and scoring policy.');
  }
  const thresholds = data.thresholds;
  if (!isRecord(thresholds) || !Number.isFinite(thresholds.maximumMeanAbsoluteError)
    || thresholds.maximumMeanAbsoluteError < 0 || thresholds.maximumMeanAbsoluteError > 100
    || !Number.isFinite(thresholds.maximumAbsoluteError) || thresholds.maximumAbsoluteError < 0 || thresholds.maximumAbsoluteError > 100
    || !Number.isInteger(thresholds.minimumCases) || thresholds.minimumCases < 1
    || !isRecord(thresholds.minimumCasesByModality)
    || modalities.some(m => !Number.isInteger(thresholds.minimumCasesByModality[m]) || thresholds.minimumCasesByModality[m] < 0)
    || Object.keys(thresholds.minimumCasesByModality).length !== modalities.length
    || !isRecord(thresholds.maximumMeanAbsoluteErrorByModality)
    || Object.keys(thresholds.maximumMeanAbsoluteErrorByModality).length !== modalities.length
    || modalities.some(m => thresholds.minimumCasesByModality[m] > 0
      ? !Number.isFinite(thresholds.maximumMeanAbsoluteErrorByModality[m])
        || thresholds.maximumMeanAbsoluteErrorByModality[m] < 0 || thresholds.maximumMeanAbsoluteErrorByModality[m] > 100
      : thresholds.maximumMeanAbsoluteErrorByModality[m] !== null)
    || modalities.reduce((sum, m) => sum + thresholds.minimumCasesByModality[m], 0) < 1
    || !Number.isInteger(thresholds.minimumSafetyCases) || thresholds.minimumSafetyCases < 1) {
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
  if (!Array.isArray(data.safetyCases) || data.safetyCases.some(c => !isRecord(c)
    || !nonemptyString(c.id) || !modalities.includes(c.modality) || c.teacherReviewed !== true
    || c.expectedOutcome !== 'no_grade' || !['no_grade', 'graded'].includes(c.modelOutcome)
    || !nonemptyString(c.reason))) {
    throw new Error('Safety cases need a reviewed no-grade expectation, a provider outcome and a reason.');
  }
  if (new Set([...data.cases, ...data.safetyCases].map(c => c.id.trim())).size !== data.cases.length + data.safetyCases.length) {
    throw new Error('Scored and safety case IDs must be unique.');
  }
  const modalityCounts = Object.fromEntries(modalities.map(m => [m, data.cases.filter(c => c.modality === m).length]));
  const modalityMeanAbsoluteErrors = Object.fromEntries(modalities.map(m => {
    const forModality = data.cases.filter(c => c.modality === m);
    return [m, forModality.length
      ? forModality.reduce((sum, c) => sum + Math.abs(c.teacherScore - c.modelScore), 0) / forModality.length
      : null];
  }));
  const result = {
    dataset: data.dataset, model: data.model, policyVersion: data.policyVersion,
    count: data.cases.length, meanAbsoluteError: errors.reduce((a,b) => a+b,0)/errors.length,
    maximumAbsoluteError: errors.reduce((maximum, error) => Math.max(maximum, error), 0),
    modalityCounts, modalityMeanAbsoluteErrors, safetyCount: data.safetyCases.length,
    unexpectedSafetyGrades: data.safetyCases.filter(c => c.modelOutcome !== 'no_grade').length,
    unsupportedEvidence: data.cases.filter(c => c.unsupportedEvidence).length,
    policyViolations: data.cases.filter(c => c.policyViolation).length
  };
  result.passed = result.count >= thresholds.minimumCases && result.meanAbsoluteError <= thresholds.maximumMeanAbsoluteError
    && result.maximumAbsoluteError <= thresholds.maximumAbsoluteError
    && modalities.every(m => modalityCounts[m] >= thresholds.minimumCasesByModality[m])
    && modalities.every(m => thresholds.minimumCasesByModality[m] === 0
      || modalityMeanAbsoluteErrors[m] <= thresholds.maximumMeanAbsoluteErrorByModality[m])
    && result.safetyCount >= thresholds.minimumSafetyCases && result.unexpectedSafetyGrades === 0
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
