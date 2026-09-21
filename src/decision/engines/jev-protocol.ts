/**
 * jev-protocol.ts — Jev System One wire protocol (J1).
 *
 * Pure types + constants. Imports nothing from decisions or engines, so both
 * the adapter and the per-decision mappers can depend on it without a cycle.
 *
 * Wire shape follows the documented System One surface (`POST /v1/systemone`,
 * `state` + typed `questions`, Choice returns choice + confidence). Verify
 * against the official SDK before enabling remote — see the implementation
 * plan stop condition.
 */

export const JEV_SYSTEMONE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const JEV_DEFAULT_MODEL = "jev-latest";

export type JevChoiceQuestion = {
  id: string;
  type: "choice";
  prompt: string;
  options: string[];
};

export type JevSystemOneRequest = {
  model: string;
  state: string;
  questions: JevChoiceQuestion[];
};

export type JevChoiceAnswer = {
  id: string;
  choice: string;
  confidence?: number;
};

export type JevSystemOneResponse = {
  model?: string;
  answers?: JevChoiceAnswer[];
};

/** Injected transport seam — tests supply a fake; production uses fetch. */
export type JevTransport = (
  request: JevSystemOneRequest,
  opts: { apiKey: string; timeoutMs: number; signal?: AbortSignal },
) => Promise<JevSystemOneResponse>;
