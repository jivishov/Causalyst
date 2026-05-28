import { DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS } from "./assessmentConfig";
import type { SimulationSpec, SourceSpan } from "./types";

export interface SimulationValidationResult {
  valid: boolean;
  errors: string[];
}

export const LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH = 1200;
export const LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT = 800;
export const SIMULATION_HTML_VIEWPORT_WIDTH = 1024;
export const SIMULATION_HTML_VIEWPORT_HEIGHT = 640;
export const LEGACY_SIMULATION_HTML_VIEWPORT = {
  width: LEGACY_SIMULATION_HTML_VIEWPORT_WIDTH,
  height: LEGACY_SIMULATION_HTML_VIEWPORT_HEIGHT
} as const;
export const SIMULATION_HTML_VIEWPORT = {
  width: SIMULATION_HTML_VIEWPORT_WIDTH,
  height: SIMULATION_HTML_VIEWPORT_HEIGHT
} as const;
export const SIMULATION_INSUFFICIENT_DETAIL_MESSAGE = "Not enough student-provided detail to generate a sketch. No sketch was created.";
export const SIMULATION_READINESS_UNAVAILABLE_MESSAGE = "We could not check whether this description is ready. Please try again.";

export type SimulationReadinessDecision = "allow" | "block" | "needs_classifier";
export type SimulationReadinessReasonCode = "too_short" | "prompt_echo" | "insufficient_detail" | "unrelated" | "allow";

export interface SimulationReadinessSignals {
  descriptionLength: number;
  minimumDescriptionChars: number;
  uniqueSubstantiveTokenCount: number;
  uniqueSubjectTokenCount: number;
  promptEchoRatio: number;
  repeatedSentenceRatio: number;
  hasDrawableSubject: boolean;
  hasExplicitRelationship: boolean;
  isMostlyPromptEcho: boolean;
  isHighlyRepetitive: boolean;
  nonEvidencePhraseCount: number;
}

export interface SimulationReadinessAssessment {
  decision: SimulationReadinessDecision;
  reasonCode: SimulationReadinessReasonCode;
  signals: SimulationReadinessSignals;
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "to",
  "with"
]);

const NON_EVIDENCE_TOKENS = new Set([
  "case",
  "description",
  "describe",
  "life",
  "prompt",
  "real",
  "relate",
  "related",
  "rubric",
  "show",
  "simulate",
  "simulation"
]);

const ACTION_OR_RELATIONSHIP_TOKENS = new Set([
  "affect",
  "affects",
  "align",
  "aligns",
  "because",
  "become",
  "becomes",
  "change",
  "changes",
  "changing",
  "condense",
  "condenses",
  "condensing",
  "constant",
  "convert",
  "converts",
  "cool",
  "cools",
  "decrease",
  "decreases",
  "decreasing",
  "divide",
  "divides",
  "dividing",
  "evaporate",
  "evaporates",
  "evaporating",
  "fall",
  "falls",
  "form",
  "forms",
  "goes",
  "heat",
  "heats",
  "higher",
  "increase",
  "increases",
  "increasing",
  "leads",
  "lower",
  "move",
  "moves",
  "moving",
  "proportional",
  "react",
  "reacts",
  "replicate",
  "replicates",
  "return",
  "returns",
  "rise",
  "rises",
  "separate",
  "separates",
  "separated",
  "turn",
  "turns",
  "when"
]);

const NON_EVIDENCE_PHRASES = [
  "real life case",
  "related to",
  "show how",
  "simulate the",
  "simulate how",
  "it is related",
  "is related"
];

const RELATIONSHIP_PHRASES = [
  "because",
  "causes",
  "goes down",
  "goes up",
  "higher than",
  "leads to",
  "less than",
  "lower than",
  "more than",
  "turns into",
  "when"
];

