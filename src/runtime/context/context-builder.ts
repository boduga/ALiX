// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * Phase 4 — State-aware Context Builder (P + Σ + O + E + Tools)
 *
 * Bounded, mechanical prompt assembly for the ExecutionState substrate.
 * Turns a skill spec, compact execution state, latest observation,
 * relevant evidence, and allowed tools into a bounded prompt whose size
 * is O(|P|+|Σ|+|O|) — constant for 10 or 500 steps.
 *
 * Spec: docs/ALiX-ExecutionState-Architecture.md §20-21, §36, §47
 * Resolution: issue #620 (P+Σ+O+E+Tools, tiered budget, state anchor,
 *   bounded tiers) and issue #630 (tracer bullet — this file only).
 *
 * Architecture invariants (enforced here):
 *  - EventLog remains authoritative; history is opt-in only.
 *  - ExecutionState is rendered as compact `<execution_state>` (not raw JSON).
 *  - LatestObservation hard-capped ~2k tokens; large output → concise + evidence ref.
 *  - RelevantEvidence bounded top-K 5-10 / ~4k tokens, never mutates state.
 *  - Tools derived from capabilities+constraints; prompt and tool surface agree.
 *  - History never included unless explicitly provided.
 *  - Builder is pure and mechanical: `buildExecutionContext(skill, state, observation, evidence, tools)`
 *    with no side effects, no token budgeting — single `countTokens` ownership
 *    stays with `src/config/context-assembly.ts` (state protected P1 / Tier-3).
 *  - Prompt bounded: `prompt ≈ O(|P|+|Σ|+|O|)` regardless of execution horizon.
 *
 * @module runtime/context/context-builder
 */

import type { ExecutionState } from "../execution-state/execution-state.js";

// ─── Bounds ────────────────────────────────────────────────────────

/** LatestObservation hard cap — 2k tokens ≈ 8k chars (char/4 heuristic). Small-model default (Phi-3 4k). */
export const MAX_OBSERVATION_TOKENS = 2_000 as const;
export const MAX_OBSERVATION_CHARS = 8_000 as const;

/** RelevantEvidence total budget — 4k tokens ≈ 16k chars. Small-model default. */
export const MAX_EVIDENCE_TOKENS = 4_000 as const;
export const MAX_EVIDENCE_CHARS = 16_000 as const;

/** Evidence top-K window: 5-10 records (bounded). Small-model default. */
export const MAX_EVIDENCE_ITEMS = 10 as const;
export const MIN_EVIDENCE_ITEMS = 5 as const;
export const DEFAULT_EVIDENCE_TOP_K = 8 as const;

/** State sub-list bounds — keep Σ itself bounded (refs, not unbounded payloads). */
export const MAX_PENDING_RENDER = 20 as const;
export const MAX_ARTIFACTS_RENDER = 20 as const;
export const MAX_CONSTRAINTS_RENDER = 20 as const;
export const MAX_CAPABILITIES_RENDER = 20 as const;

/** Skill body cap — keep P fixed/small (skill spec is immutable per execution). Small-model default. */
export const MAX_SKILL_CHARS = 8_000 as const;

/** Frontier-model caps — when maxContextTokens ≥ 32k, allow larger evidence/observation windows. */
export const FRONTIER_OBSERVATION_TOKENS = 8_000 as const;
export const FRONTIER_OBSERVATION_CHARS = 32_000 as const;
export const FRONTIER_EVIDENCE_TOKENS = 16_000 as const;
export const FRONTIER_EVIDENCE_CHARS = 64_000 as const;
export const FRONTIER_EVIDENCE_TOP_K = 20 as const;
export const FRONTIER_SKILL_CHARS = 16_000 as const;

export type BuilderCaps = Readonly<{
  observationChars: number;
  evidenceChars: number;
  evidenceTopK: number;
  skillChars: number;
}>;

/**
 * Model-aware caps — small models (4k-8k) keep tight bounds to avoid
 * overflow/hallucination; frontier models (32k-200k) get larger windows
 * but still bounded O(|P|+|Σ|+|O|). Uses ModelConfig.maxContextTokens or
 * inputTokenLimit when available; defaults to small-model caps.
 */
