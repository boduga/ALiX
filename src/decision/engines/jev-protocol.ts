/**
 * jev-protocol.ts — TypeSafe System One wire protocol.
 *
 * VERIFIED against the official API reference and SDK types (2026-09-22):
 *   - https://docs.typesafe.ai/api.md
 *   - https://docs.typesafe.ai/primitives/choice.md
 *   - https://docs.typesafe.ai/primitives/noul.md
 *   - https://docs.typesafe.ai/sdk/javascript/api/interfaces/SystemOneRequestPayload.md
 *   - https://docs.typesafe.ai/sdk/javascript/api/interfaces/ChoiceResponse.md
 *
 * Shape notes that matter (the earlier hand-rolled guess was wrong on all four):
 *   - `questions` is a MAP keyed by the caller's question id. The id is the key
 *     and is NOT sent to the model; answers come back under the same key.
 *   - A Choice carries `instructions` (the question) and `criteria` (a map of
 *     option -> rubric description), not `prompt` + an options array.
 *   - `answers` is a MAP keyed by question id; answers carry no id field.
 *   - A Noul answer's value field is `noul` (0..1) and has NO confidence; a
 *     Choice answer carries `choice`, `probabilities`, and `confidence`.
 *
 * Score is a real primitive (ordered `criteria` array, 2-10 levels) but is
 * deliberately not modelled here: no ALiX decision uses it yet, and an unused
 * type is speculative surface. Add it when a decision needs a rubric rating.
 */

export const JEV_SYSTEMONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";

/** The wire shape is verified against the official docs (see the header links). */
export const JEV_WIRE_FORMAT_STATUS = "verified-against-docs" as const;

/** Choice accepts up to 255 options; Score 2-10 levels (API reference). */
export const JEV_MAX_CHOICE_OPTIONS = 255;

/** A Choice option's rubric description. The API also accepts objects/arrays/null. */
export type JevChoiceCriteria = Record<string, string | null>;

export type JevChoiceQuestion = {
  type: "choice";
  /** What the model should decide. */
  instructions: string;
  criteria: JevChoiceCriteria;
};

export type JevNoulQuestion = {
  type: "noul";
  /** The yes/no question, or a statement to judge. */
  instructions: string;
  /** Optional descriptions of what a yes and a no mean. */
  criteria?: { true: string; false: string };
};

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

/** Questions keyed by the caller's id. Answers return under the same keys. */
export type JevQuestions = Record<string, JevQuestion>;

/** Text, a JSON object or array, or null to evaluate. */
export type JevState = string | Record<string, unknown> | unknown[] | null;

export type JevSystemOneRequest = {
  state: JevState;
  model: string;
  questions: JevQuestions;
};

export type JevChoiceAnswer = {
  type: "choice";
  /** The highest-probability option. */
  choice: string;
  /** Every option mapped to its probability; the values sum to 1. */
  probabilities?: Record<string, number>;
  /** 0..1, derived from the spread of `probabilities`. */
  confidence?: number;
};

export type JevNoulAnswer = {
  type: "noul";
  /** The yes/no answer: 0 is no, 1 is yes. No separate confidence field. */
  noul: number;
};

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

export type JevUsage = {
  input_tokens?: number;
  output_tokens?: number;
};

export type JevSystemOneResponse = {
  /** The model that performed the evaluation (e.g. "jev-1.13.0"). */
  model?: string;
  answers?: Record<string, JevAnswer>;
  usage?: JevUsage;
};

/** Narrow a decoded answer to a Choice answer. */
export function isJevChoiceAnswer(value: unknown): value is JevChoiceAnswer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "choice" && typeof v.choice === "string";
}

/** Narrow a decoded answer to a Noul answer. */
export function isJevNoulAnswer(value: unknown): value is JevNoulAnswer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.type === "noul" && typeof v.noul === "number";
}

/** Provenance context every decision mapper needs when building a result. */
export type JevResponseContext = {
  projectionHash: string;
  latencyMs: number;
};

/** Injected transport seam — tests supply a fake; production uses fetch. */
export type JevTransport = (
  request: JevSystemOneRequest,
  opts: { apiKey: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<JevSystemOneResponse>;