export function assessSimulationDescriptionReadiness(input: {
  description: string;
  assessmentPrompt?: string | null;
  config?: Record<string, unknown>;
}): SimulationReadinessAssessment {
  const minimumDescriptionChars = resolveSimulationMinimumDescriptionChars(input.config ?? {});
  const description = normalizeWhitespace(input.description);
  const descriptionLength = description.length;
  const descriptionTokens = tokenize(description);
  const promptTokenSet = new Set(tokenize(input.assessmentPrompt ?? ""));
  const substantiveTokens = descriptionTokens.filter(isSubstantiveToken);
  const uniqueSubstantiveTokens = unique(substantiveTokens);
  const subjectTokens = uniqueSubstantiveTokens.filter((token) => !ACTION_OR_RELATIONSHIP_TOKENS.has(token));
  const repeatedSentenceRatio = calculateRepeatedSentenceRatio(description);
  const promptEchoRatio = calculatePromptEchoRatio(uniqueSubstantiveTokens, promptTokenSet);
  const nonEvidencePhraseCount = countPhrases(description, NON_EVIDENCE_PHRASES);
  const hasDrawableSubject = subjectTokens.length > 0;
  const hasExplicitRelationship = hasRelationship(description, uniqueSubstantiveTokens);
  const isHighlyRepetitive = repeatedSentenceRatio >= 0.34;
  const isMostlyPromptEcho = promptTokenSet.size >= 4 && promptEchoRatio >= 0.8;
  const signals: SimulationReadinessSignals = {
    descriptionLength,
    minimumDescriptionChars,
    uniqueSubstantiveTokenCount: uniqueSubstantiveTokens.length,
    uniqueSubjectTokenCount: subjectTokens.length,
    promptEchoRatio,
    repeatedSentenceRatio,
    hasDrawableSubject,
    hasExplicitRelationship,
    isMostlyPromptEcho,
    isHighlyRepetitive,
    nonEvidencePhraseCount
  };

  if (descriptionLength < minimumDescriptionChars) {
    return { decision: "block", reasonCode: "too_short", signals };
  }
  if (uniqueSubstantiveTokens.length < 3) {
    return { decision: "block", reasonCode: "insufficient_detail", signals };
  }
  if (!hasDrawableSubject || !hasExplicitRelationship) {
    return { decision: "block", reasonCode: isMostlyPromptEcho ? "prompt_echo" : "insufficient_detail", signals };
  }
  if (isMostlyPromptEcho || (isHighlyRepetitive && nonEvidencePhraseCount > 0)) {
    return { decision: "needs_classifier", reasonCode: "prompt_echo", signals };
  }
  if (promptTokenSet.size >= 4 && promptEchoRatio < 0.2) {
    return { decision: "needs_classifier", reasonCode: "unrelated", signals };
  }
  if (uniqueSubstantiveTokens.length < 5) {
    return { decision: "needs_classifier", reasonCode: "insufficient_detail", signals };
  }
  return { decision: "allow", reasonCode: "allow", signals };
}

export function validateSourceSpan(description: string, source: SourceSpan, label: string): string | null {
  if (!Number.isInteger(source.start) || !Number.isInteger(source.end)) {
    return `${label}: source start/end must be integers`;
  }
  if (source.start < 0 || source.end < source.start || source.end > description.length) {
    return `${label}: source span is outside the description`;
  }
  if (description.slice(source.start, source.end) !== source.quote) {
    return `${label}: source quote does not match description.slice(start, end)`;
  }
  return null;
}

export function validateSimulationSources(description: string, spec: SimulationSpec): SimulationValidationResult {
  const errors: string[] = [];

  for (const entity of spec.entities) pushSourceError(errors, description, entity.source, `entity:${entity.id}`);
  for (const label of spec.labels) pushSourceError(errors, description, label.source, `label:${label.id}`);
  for (const position of spec.positions) pushSourceError(errors, description, position.source, `position:${position.id}`);
  for (const movement of spec.movements) pushSourceError(errors, description, movement.source, `movement:${movement.id}`);
  for (const interaction of spec.interactions) pushSourceError(errors, description, interaction.source, `interaction:${interaction.id}`);
  for (const change of spec.stateChanges) pushSourceError(errors, description, change.source, `stateChange:${change.id}`);
  for (const step of spec.timelineSteps) pushSourceError(errors, description, step.source, `timelineStep:${step.id}`);

  const entityIds = new Set(spec.entities.map((entity) => entity.id));
  for (const position of spec.positions) {
    if (!entityIds.has(position.entityId)) errors.push(`position:${position.id}: unknown entityId ${position.entityId}`);
  }
  for (const movement of spec.movements) {
    if (!entityIds.has(movement.entityId)) errors.push(`movement:${movement.id}: unknown entityId ${movement.entityId}`);
  }
  for (const interaction of spec.interactions) {
    if (!entityIds.has(interaction.actorEntityId)) errors.push(`interaction:${interaction.id}: unknown actorEntityId ${interaction.actorEntityId}`);
    if (!entityIds.has(interaction.targetEntityId)) errors.push(`interaction:${interaction.id}: unknown targetEntityId ${interaction.targetEntityId}`);
  }
  for (const change of spec.stateChanges) {
    if (!entityIds.has(change.entityId)) errors.push(`stateChange:${change.id}: unknown entityId ${change.entityId}`);
  }

  return { valid: errors.length === 0, errors };
}