export function getBuilderCaps(model?: { maxContextTokens?: number; inputTokenLimit?: number } | null): BuilderCaps {
  const window = model?.maxContextTokens ?? model?.inputTokenLimit ?? 4096;
  const isFrontier = window >= 32_000;
  if (isFrontier) {
    return {
      observationChars: FRONTIER_OBSERVATION_CHARS,
      evidenceChars: FRONTIER_EVIDENCE_CHARS,
      evidenceTopK: FRONTIER_EVIDENCE_TOP_K,
      skillChars: FRONTIER_SKILL_CHARS,
    };
  }
  return {
    observationChars: MAX_OBSERVATION_CHARS,
    evidenceChars: MAX_EVIDENCE_CHARS,
    evidenceTopK: DEFAULT_EVIDENCE_TOP_K,
    skillChars: MAX_SKILL_CHARS,
  };
}

// ─── Input types ───────────────────────────────────────────────────

/** Immutable skill specification P. Accepts string body or structured manifest. */
export type SkillInput =
  | string
  | Readonly<{
      name?: string;
      description?: string;
      version?: string;
      body?: string;
      content?: string;
    }>;

/** Latest observation O — tool stdout, API response, provider error, etc. */
export type ObservationInput =
  | string
  | Readonly<{
      content: string;
      kind?: string;
      toolName?: string;
      evidenceRef?: string;
    }>
  | null
  | undefined;

/** Single evidence record E — supporting observation / justification. */
export type EvidenceInput = Readonly<{
  id?: string;
  content: string;
  kind?: string;
  score?: number;
  source?: string;
}>;

/** Tool surface derived from capabilities+constraints+policy. */
export type ToolInput = Readonly<{
  name: string;
  description?: string;
  capabilityId?: string;
}>;

/** Optional history — opt-in only, never included by default. */
export type HistoryInput = readonly string[];

// ─── Output types ──────────────────────────────────────────────────

export type BuiltContextSections = Readonly<{
  skill: string;
  executionState: string;
  observation: string;
  evidence: string;
  tools: string;
  history?: string;
}>;

export type BuiltContext = Readonly<{
  prompt: string;
  sections: BuiltContextSections;
  metadata: Readonly<{
    skillChars: number;
    stateChars: number;
    observationChars: number;
    observationTruncated: boolean;
    evidenceChars: number;
    evidenceAdmitted: number;
    evidenceDropped: number;
    toolsCount: number;
    historyIncluded: boolean;
    bounded: boolean;
  }>;
}>;

// ─── Helpers ───────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toSkillBody(skill: SkillInput): { name: string; version: string; body: string } {
  if (typeof skill === "string") {
    return { name: "skill", version: "", body: skill };
  }
  const name = typeof skill.name === "string" ? skill.name : "skill";
  const version = typeof skill.version === "string" ? skill.version : "";
  const rawBody = typeof skill.body === "string" ? skill.body : typeof skill.content === "string" ? skill.content : typeof skill.description === "string" ? skill.description : "";
  return { name, version, body: rawBody };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncateWithMarker(text: string, maxChars: number, marker: string): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const keep = Math.max(0, maxChars - marker.length);
  return { text: text.slice(0, keep) + marker, truncated: true };
}

// ─── Renderers ─────────────────────────────────────────────────────

/**
 * Compact `<execution_state>` rendering — not raw JSON.
 *
 * Human-readable, bounded, deterministic. Bounded sub-lists prevent Σ from
 * growing with horizon (refs, not unbounded history).
 */
