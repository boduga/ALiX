# P5.2c — AutomaticProposalGenerator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-19-p5-2c-automatic-proposal-generation.md` (project convention, matching P5.2b).

**Goal:** Auto-generate `pending` `AdaptationProposal`s from `ReflectionReport` recommendations and `EffectivenessReport` `revert` decisions — proposal-only, human-gated, no mutation.

**Architecture:** A pure-ish `AutomaticProposalGenerator` that composes the existing `RecommendationToProposal.convert` (P5.1c) for the reflection path and builds manual-action `create_improvement_issue` proposals for the effectiveness-revert path. All generated proposals carry `provenance: "auto"` and `status: "pending"`; the generator never touches `ApprovalGate`, `AgentCardApplier`, or `SkillApplier`. CLI surfaces generation as `alix adaptation generate --reflection <report.json> | --effectiveness <id> | --all-effectiveness [--min-confidence <n>]`.

**Tech Stack:** TypeScript (ESM/TSX), P5.1 `ProposalStore`/`AdaptationProposal`/`ApprovalGate`, P5.2b `EffectivenessReport`/`EffectivenessStore`, P4.4 `EvidenceEventWriter`, Vitest.

## Global Constraints

- **No mutation.** P5.2c only reads input reports and writes `pending` proposals + `adaptation_proposed` evidence. It does NOT call `ApprovalGate.approve/reject/apply`, does NOT invoke any applier, and does NOT touch agent cards or skills.
- **`provenance: "auto"` on every generated proposal** (backwards-compatible optional field added in c.1). Existing `RecommendationToProposal.convert` continues to leave it undefined (= manual).
- **Confidence threshold** (default `0.7`, configurable via `--min-confidence`). Reflection recommendations below the threshold are skipped.
- **Effectiveness path** generates only when `recommendation === "revert"` AND `dataSufficient === true`. One `create_improvement_issue` proposal per revert.
- **Explicit revert `reason` text** (verbatim, per SDS §5): `"Effectiveness report recommends REVERT for proposal <id>, but executable revert is out of scope. This proposal asks a human to investigate and create a manual remediation path."`
- **Exclude `suggest_routing_weight`** (user-deferred routing-weight mutation).
- **`keep` → no proposal. `investigate` → no proposal.**
- **No scheduler/cron.** Generation is a manual CLI trigger; if scheduled, wire externally.
- **Reuse, don't duplicate.** Reflection path composes the existing `RecommendationToProposal.convert`; the generator adds only the governance filters and provenance.
- **Run `gitnexus_impact` (repo `ALiX`) before editing any indexed symbol** — `adaptation-types.ts` (c.1), `recommendation-to-proposal.ts` (c.1), `adaptation.ts` (c.5). Report blast radius; proceed only if not HIGH/CRITICAL.

---

## Grounding (established by SDS + exploration — do not re-derive)

- `RecommendationToProposal.convert(rec)` (`src/adaptation/recommendation-to-proposal.ts:95-113`): static, 1:1 P5.0→P5.1 mapping, sets `status:"pending"` and spreads `rec.evidence` into `evidenceFingerprints`. Returns `null` for unknown types.
- `ReflectionReport` is written to **stdout** by `alix reflection report` (`src/cli/commands/reflection.ts:80`); user redirects: `alix reflection report > report.json`.
- `ProposalEffectivenessReport` is persisted at `.alix/adaptation/effectiveness/<proposalId>.json` via `EffectivenessStore` (`src/cli/commands/adaptation.ts:52`).
- `ApprovalGate` exposes only `approve/reject/apply` (`src/adaptation/approval-gate.ts:47,77,109`) — the generator must not import it.
- No existing scheduler in `src/`; P5.2c stays a manual CLI trigger.

---

## File Structure

