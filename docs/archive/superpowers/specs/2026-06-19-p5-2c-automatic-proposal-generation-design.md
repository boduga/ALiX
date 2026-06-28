# P5.2c — AutomaticProposalGenerator Design Spec (SDS)

> **Status:** SDS only — awaiting your review before the implementation plan is written.
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-19-p5-2c-automatic-proposal-generation.md` (implementation plan).
> **Spec home (on approval):** `docs/superpowers/specs/2026-06-19-p5-2c-automatic-proposal-generation-design.md`.
> **Governs:** `feature/p5.2c-automatic-proposal-generation` branch, off `main` at `9d4b5975` (tagged `alix-p5.2b-complete`).

## Context — why this now

P5.1 closed the propose→approve→apply loop with a hard governance gate (no approval → no mutation). P5.2b added measurement (before/after metrics + `keep | revert | investigate`). The remaining step in the staged plan is **automatic proposal generation** — producing pending `AdaptationProposal`s from machine-readable inputs so a human doesn't have to run `alix adaptation propose <report.json>` by hand every time. This SDS defines the design BEFORE any code, preserving the governance-first discipline that has kept P4.5→P5.2b safe.

## Hard governance boundary (non-negotiable)

```
auto-generate  ≠  auto-approve
auto-generate  ≠  auto-apply
```

Every auto-generated proposal is created with `status: "pending"`. The generator **NEVER** calls `ApprovalGate.approve`, `.reject`, or `.apply`, and **NEVER** invokes an applier. Human approval is the sole gatekeeper of mutation. This is the same invariant P5.1 established and P5.2b honored.

---

## The 7 design questions

### 1. What inputs can generate proposals?

Two machine-readable inputs, both already produced by shipped ALiX commands:

| Input | Source command | Shape consumed | Produced on disk / stdout |
|---|---|---|---|
| **ReflectionReport** | `alix reflection report` | `{ generatedAt, observations[], recommendations[], metrics, summary }` | **stdout** (user redirects: `alix reflection report > report.json`) |
| **EffectivenessReport** | `alix adaptation effectiveness <id>` | `{ proposalId, assessedAt, appliedAt, windowDays, metricsBefore, metricsAfter, primary, dataSufficient, recommendation, reason }` | `.alix/adaptation/effectiveness/<proposalId>.json` |

The generator consumes these as **read-only inputs** — it never mutates the reflection store or the effectiveness store.

### 2. What proposal types are allowed?

The auto-generator produces only **proposals that are safe to auto-generate**, meaning:
- They map to a `ProposalAction` whose approval would, even if granted, NOT cause machine-side mutation that the governance line has not sanctioned.

This yields the following allow-list:

| `ProposalAction` | `target.kind` | Why allowed | Source input |
|---|---|---|---|
| `create_agent_card` | `agent_card` | Auto-applicable mutation, but requires explicit `approve`→`apply` (gate) | Reflection (`capability_gap`) |
| `update_agent_card` | `agent_card` | Same as above | Reflection (`agent_card_update`) |
| `adjust_skill_definition` | `skill` | Same as above | Reflection (`skill_revision`) |
| `create_improvement_issue` | `issue` | **Manual-action proposal** — when approved and `apply`-ed, the P5.1g CLI prints "manual action required" guidance and exits cleanly. Cannot mutate. | Reflection (`process_change`) AND Effectiveness (`revert`) |

**Explicitly excluded from auto-generation (governance reasons):**

| `ProposalAction` | Why excluded |
|---|---|
| `suggest_routing_weight` | Per user directive: routing-weight mutation is deferred. (Also: the P5.1g CLI already handles this as manual-action, but auto-generating it would still create proposals with no auto-mutation path and the user explicitly deferred it.) |

Note: `add_capability` is a `ProposalAction` but is NOT mapped from any `RecommendationType` (it is produced by applier-internal flows, not reflection), so it is not in the auto-generator's scope.

The auto-generator will **refuse** (skip + log) any input that maps to an excluded action. It will also refuse inputs that map to nothing (defensive: unknown recommendation types already return `null` from the existing converter).

### 3. What confidence thresholds are required?

**Two thresholds**, both configurable per-invocation with sensible defaults:

**(a) From ReflectionReport** — gate on the recommendation's `confidence` field (number, 0..1):

- Default minimum: `MIN_REFLECTION_CONFIDENCE = 0.7`
- Recommendations with `confidence < threshold` are **skipped** (no proposal created). Low-confidence recommendations remain a *manual* decision (`alix adaptation propose <report.json>` still works as today — it doesn't enforce the threshold).
- Rationale: a low-confidence reflection recommendation should not auto-become a pending proposal that a human feels pressure to clear. Keeping it manual preserves the human's right to ignore.

**(b) From EffectivenessReport** — gate on the report's `dataSufficiency`:

- The auto-generator only consumes `revert` effectiveness reports where `dataSufficient === true`.
- A `revert` with insufficient data (which the P5.2b reporter already classifies as `investigate` due to the `dataSufficient` check) does NOT auto-generate — it stays a `investigate` advisory for a human to read.
- This means the effectiveness→proposal pipeline only fires when the before/after comparison is statistically meaningful, preventing spurious revert proposals from noisy windows.

### 4. What evidence must be linked?

Every auto-generated proposal MUST carry provenance that lets a human trace it back to its source.

**Type addition (small, necessary):**

Add an optional field to `AdaptationProposal`:

```ts
provenance?: "auto" | "manual";   // default "manual" for the existing converter
```

- The existing `RecommendationToProposal.convert` (P5.1c) continues to produce `provenance: undefined` (treated as `"manual"`) — no behavior change.
- The auto-generator sets `provenance: "auto"` on every proposal it creates, so the CLI (`alix adaptation list`) and the audit trail can distinguish machine-suggested vs. human-converted proposals.

**`evidenceFingerprints` payload:**

- **From ReflectionReport:** `[...rec.evidence]` (the same fingerprint strings the existing converter uses — fingerprints from the four analyzers).
- **From EffectivenessReport (`revert`):** the source proposal's `evidenceFingerprints` plus the effectiveness report's `assessedAt` and `primary` metric as a synthetic fingerprint (`eff:${proposalId}:${assessedAt}`), so a human can locate both the original proposal and the measurement that triggered the new proposal.

**Lifecycle evidence (mirroring P5.1g `propose`):**

- Each auto-generated proposal triggers exactly one `adaptation_proposed` evidence event via `EvidenceEventWriter.recordAdaptationProposed`, with the `provenance` field in the payload.
- No `adaptation_approved` / `adaptation_rejected` / `adaptation_applied` evidence is emitted by the generator (those are the gate's job, and the gate is not involved at generation time).

### 5. What safety rules prevent mutation?

The safety boundary is enforced by **structural + procedural** rules:

**Structural (cannot be bypassed without code changes):**
1. The generator instantiates `ProposalStore` and `EvidenceEventWriter` only. It does **not** instantiate `ApprovalGate`, any applier, or any direct file writer for agent cards / skills.
2. All proposals are created with `status: "pending"`. There is no code path in the generator that sets `status` to `approved` or `applied`.
3. The generator never calls `proposalStore.update(...)` to change status; proposals are write-once (`save`), then immutable until a human approves.

**Procedural (enforced by tests + review):**
4. A dedicated test asserts that calling `generate` on a ReflectionReport produces only `pending` proposals and emits only `adaptation_proposed` evidence — never `adaptation_approved`/`_applied`.
5. A dedicated test asserts that calling `generate` on a `revert` effectiveness report produces exactly one `create_improvement_issue` proposal (manual-action, cannot mutate).
6. The CLI subcommand's name (`generate`) and help text must explicitly state that auto-generation does NOT approve or apply.

**Audit:**
7. Every auto-generated proposal carries `provenance: "auto"` and is visible via `alix adaptation list` / `show` (P5.1g), so a human can audit what was auto-suggested.

### 6. What CLI command should expose generation?

Single new subcommand under `alix adaptation`:

```
alix adaptation generate --reflection <report.json>
alix adaptation generate --effectiveness <id>
alix adaptation generate --all-effectiveness
```

**Rules:**
- Exactly **one** source flag per invocation. Zero or multiple → error and usage.
- `--reflection <path>` reads a ReflectionReport JSON file (the user runs `alix reflection report > report.json` then this).
- `--effectiveness <id>` reads `.alix/adaptation/effectiveness/<id>.json` and, if its `recommendation` is `revert` and `dataSufficient === true`, generates one `create_improvement_issue` proposal.
- `--all-effectiveness` iterates every persisted effectiveness report and applies the same rule per report (so `keep` → no proposal, `investigate` → no proposal, `revert`+sufficient → one manual-action proposal per revert).
- `--min-confidence <n>` overrides the default `0.7` reflection threshold.
- Output: prints a summary of what was generated (`Generated N proposal(s): <id list>`) and any skips (`Skipped: <count> low-confidence / Skipped: <count> keep / Skipped: <count> insufficient-data`).
- No `--apply` / `--approve` flags exist on this subcommand. There is no shortcut to mutation.

This is intentionally **not** a long-form flag-soup; it matches the existing `alix adaptation` subcommand style (`list --status`, `show`, `propose`, `approve`, `reject`, `apply`, `effectiveness`).

### 7. What is explicitly out of scope?

Per user directive and the staged plan:

| Out of scope | Why | Where it belongs |
|---|---|---|
| **Batch approval** (approving many pending proposals at once) | Still human-gated; one-at-a-time approval preserves deliberate review | P5.2d |
| **Executable revert** | Appliers store no before-snapshot; cannot auto-execute revert | P5.2e (after before-snapshotting + a `revert` ProposalAction) |
| **Self-mutation** | The whole point of the gate is to prevent this | Never, by design |
| **Auto-apply** | Would violate `auto-generate ≠ auto-apply` | Never |
| **Routing-weight mutation** (`suggest_routing_weight` auto-generation) | Deferred per user | Future, gated on explicit decision |
| **Autonomous scheduling / cron** | No background trigger is introduced. The generator is a manual CLI invocation. If scheduled generation is wanted, wire the CLI into an external scheduler — the generator itself stays synchronous and explicit. | Future, if ever |
| **Modifying the P5.1c converter or the ApprovalGate** | Out of concern; the auto-generator composes them but does not change them | — |
| **Effectiveness-driven `keep` follow-on proposals** | `keep` means it worked; auto-generating follow-on mutations would be speculative | — |
| **Effectiveness-driven `investigate` proposals** (beyond `revert`) | Conservative default: only `revert` auto-generates. `investigate` stays an advisory in the effectiveness report. (Design extension possible later — flagged below.) | — |

---

## Suggested P5.2c implementation scope (6 tasks, mirroring the P5.1/P5.2b structure)

| Task | Deliverable |
|---|---|
| **P5.2c.1** | Add `provenance?: "auto" \| "manual"` to `AdaptationProposal` (backwards-compatible optional field); update `RecommendationToProposal.convert` to leave it undefined (manual). |
| **P5.2c.2** | `AutomaticProposalGenerator` types + class: `generateFromReflection(report, opts)` and `generateFromEffectiveness(report, opts)`. Reuses `RecommendationToProposal.convert` for the reflection path; composes with `ProposalStore.save` and `EvidenceEventWriter.recordAdaptationProposed`. Pure-compute + I/O; the gate is **never** touched. |
| **P5.2c.3** | Reflection-path implementation: confidence threshold filter, exclude `routing_adjustment`, produce `pending` proposals with `provenance: "auto"`, emit one `adaptation_proposed` evidence event per proposal. |
| **P5.2c.4** | Effectiveness-path implementation: only `revert` + `dataSufficient === true` → one `create_improvement_issue` (manual-action) proposal per revert. The generated proposal's `reason` field MUST read (verbatim): `"Effectiveness report recommends REVERT for proposal <id>, but executable revert is out of scope. This proposal asks a human to investigate and create a manual remediation path."` Carry source `proposalId` + `assessedAt` as the evidence fingerprint. |
| **P5.2c.5** | CLI: `alix adaptation generate --reflection <report.json> \| --effectiveness <id> \| --all-effectiveness [--min-confidence <n>]` wired into `src/cli/commands/adaptation.ts` (same module pattern as `propose` and `effectiveness`). Hard rule: exactly one source flag, no approve/apply shortcuts. |
| **P5.2c.6** | Integration verify + PR: full suite + `tsc --noEmit` + `gitnexus_detect_changes`; PR title `P5.2c: AutomaticProposalGenerator — proposal-only, human-gated (#NN)`; tag `alix-p5.2c-complete` on merge. |

## Design notes / open decisions (for your review)

1. **`keep` does not auto-generate.** Confirmed in Q7. Just confirming the silence is intentional.
2. **`investigate` does not auto-generate (only `revert` does).** Confirmed in Q7. If you want `investigate` → `create_improvement_issue` too, say so and I'll widen the effectiveness path.
3. **`provenance` field** (Q4). Adds one optional field to `AdaptationProposal`. Backwards-compatible (optional, default `manual`). The alternative — encoding provenance into `sourceRecommendationType` as a prefix — is uglier and breaks the existing 1:1 mapping. I prefer the field.
4. **No scheduler.** The generator is purely synchronous and manual-trigger. If you eventually want `cron`-driven generation, it lives outside this code (an external `cron` calling `alix adaptation generate …`).
5. **Manual-action proposals are the safe vehicle for `revert`.** Because executable revert is deferred (P5.2e), the auto-generator turns `revert` into a `create_improvement_issue` proposal that a human investigates. This is governance-safe AND actionable — the proposal lands in the store, gets evidence, and the human sees it on `alix adaptation list` with a clear "manual action required" message when they go to apply it. **The `reason` field is explicit and verbatim** so no one mistakes the proposal for an automated rollback: `"Effectiveness report recommends REVERT for proposal <id>, but executable revert is out of scope. This proposal asks a human to investigate and create a manual remediation path."`

## Self-check against the user's 7 questions

| Q | Answer |
|---|---|
| 1. Inputs | ReflectionReport (file), EffectivenessReport (persisted). |
| 2. Proposal types | create_agent_card, update_agent_card, adjust_skill_definition, create_improvement_issue. **Excludes** suggest_routing_weight. |
| 3. Confidence thresholds | Reflection: `confidence >= 0.7` (configurable). Effectiveness: only `revert` + `dataSufficient === true`. |
| 4. Evidence | `provenance: "auto"` field + `evidenceFingerprints` (source rec.evidence or source proposal + assessedAt) + one `adaptation_proposed` lifecycle event. |
| 5. Safety | Structural (no gate, no applier, pending-only) + procedural (tests assert pending-only + manual-action-only for revert) + audit (`provenance` visible). |
| 6. CLI | `alix adaptation generate --reflection <report.json> \| --effectiveness <id> \| --all-effectiveness [--min-confidence <n>]`. |
| 7. Out of scope | Batch approval, executable revert, self-mutation, auto-apply, routing-weight mutation, autonomous scheduling. |

---

**This is the SDS only.** Once you approve (or request changes to) this design, I'll produce the implementation plan (the 6-task P5.2c.1–c.6 breakdown) in `docs/superpowers/plans/2026-06-19-p5-2c-automatic-proposal-generation.md`, then execute via subagent-driven development.