export function renderExecutionState(state: ExecutionState): string {
  const lines: string[] = [];
  lines.push(`<execution_state version="${escapeXml(String(state.version))}" step="${escapeXml(String(state.step))}" schema="${escapeXml(state.schemaVersion)}">`);
  lines.push(`  <objective>${escapeXml(state.objective)}</objective>`);
  lines.push(`  <status>${escapeXml(state.status)}</status>`);
  const intentVal = state.intent.proposalId ? `${state.intent.intentId} (proposal: ${state.intent.proposalId})` : state.intent.intentId;
  lines.push(`  <intent>${escapeXml(intentVal)}</intent>`);

  // Pending — bounded
  const pending = state.pendingActions.slice(0, MAX_PENDING_RENDER);
  if (pending.length > 0) {
    lines.push(`  <pending count="${pending.length}">`);
    for (const a of pending) {
      const desc = a.description ? ` — ${a.description}` : "";
      lines.push(`    - ${escapeXml(a.actionId)} [${escapeXml(a.kind)}]${escapeXml(desc)}`);
    }
    if (state.pendingActions.length > MAX_PENDING_RENDER) {
      lines.push(`    ... +${state.pendingActions.length - MAX_PENDING_RENDER} more`);
    }
    lines.push(`  </pending>`);
  } else {
    lines.push(`  <pending>—</pending>`);
  }

  // Capabilities — bounded, availability flagged
  const caps = state.activeCapabilities.slice(0, MAX_CAPABILITIES_RENDER);
  if (caps.length > 0) {
    lines.push(`  <capabilities count="${caps.length}">`);
    for (const c of caps) {
      lines.push(`    - ${escapeXml(c.capabilityId)}@${escapeXml(c.version)} [${escapeXml(c.availability)}]`);
    }
    if (state.activeCapabilities.length > MAX_CAPABILITIES_RENDER) {
      lines.push(`    ... +${state.activeCapabilities.length - MAX_CAPABILITIES_RENDER} more`);
    }
    lines.push(`  </capabilities>`);
  } else {
    lines.push(`  <capabilities>—</capabilities>`);
  }

  // Constraints — bounded
  const constraints = state.constraints.slice(0, MAX_CONSTRAINTS_RENDER);
  if (constraints.length > 0) {
    lines.push(`  <constraints count="${constraints.length}">`);
    for (const c of constraints) {
      lines.push(`    - ${escapeXml(c.kind)}: ${escapeXml(c.value)}`);
    }
    if (state.constraints.length > MAX_CONSTRAINTS_RENDER) {
      lines.push(`    ... +${state.constraints.length - MAX_CONSTRAINTS_RENDER} more`);
    }
    lines.push(`  </constraints>`);
  } else {
    lines.push(`  <constraints>—</constraints>`);
  }

  // Artifacts — bounded refs (uri, not payload)
  const artifacts = state.artifacts.slice(0, MAX_ARTIFACTS_RENDER);
  if (artifacts.length > 0) {
    lines.push(`  <artifacts count="${artifacts.length}">`);
    for (const a of artifacts) {
      const kind = a.kind ? ` [${a.kind}]` : "";
      lines.push(`    - ${escapeXml(a.artifactId)} → ${escapeXml(a.uri)}${escapeXml(kind)}`);
    }
    if (state.artifacts.length > MAX_ARTIFACTS_RENDER) {
      lines.push(`    ... +${state.artifacts.length - MAX_ARTIFACTS_RENDER} more`);
    }
    lines.push(`  </artifacts>`);
  } else {
    lines.push(`  <artifacts>—</artifacts>`);
  }

  lines.push(`  <execution_id>${escapeXml(state.executionId)}</execution_id>`);
  lines.push(`</execution_state>`);
  return lines.join("\n");
}

export function renderSkill(skill: SkillInput, caps?: BuilderCaps): string {
  const { name, version, body } = toSkillBody(skill);
  const verAttr = version ? ` version="${escapeXml(version)}"` : "";
  const cap = caps?.skillChars ?? MAX_SKILL_CHARS;
  const capped = body.length > cap ? body.slice(0, cap) + "\n...[skill truncated]" : body;
  return `<skill name="${escapeXml(name)}"${verAttr}>\n${capped}\n</skill>`;
}

/**
 * Render LatestObservation with hard cap. Large output is replaced by a
 * concise preview plus an evidence reference — the full payload stays in
 * EventLog/Evidence, not the prompt.
 */