| File | Role |
|------|------|
| `src/adaptation/adaptation-types.ts` | **Modify** — add optional `provenance?: "auto" \| "manual"` to `AdaptationProposal` |
| `src/adaptation/recommendation-to-proposal.ts` | **Modify** — leave `provenance` undefined (manual) |
| `src/adaptation/auto-proposal-generator.ts` | **Create** — `AutomaticProposalGenerator` class with reflection + effectiveness methods |
| `tests/adaptation/auto-proposal-generator.vitest.ts` | **Create** — TDD |
| `src/cli/commands/adaptation.ts` | **Modify** — add `generate` subcommand + `runGenerate` + help line |
| `tests/cli/commands/adaptation-generate.vitest.ts` | **Create** — CLI TDD |

---

## Task 1: P5.2c.1 — `provenance` field on `AdaptationProposal`

**Files:**
- Modify: `src/adaptation/adaptation-types.ts`
- Modify: `src/adaptation/recommendation-to-proposal.ts`
- Test: `tests/adaptation/adaptation-types.provenance.vitest.ts` (or extend existing)

**Interfaces:**
- Produces: `AdaptationProposal.provenance?: "auto" | "manual"` (optional, backwards-compatible)

- [ ] **Step 0: Impact analysis** — `gitnexus_impact({ target: "AdaptationProposal", direction: "upstream", repo: "ALiX" })`. Expected LOW (optional field, additive). Also confirm the existing `RecommendationToProposal.convert` is unchanged in behavior.
- [ ] **Step 1: Write failing test** — assert (a) a constructed `AdaptationProposal` without `provenance` type-checks; (b) `provenance: "auto"` is accepted; (c) the existing `RecommendationToProposal.convert` output leaves `provenance` undefined.
- [ ] **Step 2: Run → FAIL** (optional field not yet declared).
- [ ] **Step 3: Implement** — add to `src/adaptation/adaptation-types.ts` inside `AdaptationProposal`:
  ```ts
  /** How this proposal was generated: "auto" by AutomaticProposalGenerator, "manual" by RecommendationToProposal.convert (default). */
  provenance?: "auto" | "manual";
  ```
  Do **not** change `recommendation-to-proposal.ts` — its output leaves `provenance` undefined (treated as manual).
- [ ] **Step 4: Run → PASS**, then run the full adaptation suite to confirm no regression.
- [ ] **Step 5: Commit** — `feat(p5.2c.1): add provenance field to AdaptationProposal`.

---

## Task 2: P5.2c.2 — `AutomaticProposalGenerator` core

**Files:**
- Create: `src/adaptation/auto-proposal-generator.ts`
- Test: `tests/adaptation/auto-proposal-generator.vitest.ts`

**Interfaces:**
- Consumes: `ReflectionReport` (for `generateFromReflection`), `ProposalEffectivenessReport` (for `generateFromEffectiveness`), `ProposalStore`, `EvidenceEventWriter`.
- Produces: `AutomaticProposalGenerator` class; per-method `GenerateOptions` (confidence threshold); per-method result type (e.g. `{ generated: number; skipped: number; proposals: AdaptationProposal[] }`).
- Reuses: `RecommendationToProposal.convert` for the reflection-path base proposal; **never** imports `ApprovalGate` or any applier.

