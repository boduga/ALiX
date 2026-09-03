// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT
/**
 * BenchmarkScenario — deterministic maintenance/reconciliation task.
 *
 * Deterministic PRNG (mulberry32) → reproducible history+decisions per (scenario, seed, horizon).
 * Scaled horizons 10/50/100/500, controlled failures/distractors, 3 decision categories
 * (state-complete / evidence-dependent / history-dependent) interleaved deterministically.
 *
 * Maps ticket #623 resolution (harness stub): task, measurement, comparison shape.
 * Does NOT touch contract/store/projector — generates BenchmarkEvent[] compatible with projector
 * but keeps evidence/history-dependent payloads as non-state-affecting types (§14: ignored but hashed).
 *
 * @module benchmark/scenario
 */

import type { BenchmarkScenario, BenchmarkEvent, DecisionPoint, DecisionCategory } from "./types.js";

// ─── Deterministic PRNG ───────────────────────────────────────────

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mulberry32Int(seed: number, min: number, max: number, rng: () => number): number {
  // inclusive min, exclusive max
  return Math.floor(rng() * (max - min)) + min;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

// ─── Maintenance/reconciliation domain ────────────────────────────

const MAINTENANCE_OBJECTIVES = [
  "reconcile service mesh routing",
  "reconcile maintenance window deployments",
  "reconcile capability health across nodes",
] as const;

const DISTRACTOR_PAYLOADS = [
  { kind: "log_noise", message: "heartbeat ok" },
  { kind: "metric_batch", cpu: 42, mem: 71 },
  { kind: "health_poll", status: "nominal" },
] as const;

/**
 * Generate a deterministic scenario for the given workload dimensions.
 *
 * History composition per horizon H:
 *  - 1× execution.created (seq 1) — required for projector INV-P1/P2
 *  - ~H mixed events: state-affecting (capability_bound, constraint_applied, artifact_registered, etc.)
 *    interleaved with distractor evidence (tool.output/evidence) and controlled failures (capability degraded/unavailable)
 *  - Decision points: every ~10 steps, cycling through [state-complete, evidence-dependent, history-dependent]
 *    so each horizon has at least one of each category; count scales linearly with H for horizon-invariance tests.
 *
 * Invariants:
 *  - Same (scenarioId, seed, horizon) → byte-identical events & decisions (deterministic RNG)
 *  - Events sorted by seq ascending
 *  - History is immutable input to harness — never mutated downstream
 */
export function createScenario(args: {
  scenarioId?: string;
  seed: number;
  horizon: number;
  objective?: string;
}): BenchmarkScenario {
  const { seed, horizon } = args;
  if (!Number.isInteger(horizon) || horizon < 1) throw new Error(`horizon must be integer >=1, got ${horizon}`);
  const scenarioId = args.scenarioId ?? `maintenance-reconciliation`;
  const rng = mulberry32(seed);

  const objective = args.objective ?? pick(rng, MAINTENANCE_OBJECTIVES);
  const executionId = `bench-${scenarioId}-${seed}-${horizon}`;

  const intentId = `intent-${executionId}`;
  const events: BenchmarkEvent[] = [];
  let seq = 1;

  // 1) execution.created — authoritative start (§14)
  events.push({
    seq: seq++,
    type: "execution.created",
    payload: { executionId, objective, intent: { intentId } },
    id: `evt-${seq}`,
  });
  const decisionPoints: DecisionPoint[] = [];

  // Track source seqs for history/evidence decisions so D can do targeted fetch
  const evidenceSources: number[] = [];
  const historySources: number[] = [];

  // Helper to push event and optionally record as evidence/history source
  function pushEvent(type: string, payload: unknown): number {
    const s = seq++;
    events.push({ seq: s, type, payload, id: `evt-${s}` });
    return s;
  }

  // 2) Generate H steps — each step is 1-3 events (keeps history length ≈ horizon)
  for (let step = 1; step <= horizon; step++) {
    const stepRoll = rng();

    if (stepRoll < 0.30) {
      // state-affecting: capability health fluctuation (controlled failures)
      const capId = `svc-${mulberry32Int(seed, 1, 5, rng)}`;
      const avail = rng() < 0.20 ? (rng() < 0.5 ? "degraded" : "unavailable") : "available";
      pushEvent("execution.capability_bound", {
        capabilityId: capId,
        version: `1.0.${step % 3}`,
        availability: avail,
      });
    } else if (stepRoll < 0.45) {
      pushEvent("execution.constraint_applied", {
        kind: "maintenance_window",
        value: `window-${step}`,
      });
    } else if (stepRoll < 0.60) {
      pushEvent("execution.artifact_registered", {
        artifactId: `artifact-${step}`,
        uri: `file:///artifacts/${executionId}/${step}`,
        kind: "reconciliation_snapshot",
      });
    } else if (stepRoll < 0.80) {
      // distractor — non-state-affecting but bloats history tokens (context efficiency test)
      const d = pick(rng, DISTRACTOR_PAYLOADS);
      pushEvent("tool.output", { step, distractor: d, span: `poll-${step}` });
    } else {
      // evidence observation — non-state-affecting, carries detail needed for evidence-dependent decisions
      // deliberately ignored by StateProjector (evidence vs state §15)
      const evId = `ev-${step}-${Math.floor(rng() * 10000)}`;
      const detail = `evidence-detail-${executionId}-step-${step}-code-${Math.floor(rng() * 9000) + 1000}`;
      const s = pushEvent("evidence.observation", { evidenceId: evId, detail, step, kind: "provider_error" });
      evidenceSources.push(s);
    }

    // Periodically inject a historical raw detail event that will be needed later (retroactive relevance §18.2)
    if (step % 13 === 0 && step > 5) {
      const histDetail = `history-raw-${executionId}-seq-${step}-secret-${Math.floor(rng() * 9000) + 1000}`;
      const s = pushEvent("history.artifact_detail", {
        artifactDetailId: `hist-${step}`,
        raw: histDetail,
        step,
        groundTruth: histDetail,
      });
      historySources.push(s);
    }

    // Interleave extra distractor every 7 steps to keep A_tokens >> C_tokens at 500
    if (step % 7 === 0) {
      pushEvent("tool.output", {
        step,
        distractor: { kind: "log_noise", message: `distractor-${step}-${"x".repeat(40)}` },
      });
    }
  }

  // 3) Lay decision points — every 10 steps, cycle categories deterministically
  // So horizon 10 → ~3 decisions, 50 → 15, 100 → 30, 500 → 150. At least one per category.
  const categoriesCycle: DecisionCategory[] = ["state-complete", "evidence-dependent", "history-dependent"];
  let catIdx = 0;
  let evidenceIdx = 0;
  let historyIdx = 0;

  // Ensure we have enough evidence/history sources; generate synthetic if needed
  while (evidenceSources.length < Math.ceil(horizon / 10)) {
    const s = seq++;
    const evId = `ev-synth-${s}`;
    events.push({
      seq: s,
      type: "evidence.observation",
      payload: { evidenceId: evId, detail: `evidence-detail-synth-${s}`, step: s, kind: "provider_error" },
      id: `evt-${s}`,
    });
    evidenceSources.push(s);
  }
  while (historySources.length < Math.ceil(horizon / 10)) {
    const s = seq++;
    const raw = `history-raw-synth-${s}`;
    events.push({
      seq: s,
      type: "history.artifact_detail",
      payload: { artifactDetailId: `hist-synth-${s}`, raw, step: s, groundTruth: raw },
      id: `evt-${s}`,
    });
    historySources.push(s);
  }

  const numDecisions = Math.max(3, Math.floor(horizon / 10) * categoriesCycle.length);
  // Spread decision steps evenly across horizon
  for (let i = 0; i < numDecisions; i++) {
    const category = categoriesCycle[catIdx % categoriesCycle.length];
    catIdx++;

    // Step where decision is evaluated: distribute across horizon, avoid clustering at start
    const stepIndex = Math.min(horizon, Math.max(1, Math.floor(((i + 1) / (numDecisions + 1)) * horizon) + 1));

    let groundTruth: string;
    let requiresEvidence = false;
    let requiresHistory = false;
    let sourceSeq: number | undefined;
    let evidenceId: string | undefined;

    if (category === "state-complete") {
      // Derivable from bounded state (pendingActions / constraints / capabilities)
      groundTruth = `state-answer-${executionId}-step-${stepIndex}`;
    } else if (category === "evidence-dependent") {
      const src = evidenceSources[evidenceIdx % evidenceSources.length] as number;
      evidenceIdx++;
      const ev = events.find(e => e.seq === src);
      const detail = (ev?.payload as Record<string, unknown>)?.detail as string ?? `evidence-detail-${src}`;
      groundTruth = String(detail);
      requiresEvidence = true;
      sourceSeq = src;
      evidenceId = (ev?.payload as Record<string, unknown>)?.evidenceId as string | undefined ?? `ev-${src}`;
    } else {
      const src = historySources[historyIdx % historySources.length] as number;
      historyIdx++;
      const ev = events.find(e => e.seq === src);
      const raw = (ev?.payload as Record<string, unknown>)?.raw as string ?? `history-raw-${src}`;
      groundTruth = String(raw);
      requiresHistory = true;
      sourceSeq = src;
    }

    decisionPoints.push({
      id: `dec-${i + 1}-${category}`,
      stepIndex,
      category,
      groundTruth,
      requiresEvidence,
      requiresHistory,
      sourceSeq,
      evidenceId,
    });
  }

  // Ensure events sorted (deterministic invariant INV-P1)
  events.sort((a, b) => a.seq - b.seq);

  return {
    scenarioId,
    seed,
    horizon,
    objective,
    events: Object.freeze([...events]),
    decisionPoints: Object.freeze([...decisionPoints]),
    description: `maintenance reconciliation horizon=${horizon} seed=${seed} events=${events.length} decisions=${decisionPoints.length} distractors+failures interleaved`,
  };
}

/**
 * Create the same scenario across multiple horizons with the same seed
 * (useful for horizon-invariance assertions 10→500).
 */
export function createScenariosForHorizons(args: {
  scenarioId?: string;
  seed: number;
  horizons: readonly number[];
}): BenchmarkScenario[] {
  return args.horizons.map(h => createScenario({ scenarioId: args.scenarioId, seed: args.seed, horizon: h }));
}