export function renderObservation(observation: ObservationInput, caps?: BuilderCaps): { text: string; truncated: boolean; chars: number } {
  if (observation === null || observation === undefined) {
    return { text: "<latest_observation>—</latest_observation>", truncated: false, chars: 0 };
  }
  let raw: string;
  let evidenceRef: string | undefined;
  let kind: string | undefined;
  if (typeof observation === "string") {
    raw = observation;
  } else if (isRecord(observation)) {
    raw = typeof observation.content === "string" ? observation.content : "";
    evidenceRef = typeof observation.evidenceRef === "string" ? observation.evidenceRef : undefined;
    kind = typeof observation.kind === "string" ? observation.kind : typeof observation.toolName === "string" ? observation.toolName : undefined;
  } else {
    raw = "";
  }

  if (raw.length === 0) {
    return { text: "<latest_observation>—</latest_observation>", truncated: false, chars: 0 };
  }

  const cap = caps?.observationChars ?? MAX_OBSERVATION_CHARS;
  const kindAttr = kind ? ` kind="${escapeXml(kind)}"` : "";
  const isLarge = raw.length > cap;

  if (!isLarge) {
    return { text: `<latest_observation${kindAttr}>\n${escapeXml(raw)}\n</latest_observation>`, truncated: false, chars: raw.length };
  }

  const marker = `\n...[truncated ${raw.length - cap} chars; full output in evidence${evidenceRef ? ` ref: ${evidenceRef}` : ""}]`;
  const { text: preview } = truncateWithMarker(raw, cap, marker);
  // Escape only the preview content, keep marker readable
  const escapedPreview = escapeXml(preview);
  return {
    text: `<latest_observation${kindAttr} truncated="true">\n${escapedPreview}\n</latest_observation>`,
    truncated: true,
    chars: MAX_OBSERVATION_CHARS,
  };
}

/**
 * Bounded RelevantEvidence — top-K 5-10 / ~4k tokens.
 *
 * Caller may pass items unsorted; when `score` is present we sort descending
 * and take the top-K. Otherwise source order is preserved. Total chars are
 * hard-capped at MAX_EVIDENCE_CHARS; the lowest-priority items are dropped
 * first (tail drop).
 */
export function renderEvidence(evidence: readonly EvidenceInput[] | null | undefined, caps?: BuilderCaps): {
  text: string;
  admitted: number;
  dropped: number;
  chars: number;
} {
  if (!evidence || evidence.length === 0) {
    return { text: "<relevant_evidence>—</relevant_evidence>", admitted: 0, dropped: 0, chars: 0 };
  }

  // Deterministic ordering: score desc if any item has score, else source order
  const hasScores = evidence.some(e => typeof e.score === "number");
  const sorted = hasScores
    ? [...evidence].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    : [...evidence];

  // Top-K cap — model-aware
  const topKCap = caps?.evidenceTopK ?? DEFAULT_EVIDENCE_TOP_K;
  const charCap = caps?.evidenceChars ?? MAX_EVIDENCE_CHARS;
  const topK = Math.min(sorted.length, topKCap, MAX_EVIDENCE_ITEMS);
  let selected = sorted.slice(0, topK);
  // If caller passed >topK, the remainder is dropped by K
  let dropped = evidence.length - selected.length;

  // Enforce total char budget — tail-drop until under budget
  let totalChars = selected.reduce((s, e) => s + e.content.length, 0);
  while (selected.length > MIN_EVIDENCE_ITEMS && totalChars > charCap) {
    const removed = selected.pop()!;
    totalChars -= removed.content.length;
    dropped++;
  }
  // If still over after dropping to MIN, truncate the last item's content
  if (totalChars > charCap && selected.length > 0) {
    const last = selected[selected.length - 1];
    const over = totalChars - charCap;
    const truncatedContent = last.content.slice(0, Math.max(0, last.content.length - over - 64)) + "...[evidence truncated]";
    selected = [...selected.slice(0, -1), { ...last, content: truncatedContent }];
    totalChars = selected.reduce((s, e) => s + e.content.length, 0);
  }

  const lines: string[] = [];
  lines.push(`<relevant_evidence count="${selected.length}">`);
  selected.forEach((e, i) => {
    const id = e.id ? ` id="${escapeXml(e.id)}"` : ` id="ev-${i + 1}"`;
    const kind = e.kind ? ` kind="${escapeXml(e.kind)}"` : "";
    const source = e.source ? ` source="${escapeXml(e.source)}"` : "";
    lines.push(`  <evidence${id}${kind}${source}>`);
    lines.push(`    ${escapeXml(e.content)}`);
    lines.push(`  </evidence>`);
  });
  if (dropped > 0) {
    lines.push(`  <!-- +${dropped} evidence record(s) omitted (top-K / 4k budget) -->`);
  }
  lines.push(`</relevant_evidence>`);

  const text = lines.join("\n");
  return { text, admitted: selected.length, dropped, chars: totalChars };
}

