import { readFile } from 'node:fs/promises';
const path = process.argv[2];
if (!path) throw new Error('Usage: node scripts/evaluate-grades.mjs <teacher-reviewed-results.json>');
const data = JSON.parse(await readFile(path, 'utf8'));
const thresholds = data.thresholds;
if (!thresholds || !Number.isFinite(thresholds.maximumMeanAbsoluteError) || !Number.isFinite(thresholds.minimumCases) || thresholds.minimumCases < 1) {
  throw new Error('Agree and fill in evaluation thresholds before using this release gate.');
}
if (!Array.isArray(data.cases) || !data.cases.length || data.cases.some(c => !c.teacherReviewed || !Number.isFinite(c.teacherScore) || !Number.isFinite(c.modelScore) || c.teacherScore < 0 || c.teacherScore > 100 || c.modelScore < 0 || c.modelScore > 100 || typeof c.unsupportedEvidence !== 'boolean' || typeof c.policyViolation !== 'boolean')) {
  throw new Error('Every case requires teacher-reviewed scores and explicit evidence/policy checks. No synthetic scores are supplied by this harness.');
}
const errors = data.cases.map(c => Math.abs(c.teacherScore - c.modelScore));
const result = {
  dataset: data.dataset, model: data.model, policyVersion: data.policyVersion,
  count: data.cases.length, meanAbsoluteError: errors.reduce((a,b) => a+b,0)/errors.length,
  maximumAbsoluteError: Math.max(...errors), unsupportedEvidence: data.cases.filter(c => c.unsupportedEvidence).length,
  policyViolations: data.cases.filter(c => c.policyViolation).length
};
result.passed = result.count >= thresholds.minimumCases && result.meanAbsoluteError <= thresholds.maximumMeanAbsoluteError && result.unsupportedEvidence === 0 && result.policyViolations === 0;
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
