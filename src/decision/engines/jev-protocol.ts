/**
 * jev-protocol.ts — Jev System One wire protocol (J1/J2).
 *
 * Pure types + constants. Imports nothing from decisions or engines, so both
 * the adapter and the per-decision mappers can depend on it without a cycle.
 *
 * Primitives modelled: Choice (pick one of N options) and Noul (P(statement)
 * in 0..1, no separate confidence field). Score (ordered rubric + confidence)
 * is intentionally absent until a decision needs it.
 */

export const JEV_SYSTEMONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";

/**
 * The wire shape below follows the documented System One surface but has NOT
 * been verified against the official SDK (implementation-plan stop condition).
 * Enabling remote requires an explicit operator acknowledgement — see
 * `JevAdapterOptions.acknowledgeUnverifiedWireFormat`.
 */
export const JEV_WIRE_FORMAT_STATUS = "documented-unverified" as const;

export type JevChoiceQuestion = {
  id: string;
  type: "choice";
  prompt: string;
  options: readonly string[];
};

export type JevNoulQuestion = {
  id: string;
  type: "noul";
  prompt: string;
};

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;

export type JevSystemOneRequest = {
  model: string;
  state: string;
  questions: JevQuestion[];
};

export type JevChoiceAnswer = {
  id: string;
  choice: string;
  confidence?: number;
};

export type JevNoulAnswer = {
  id: string;
  probability: number;
};

export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;

export type JevSystemOneResponse = {
  model?: string;
  answers?: JevAnswer[];
};

export function isJevChoiceAnswer(answer: JevAnswer): answer is JevChoiceAnswer {
  return typeof (answer as JevChoiceAnswer).choice === "string";
}

export function isJevNoulAnswer(answer: JevAnswer): answer is JevNoulAnswer {
  return typeof (answer as JevNoulAnswer).probability === "number";
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