/**
 * Tools block derived from capabilities+constraints.
 *
 * The prompt and the tool surface must agree: this block lists only tools
 * that are both in the allowed set and not suppressed by a constraint.
 * A constraint of kind `deny_tool` or `blocked_capability` suppresses
 * matching tools; all other constraint kinds are informational and do not
 * suppress.
 */
export function renderTools(tools: readonly ToolInput[] | null | undefined, constraints?: ExecutionState["constraints"]): string {
  if (!tools || tools.length === 0) {
    return "<available_tools>—</available_tools>";
  }

  const blocked = new Set<string>();
  if (constraints) {
    for (const c of constraints) {
      if (c.kind === "deny_tool" || c.kind === "blocked_capability" || c.kind === "blocked_tool") {
        blocked.add(c.value);
      }
    }
  }

  const allowed = tools.filter(t => !blocked.has(t.name) && !(t.capabilityId && blocked.has(t.capabilityId)));
  if (allowed.length === 0) {
    return "<available_tools>—</available_tools>";
  }

  const lines: string[] = [];
  lines.push(`<available_tools count="${allowed.length}">`);
  for (const t of allowed) {
    const cap = t.capabilityId ? ` capability="${escapeXml(t.capabilityId)}"` : "";
    const desc = t.description ? ` — ${escapeXml(t.description)}` : "";
    lines.push(`  - ${escapeXml(t.name)}${cap}${desc}`);
  }
  lines.push(`</available_tools>`);
  return lines.join("\n");
}

// ─── Validation ────────────────────────────────────────────────────

function requireValidState(state: unknown): ExecutionState {
  if (!isRecord(state) || typeof (state as Record<string, unknown>).executionId !== "string") {
    throw new Error("buildExecutionContext: invalid ExecutionState");
  }
  return state as ExecutionState;
}

// ─── Pure builder ──────────────────────────────────────────────────

/**
 * Pure mechanical builder: Skill + ExecutionState + LatestObservation +
 * RelevantEvidence + Tools → bounded prompt.
 *
 * No side effects, no I/O, no token counting. Single `countTokens` ownership
 * remains with `src/config/context-assembly.ts` where the state tier is
 * protected (P1 / Tier-3) and budgeting/eviction lives.
 *
 * History is opt-in only — include via `opts.history`. When omitted, no
 * historical transcript enters the prompt (O(|P|+|Σ|+|O|) constant).
 */
