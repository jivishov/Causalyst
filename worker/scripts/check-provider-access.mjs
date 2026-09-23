import OpenAI from 'openai';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/lib/models.ts', import.meta.url), 'utf8');
const model = role => {
  const id = source.match(new RegExp(`\\b${role}: \\{ id: "([^"]+)"`))?.[1];
  if (!id) throw new Error(`Could not identify the configured ${role} model`);
  return id;
};
if (!process.env.OPENAI_API_KEY) throw new Error('Provider secret is not configured');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25000, maxRetries: 0 });
try {
  const roles = ['grading', 'transcription', 'realtimeVoice'];
  for (const role of roles) {
    const id = model(role);
    await client.models.retrieve(id);
    console.log(`Configured ${role} model visible in catalog: ${id}`);
  }
  // One small, synthetic Responses request tests execution of the grading
  // endpoint. Catalog visibility does not establish transcription or Realtime
  // endpoint entitlement. Never log raw provider responses or SDK errors.
  const gradingModel = model('grading');
  const result = await client.responses.create({
    model: gradingModel,
    reasoning: { effort: 'low' },
    max_output_tokens: 384,
    store: false,
    input: 'Answer with the single word OK.'
  });
  if (result.status !== 'completed' || !result.output_text?.trim()) {
    throw new Error('IncompleteSyntheticResponse');
  }
  console.log(`Synthetic Responses request completed. Requested: ${gradingModel}; returned: ${result.model}.`);
} catch (error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status <= 599 ? error.status : 'none';
  // Do not emit SDK error messages, bodies, request IDs, headers, or stacks.
  console.error(`Provider access check failed; HTTP status: ${status}.`);
  process.exitCode = 1;
}
