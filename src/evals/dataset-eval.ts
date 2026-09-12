/**
 * dataset-eval.ts — model-running eval loop over corpus incidents (P4).
 *
 * Reads incidents (corpus.mjs mirror rows or plain {traceId, task, ...}),
 * runs each task through a candidate prompt, and grades the response with
 * an LLM judge into score records ({traceId, name, value}) ready for
 * score.mjs --batch and eval-gate.mjs.
 *
 * Honest limits: the judge grades whether the response addresses the
 * incident's errors — it is a direction check, not a verified fix. Scores
 * feed the gate; the gate (not this loop) decides promote/block.
 * Fail-open per incident: throw/timeout/garbage-judge → skipped, counted,
 * never aborts the run.
 */

import type { ModelAdapter } from "../providers/types.js";

export type DatasetIncident = {
  traceId: string;
  sessionId?: string | null;
  task?: string | null;
  errorNames?: string[];
};

export type DatasetEvalScore = {
  traceId: string;
  name: string;
  value: number;
};

export type DatasetEvalResult = {
  scores: DatasetEvalScore[];
  skipped: Array<{ traceId: string; reason: string }>;
};

const JUDGE_SYSTEM_PROMPT = [
  "You are an eval judge. Grade whether the candidate response addresses",
  "the incident described below. Output ONLY a single decimal number",
  "between 0 and 1 (1 = fully addresses the errors, 0 = ignores them).",
  "No explanations, no preamble — just the number.",
].join(" ");

/** First 0..1-looking number in text, clamped. NaN when none found. */
export function parseJudgeScore(text: string): number {
  const match = text.match(/(0?\.\d+|\b[01](?:\.0+)?\b)/);
  if (!match) return NaN;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return NaN;
  return Math.min(1, Math.max(0, value));
}

/**
 * Normalize one incident row. Two shapes accepted, explicitly:
 * - corpus mirror rows: { datasetName?, input: { traceId, sessionId?, task? }, metadata?: { errorNames? } }
 * - plain incidents: { traceId, sessionId?, task?, errorNames? }
 * Anything without a string traceId is rejected (null).
 */
export function normalizeIncident(row: unknown): DatasetIncident | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const input = (r.input ?? r) as Record<string, unknown>;
  const traceId = input.traceId;
  if (typeof traceId !== "string" || traceId.length === 0) return null;
  const metadata = (r.metadata ?? {}) as Record<string, unknown>;
  return {
    traceId,
    sessionId: typeof input.sessionId === "string" ? input.sessionId : null,
    task: typeof input.task === "string" ? input.task : null,
    errorNames: Array.isArray(metadata.errorNames)
      ? (metadata.errorNames as unknown[]).filter((e): e is string => typeof e === "string")
      : [],
  };
}

/** One provider turn: system prompt + single user message, text out. */
async function completeText(
  provider: ModelAdapter,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const response = await provider.complete({
    systemPrompt,
    messages: [{ role: "user", content: userContent }],
    tools: [],
  });
  return response.text?.trim() ?? "";
}

export type EvalGateVerdict = "promote" | "block" | "insufficient";

export type EvalGateResult = {
  verdict: EvalGateVerdict;
  runs: number;
  baselineWinRate: number;
  candidateWinRate: number;
  delta: number;
};

/**
 * In-process Act gate (mirrors eval-gate.mjs math for CLI use): win =
 * value >= winAt over matched traceIds. Deltas at/above minDelta promote;
 * anything below blocks. Fewer than minRuns matched traces → insufficient.
 */
export function gateDatasetEval(
  baseline: Map<string, number>,
  candidate: Map<string, number>,
  opts?: { minRuns?: number; minDelta?: number; winAt?: number },
): EvalGateResult {
  const minRuns = opts?.minRuns ?? 20;
  const minDelta = opts?.minDelta ?? 0.1;
  const winAt = opts?.winAt ?? 0.8;
  const matched = [...baseline.keys()].filter((id) => candidate.has(id));
  const rate = (m: Map<string, number>) =>
    matched.filter((id) => (m.get(id) ?? 0) >= winAt).length / Math.max(1, matched.length);
  if (matched.length < minRuns) {
    return { verdict: "insufficient", runs: matched.length, baselineWinRate: 0, candidateWinRate: 0, delta: 0 };
  }
  const baselineWinRate = rate(baseline);
  const candidateWinRate = rate(candidate);
  const delta = candidateWinRate - baselineWinRate;
  return {
    verdict: delta >= minDelta ? "promote" : "block",
    runs: matched.length,
    baselineWinRate: Number(baselineWinRate.toFixed(3)),
    candidateWinRate: Number(candidateWinRate.toFixed(3)),
    delta: Number(delta.toFixed(3)),
  };
}

export async function runDatasetEval(opts: {
  incidents: DatasetIncident[];
  promptName: string;
  promptText: string;
  provider: ModelAdapter;
  judgeProvider?: ModelAdapter;
  onScore?: (score: DatasetEvalScore) => void;
}): Promise<DatasetEvalResult> {
  const judge = opts.judgeProvider ?? opts.provider;
  const scores: DatasetEvalScore[] = [];
  const skipped: Array<{ traceId: string; reason: string }> = [];

  for (const incident of opts.incidents) {
    if (!incident.task) {
      skipped.push({ traceId: incident.traceId, reason: "no task on incident" });
      continue;
    }
    try {
      const responseText = await completeText(
        opts.provider,
        opts.promptText,
        `Task: ${incident.task}\nKnown failure signals: ${(incident.errorNames ?? []).join(", ") || "none recorded"}`,
      );
      if (!responseText) {
        skipped.push({ traceId: incident.traceId, reason: "empty candidate response" });
        continue;
      }
      const judgeText = await completeText(
        judge,
        JUDGE_SYSTEM_PROMPT,
        `Incident errors: ${(incident.errorNames ?? []).join(", ") || "none recorded"}\nCandidate response:\n${responseText}`,
      );
      const value = parseJudgeScore(judgeText);
      if (Number.isNaN(value)) {
        skipped.push({ traceId: incident.traceId, reason: "unparseable judge output" });
        continue;
      }
      const score: DatasetEvalScore = { traceId: incident.traceId, name: `eval:${opts.promptName}`, value };
      scores.push(score);
      opts.onScore?.(score);
    } catch (err) {
      skipped.push({ traceId: incident.traceId, reason: String(err instanceof Error ? err.message : err) });
    }
  }

  return { scores, skipped };
}