- [ ] **Step 1: Write failing tests** — assert (a) constructor takes `ProposalStore` + `EvidenceEventWriter`; (b) no import of `ApprovalGate`/`AgentCardApplier`/`SkillApplier` (compile-time + grep test); (c) `generateFromReflection` returns a result object `{ generated, skipped, proposals }`; (d) `generateFromEffectiveness` returns the same shape.
- [ ] **Step 2: Run → FAIL** (module missing).
- [ ] **Step 3: Implement** `src/adaptation/auto-proposal-generator.ts`:
  ```ts
  /**
   * P5.2c — AutomaticProposalGenerator.
   *
   * Proposal-only. Composes P5.1c RecommendationToProposal.convert for the
   * reflection path; emits manual-action proposals for the effectiveness-revert
   * path. All output proposals carry provenance="auto" and status="pending".
   * NEVER imports ApprovalGate, AgentCardApplier, or SkillApplier.
   *
   * @module
   */
  import type { AdaptationProposal } from "./adaptation-types.js";
  import type { ProposalStore } from "./proposal-store.js";
  import { RecommendationToProposal } from "./recommendation-to-proposal.js";
  import type { EvidenceEventWriter } from "../workflow/evidence-writer.js";
  import type { ReflectionReport, Recommendation } from "../reflection/reflection-types.js";
  import type { ProposalEffectivenessReport } from "./effectiveness-types.js";

  export const DEFAULT_MIN_REFLECTION_CONFIDENCE = 0.7;

  export interface GenerateOptions {
    minConfidence?: number;
  }

  export interface GenerateResult {
    generated: number;
    skipped: number;
    proposals: AdaptationProposal[];
  }

  export class AutomaticProposalGenerator {
    constructor(
      private readonly store: ProposalStore,
      private readonly writer: EvidenceEventWriter,
    ) {}

    async generateFromReflection(report: ReflectionReport, opts: GenerateOptions = {}): Promise<GenerateResult> {
      // implemented in Task 3
      throw new Error("not yet implemented");
    }

    async generateFromEffectiveness(report: ProposalEffectivenessReport, opts: GenerateOptions = {}): Promise<GenerateResult> {
      // implemented in Task 4
      throw new Error("not yet implemented");
    }

    async generateFromAllEffectiveness(reports: ProposalEffectivenessReport[], opts: GenerateOptions = {}): Promise<GenerateResult> {
      let total = { generated: 0, skipped: 0, proposals: [] as AdaptationProposal[] };
      for (const r of reports) {
        const res = await this.generateFromEffectiveness(r, opts);
        total = {
          generated: total.generated + res.generated,
          skipped: total.skipped + res.skipped,
          proposals: [...total.proposals, ...res.proposals],
        };
      }
      return total;
    }
  }
  ```
  Plus a static architectural test in the test file: `grep`-style assertion that the module does NOT import `approval-gate` or `appliers/` (a lightweight sentinel test that fails if the boundary is breached in the future).
- [ ] **Step 4: Run → PASS**, then full suite.
- [ ] **Step 5: Commit** — `feat(p5.2c.2): add AutomaticProposalGenerator core (reflection + effectiveness stubs)`.

---

## Task 3: P5.2c.3 — Reflection path

**Files:**
- Modify: `src/adaptation/auto-proposal-generator.ts` (replace the `throw` in `generateFromReflection`)
- Test: extend `tests/adaptation/auto-proposal-generator.vitest.ts`

**Behavior:**
- Iterate `report.recommendations`.
- **Exclude** `routing_adjustment` (user-deferred). Skip + count as `skipped` with a clear skip-reason tag.
- Apply `minConfidence` (default `0.7`): skip if `rec.confidence < threshold`.
- For each surviving recommendation: call `RecommendationToProposal.convert(rec)`. If it returns `null` (unknown type), skip.
- Set `provenance: "auto"` on the resulting proposal.
- Save via `store.save(proposal)`.
- Emit `writer.recordAdaptationProposed(proposal.id, { ..., provenance: "auto" })`.
- Return `{ generated, skipped, proposals }`.

- [ ] **Step 1: Failing tests** — assert (a) a recommendation with `confidence < 0.7` is skipped; (b) `routing_adjustment` is skipped; (c) a high-confidence `capability_gap` produces a `pending` proposal with `provenance: "auto"` and emits exactly one `adaptation_proposed` evidence with `provenance: "auto"` in the payload; (d) an unknown recommendation type returns `null` and is skipped (no save, no evidence).
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** the method body (TDD code in the task; reuse `RecommendationToProposal.convert`; do not duplicate action-mapping).
- [ ] **Step 4: Run → PASS**, full suite.
- [ ] **Step 5: Commit** — `feat(p5.2c.3): reflection path in AutomaticProposalGenerator (confidence threshold, exclude routing_adjustment, provenance=auto)`.

---

## Task 4: P5.2c.4 — Effectiveness revert path

**Files:**
- Modify: `src/adaptation/auto-proposal-generator.ts` (replace the `throw` in `generateFromEffectiveness`)
- Test: extend `tests/adaptation/auto-proposal-generator.vitest.ts`