export function buildExecutionContext(
  skill: SkillInput,
  state: ExecutionState,
  observation: ObservationInput,
  evidence: readonly EvidenceInput[] | null | undefined,
  tools: readonly ToolInput[] | null | undefined,
  opts?: Readonly<{ history?: HistoryInput | null; model?: { maxContextTokens?: number; inputTokenLimit?: number } | null; caps?: BuilderCaps }>
): BuiltContext {
  const validState = requireValidState(state);
  const caps = opts?.caps ?? getBuilderCaps(opts?.model ?? null);

  const skillText = renderSkill(skill, caps);
  const stateText = renderExecutionState(validState);
  const obs = renderObservation(observation, caps);
  const ev = renderEvidence(evidence, caps);
  const toolsText = renderTools(tools, validState.constraints);

  const sections: BuiltContextSections = {
    skill: skillText,
    executionState: stateText,
    observation: obs.text,
    evidence: ev.text,
    tools: toolsText,
    ...(opts?.history && opts.history.length > 0 ? { history: `<history>\n${opts.history.map(h => escapeXml(h)).join("\n")}\n</history>` } : {}),
  };

  // Assembly order mirrors §20: Skill → State → Tools → Observation → Evidence → History(optional)
  const parts = [skillText, stateText, toolsText, obs.text, ev.text];
  if (sections.history) parts.push(sections.history);
  const prompt = parts.join("\n\n");

  const bounded = obs.chars <= caps.observationChars && ev.chars <= caps.evidenceChars && ev.admitted <= caps.evidenceTopK;

  return {
    prompt,
    sections,
    metadata: {
      skillChars: skillText.length,
      stateChars: stateText.length,
      observationChars: obs.chars,
      observationTruncated: obs.truncated,
      evidenceChars: ev.chars,
      evidenceAdmitted: ev.admitted,
      evidenceDropped: ev.dropped,
      toolsCount: tools ? tools.filter(t => {
        // Recompute allowed count to report admitted, not input
        const blocked = new Set<string>();
        for (const c of validState.constraints) {
          if (c.kind === "deny_tool" || c.kind === "blocked_capability" || c.kind === "blocked_tool") blocked.add(c.value);
        }
        return !blocked.has(t.name) && !(t.capabilityId && blocked.has(t.capabilityId));
      }).length : 0,
      historyIncluded: Boolean(opts?.history && opts.history.length > 0),
      bounded,
    },
  };
}

// ─── Candidate items for the existing assembler ────────────────────

/**
 * Convert a built context into `CandidateContextItem`s for the existing
 * `assembleContext` / `ContextAssembler` single-owner budgeting path.
 *
 * Tier mapping (arch §20 + existing 6-tier taxonomy):
 *  - skill            → `current_task` (T2 mandatory)
 *  - execution_state  → `current_execution_state` (T3 protected — P1)
 *  - tools            → `mandatory_system_governance` (T1 — P2 required tools)
 *  - observation      → `recent_tool_results` (T5 best-effort, hard-capped)
 *  - evidence         → `recent_conversation` (T4 best-effort, bounded top-K)
 *  - history (opt-in) → `older_context` (T6 chronological, opt-in only)
 *
 * The assembler remains the sole owner of ordering/budgeting/truncation/
 * eviction and the single `countTokens` pass; state is protected because it
 * sits in Tier-3 (all-or-nothing, never sliced by budget).
 *
 * This helper is a convenience for callers that want to feed the builder
 * directly into `assembleContext` without hand-mapping categories. It uses a
 * cheap char/4 token estimate for the `tokens`/`rawTokens` fields; the
 * assembler then does the authoritative tokenizer pass.
 */
export type AssemblerCandidateItem = Readonly<{
  id: string;
  kind: string;
  category: "mandatory_system_governance" | "current_task" | "current_execution_state" | "recent_conversation" | "recent_tool_results" | "older_context";
  tokens: number;
  rawTokens: number;
  text: string;
}>;

function estimateTokens(text: string): { rawTokens: number; tokens: number } {
  const rawTokens = Math.ceil(text.length / 4);
  const tokens = Math.ceil(rawTokens * 1.2);
  return { rawTokens, tokens };
}

export function toCandidateItems(built: BuiltContext): AssemblerCandidateItem[] {
  const items: AssemblerCandidateItem[] = [];
  const now = Date.now();

  const push = (id: string, kind: string, category: AssemblerCandidateItem["category"], text: string) => {
    const { rawTokens, tokens } = estimateTokens(text);
    items.push({ id, kind, category, tokens, rawTokens, text });
    void now; // provenance timestamp would ride on CandidateContextItem.provenance in the full path
  };

  push("skill", "skill", "current_task", built.sections.skill);
  push("execution_state", "execution_state", "current_execution_state", built.sections.executionState);
  push("tools", "available_tools", "mandatory_system_governance", built.sections.tools);
  push("observation", "latest_observation", "recent_tool_results", built.sections.observation);
  push("evidence", "relevant_evidence", "recent_conversation", built.sections.evidence);
  if (built.sections.history) {
    push("history", "history", "older_context", built.sections.history);
  }

  return items;
}

// ─── Re-exports for convenience ────────────────────────────────────

export type { ExecutionState } from "../execution-state/execution-state.js";