export function simulationSpecSchema() {
  const sourceSchema = {
    type: "object",
    additionalProperties: false,
    required: ["quote", "start", "end"],
    properties: {
      quote: { type: "string" },
      start: { type: "integer", minimum: 0 },
      end: { type: "integer", minimum: 0 }
    }
  };

  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "descriptionSummary", "entities", "labels", "positions", "movements", "interactions", "stateChanges", "timelineSteps"],
    properties: {
      title: { type: "string" },
      descriptionSummary: { type: "string" },
      entities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "name", "shape", "color", "source"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["entity"] },
            name: { type: "string" },
            shape: { type: "string", enum: ["circle", "square", "triangle", "line", "cell", "compound", "custom"] },
            color: { type: "string" },
            source: sourceSchema
          }
        }
      },
      labels: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "entityId", "text", "source"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["label"] },
            entityId: { anyOf: [{ type: "string" }, { type: "null" }] },
            text: { type: "string" },
            source: sourceSchema
          }
        }
      },
      positions: primitiveWithEntity("position", sourceSchema, {
        x: { type: "number" },
        y: { type: "number" }
      }),
      movements: primitiveWithEntity("movement", sourceSchema, {
        fromX: { type: "number" },
        fromY: { type: "number" },
        toX: { type: "number" },
        toY: { type: "number" },
        durationMs: { type: "integer", minimum: 250 }
      }),
      interactions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "actorEntityId", "targetEntityId", "action", "source"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["interaction"] },
            actorEntityId: { type: "string" },
            targetEntityId: { type: "string" },
            action: { type: "string" },
            source: sourceSchema
          }
        }
      },
      stateChanges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "entityId", "property", "from", "to", "source"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["stateChange"] },
            entityId: { type: "string" },
            property: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            source: sourceSchema
          }
        }
      },
      timelineSteps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "order", "text", "source"],
          properties: {
            id: { type: "string" },
            kind: { type: "string", enum: ["timelineStep"] },
            order: { type: "integer" },
            text: { type: "string" },
            source: sourceSchema
          }
        }
      }
    }
  } as const;
}

function primitiveWithEntity(kind: string, sourceSchema: object, extraProperties: Record<string, object>) {
  return {
    type: "array",
    items: {
      type: "object",
      additionalProperties: false,
      required: ["id", "kind", "entityId", ...Object.keys(extraProperties), "source"],
      properties: {
        id: { type: "string" },
        kind: { type: "string", enum: [kind] },
        entityId: { type: "string" },
        ...extraProperties,
        source: sourceSchema
      }
    }
  };
}

function pushSourceError(errors: string[], description: string, source: SourceSpan, label: string): void {
  const error = validateSourceSpan(description, source, label);
  if (error) errors.push(error);
}

function resolveSimulationMinimumDescriptionChars(config: Record<string, unknown>): number {
  const value = config.minDescriptionChars;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS;
  }
  return Math.round(value);
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) ?? [];
}

function isSubstantiveToken(token: string): boolean {
  return token.length >= 2 && !STOPWORDS.has(token) && !NON_EVIDENCE_TOKENS.has(token);
}

function unique(tokens: string[]): string[] {
  return Array.from(new Set(tokens));
}

function calculatePromptEchoRatio(tokens: string[], promptTokenSet: Set<string>): number {
  if (tokens.length === 0 || promptTokenSet.size === 0) return 0;
  return tokens.filter((token) => promptTokenSet.has(token)).length / tokens.length;
}

function calculateRepeatedSentenceRatio(description: string): number {
  const sentences = description
    .toLowerCase()
    .split(/[.!?]+/)
    .map((sentence) => normalizeWhitespace(sentence))
    .filter(Boolean);
  if (sentences.length <= 1) return 0;
  const uniqueSentences = new Set(sentences);
  return (sentences.length - uniqueSentences.size) / sentences.length;
}

function countPhrases(description: string, phrases: string[]): number {
  const normalized = description.toLowerCase();
  return phrases.reduce((count, phrase) => count + (normalized.includes(phrase) ? 1 : 0), 0);
}

function hasRelationship(description: string, tokens: string[]): boolean {
  const normalized = description.toLowerCase();
  if (RELATIONSHIP_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  return tokens.some((token) => ACTION_OR_RELATIONSHIP_TOKENS.has(token));
}