**Behavior:**
- If `report.recommendation !== "revert"` → return `{ generated: 0, skipped: 1, proposals: [] }` (skip `keep` and `investigate`).
- If `report.dataSufficient !== true` → skip (count 1) — insufficient data already classified as `investigate`; we don't auto-generate from it.
- Otherwise: build a `create_improvement_issue` proposal with:
  - `id`: `nextProposalId()` (mirror the existing helper's date+counter scheme; reuse or replicate minimally — see below)
  - `createdAt`: `new Date().toISOString()`
  - `status`: `"pending"`
  - `action`: `"create_improvement_issue"`
  - `target`: `{ kind: "issue", title: "Investigate revert of proposal <id>" }` (derived from source proposalId)
  - `payload`: `{ sourceProposalId, assessedAt, primaryMetric, reason }`
  - `sourceRecommendationType`: `"effectiveness_revert"` (distinct marker so the audit trail can identify auto-from-revert proposals)
  - `sourceConfidence`: `1` (the revert decision is binary; we don't have a confidence number — using `1` keeps the field satisfied; alternative: extend with an optional confidence, but `1` is the honest representation for a data-sufficient revert)
  - `evidenceFingerprints`: [`eff:${sourceProposalId}:${assessedAt}`, ...sourceProposal.evidenceFingerprints]
  - `reason`: **verbatim** — `"Effectiveness report recommends REVERT for proposal <id>, but executable revert is out of scope. This proposal asks a human to investigate and create a manual remediation path."`
  - `provenance`: `"auto"`
- Save via `store.save(proposal)`; emit `adaptation_proposed` evidence with `provenance: "auto"`.
- Return `{ generated: 1, skipped: 0, proposals: [p] }`.
- `generateFromAllEffectiveness` (already stubbed in Task 2) sums results across reports.

**Reuse note on proposal id generation:** the existing `nextProposalId()` in `recommendation-to-proposal.ts` is module-local. For Task 4, replicate the `prop-YYYY-MM-DD-NNN` scheme in a small shared helper (either export from `recommendation-to-proposal.ts` or a tiny `proposal-id.ts`). Recommend: export `nextProposalId` from `recommendation-to-proposal.ts` (small refactor, single source of truth) and import it in the generator.

- [ ] **Step 1: Failing tests** — assert (a) `keep` report → skipped, no save, no evidence; (b) `investigate` report → skipped; (c) `revert` + `dataSufficient: false` → skipped; (d) `revert` + `dataSufficient: true` → produces one `create_improvement_issue` proposal with the verbatim `reason`, `provenance: "auto"`, `sourceRecommendationType: "effectiveness_revert"`, and emits `adaptation_proposed` evidence; (e) the manual-action warning still fires when this proposal is later `apply`-ed (regression check against the P5.1g manual-action handling — mirror the manual-action test from the adaptation CLI test).
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** the method body. Export `nextProposalId` from `recommendation-to-proposal.ts` (small refactor) and import it.
- [ ] **Step 4: Run → PASS**, full suite.
- [ ] **Step 5: Commit** — `feat(p5.2c.4): effectiveness revert path — manual-action proposal with explicit reason`.

---

## Task 5: P5.2c.5 — CLI `alix adaptation generate`

**Files:**
- Modify: `src/cli/commands/adaptation.ts` (new subcommand + `runGenerate` + help line + imports)
- Test: extend `tests/cli/commands/adaptation.vitest.ts` (or create `adaptation-generate.vitest.ts` mirroring the P5.2b CLI test style)

**Subcommand:**
- Exactly one of `--reflection <path>`, `--effectiveness <id>`, `--all-effectiveness` (zero/multiple → error).
- `--min-confidence <n>` optional (default `0.7`).
- **No `--approve`, no `--apply`** — hard rule.

**`--reflection <path>` flow:** read the file, parse as `ReflectionReport`, call `generator.generateFromReflection(report, { minConfidence })`, print summary.

**`--effectiveness <id>` flow:** load from `EffectivenessStore`, call `generateFromEffectiveness(report)`, print summary.

**`--all-effectiveness` flow:** load all from `EffectivenessStore`, call `generateFromAllEffectiveness(reports, { minConfidence })`, print summary.

**Output format (concise):**
```
Generated: <n> proposal(s) [<id1>, <id2>, ...]
Skipped:   <k> (<breakdown: low-confidence: N, routing_adjustment: N, keep/investigate: N, insufficient-data: N>)
```

- [ ] **Step 0: Impact analysis** — `gitnexus_impact({ target: "handleAdaptationCommand", direction: "upstream", repo: "ALiX" })`. Expected LOW.
- [ ] **Step 1: Failing tests** — assert (a) `--reflection` on a valid report creates `pending` `provenance:"auto"` proposals; (b) zero source flags → usage error + exit 1; (c) two source flags → usage error + exit 1; (d) `--effectiveness <id>` on a `revert` produces one `create_improvement_issue`; (e) `--all-effectiveness` iterates; (f) **the CLI NEVER calls an applier or sets a proposal to `approved`/`applied`** (architectural assertion: grep test or post-condition check that no agent-card or skill file changed).
- [ ] **Step 2: Run → FAIL**.
- [ ] **Step 3: Implement** in `adaptation.ts` — imports (`AutomaticProposalGenerator`, `EffectivenessStore` already imported), switch case, `runGenerate`, help line in `printUsage`.
- [ ] **Step 4: Run → PASS**, full adaptation CLI suite.
- [ ] **Step 5: Commit** — `feat(p5.2c.5): add alix adaptation generate CLI (reflection | effectiveness | --all-effectiveness)`.

---

## Task 6: P5.2c.6 — Integration verify + PR

- [ ] **Step 1: Full suite** — `npx vitest run tests/adaptation/ tests/reflection/ tests/security/evidence/ tests/cli/  --config vitest.config.mts` and `npx tsc --noEmit`. All green.
- [ ] **Step 2: Architectural assertions re-run** — confirm `auto-proposal-generator.ts` does NOT import `approval-gate` or any applier; confirm no `--approve`/`--apply` flag on the `generate` subcommand.
- [ ] **Step 3: `gitnexus_detect_changes({ scope: "all", repo: "ALiX" })`** — confirm only expected symbols changed, risk LOW.
- [ ] **Step 4: Open PR** (base `main`) with title `P5.2c: AutomaticProposalGenerator — proposal-only, human-gated (#NN)`. Body summarizes: SDS at `docs/superpowers/specs/2026-06-19-p5-2c-automatic-proposal-generation-design.md`; the governance line (`auto-generate ≠ auto-approve ≠ auto-apply`); provenance field; the explicit revert reason; what's out of scope (batch approval, executable revert, auto-apply, routing-weight mutation, scheduler).

---

## Verification (end-to-end)

```bash
npx vitest run tests/adaptation/ tests/reflection/ tests/security/evidence/ tests/cli/ --config vitest.config.mts
npx tsc --noEmit
```

Manual: `alix reflection report > report.json && alix adaptation generate --reflection report.json` produces pending `provenance:"auto"` proposals; `alix adaptation generate --effectiveness <id>` on a revert produces the verbatim-reason manual-action proposal; `--all-effectiveness` iterates; no agent-card, skill, or proposal-status mutation occurs at any point; the only evidence recorded by generation is `adaptation_proposed` (one per generated proposal).

---

## Self-Review

- **Spec coverage:** SDS answers 1–7 ✓. Tightening (explicit `reason`) incorporated into c.4 ✓. Pending-only ✓. No gate/applier access ✓. `provenance:"auto"` ✓. Excluded types ✓.
- **Placeholders:** none — every task shows real code or test shape; the verbatim `reason` text is exact.
- **Type consistency:** `AdaptationProposal.provenance` (c.1) consumed identically in c.3/c.4; `nextProposalId` refactored to be shared (c.4) so id format stays unique across both paths.
- **Reuse:** c.3 composes `RecommendationToProposal.convert`; c.4 shares `nextProposalId`; CLI mirrors `propose`/`effectiveness` subcommand style.
- **Governance:** structural (no imports of gate/appliers in generator; no `--approve`/`--apply` flags) + procedural (tests assert pending-only, manual-action-for-revert, one-event-per-proposal) + audit (`provenance:"auto"` visible via `list`/`show`).