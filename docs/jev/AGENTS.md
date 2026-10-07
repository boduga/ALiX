# docs/jev — Jev / System One Integration Docs

## Purpose

Durable documentation for the ALiX × TypeSafe System One (Jev) integration:
the design spec, the delivery plan, and the current status. This is a docs
boundary, not a code boundary — it owns what the integration *is* and *where it
stands*, never how any source file works (that lives in the `AGENTS.md` next to
the code).

## Ownership

| Doc | Authoritative for |
|-----|-------------------|
| `ALiX-Jev-Architecture-Design.md` | The design spec: bounded decisions, invariants JEV-1..JEV-10, architectural boundaries. |
| `ALiX-Jev-Engineering-HandOff.md` | Context, locked decisions, constraints, implementation boundaries. |
| `ALiX-Jev-Implementation-Plan.md` | Phases J0–J6, tasks, exit criteria, PR strategy, stop conditions. |
| `ALiX-Jev-J0-Integration-Points.md` | The read-only inventory of classifier/routing/governance seams. |
| `Jev-Vendor-Research.md` | **Dated third-party snapshot** of what TypeSafe claims about Jev: what it is, pricing, versions, limits, evals, and the primary sources for each claim. Vendor statements, not ALiX state. |
| `ALiX-Jev-Status.md` | **Current state**: what landed, what is live-verified, what is deliberately not done, the shipped wiring decision and how to activate it, caveats. |
| `T3-selection-evaluation-preregistration.md` | The **frozen** T3 evaluation contract: eligibility tracks + exclusion codes, blind appropriateness labelling, outcome/gap-closure labels, the 30-scope/10-disagreement checkpoint. Amendments go in its own table. |
| `T3-d-corpus-collection-runbook.md` | The T3-d **procedure**: cohort header + immutability rule, the 40-task family matrix (no expected winning tool encoded), the per-run steps, tagging rules, failure/retry rules, and the ledger schema (collection facts vs label state). Policy stays in the pre-registration. |
| `cohorts/<cohortId>.header.json`, `cohorts/<cohortId>.ledger.jsonl` | Per-cohort collection artifacts: the immutable identity header and one row per frozen scope. Collection facts only; labels live in the labelling store and are joined later. |
| `T3-final-report-t3d-2026-09-28-c.md` | The T3 result: blind selection-time appropriateness and offline outcome-level gap closure, completion, latency, represented-family limitations, and next work. Supersedes the checkpoint report of the same cohort. |
| `cohorts/<cohortId>.corpus.json`, `cohorts/<cohortId>.labels.jsonl`, `cohorts/<cohortId>.closeout.md` | The frozen corpus (the artifact — re-scoring is not idempotent), the committed label records, and the closeout with findings + evidence hashes. |

## Local Contracts

- **Status lives in exactly one place.** `ALiX-Jev-Status.md` is the single
  source for "where did this land". Do not restate phase/verification state in
  the spec docs; they state intent. When a phase lands, a mapping is
  live-verified, or a decision is made, update the status doc and nothing else.
- **The spec docs describe intent, not progress.** Architecture, Hand-Off, and
  Plan are the design. If implementation legitimately diverges from the spec,
  correct the spec — do not let the status doc become a second spec.
- **Verified facts must be traceable to code.** Claims about the live wire
  shape belong in `src/decision/engines/jev-protocol.ts` (where
  `JEV_WIRE_FORMAT_STATUS` records the verification) with the status doc
  summarising. Never assert a wire detail here that the protocol types do not.
- **Caveats are part of the record.** Circular fixture metrics, a single
  adversarial fixture, and a small Noul corpus must stay listed as caveats.
  Removing a caveat requires the evidence that retires it.
- **Measurement policy and procedure are separate documents.** The
  pre-registration owns what may be counted (codes, labels, checkpoint); the
  runbook owns how a cohort is collected. Changing what may be counted is an
  amendment to the pre-registration — never a silent edit to the runbook.
- **A failed sample is data, not noise.** A scorer failure or a scope that
  produced no observation is recorded with its reason; retries get a new sample
  identity rather than replacing the failure, so completion rates stay honest.
- **`Jev-Vendor-Research.md` is a vendor record, never a status source.** Its
  pricing, version, and limit figures are a snapshot dated in the document's own
  `Date:` header and may drift; current engine configuration lives in code. Treat it as
  background on what the vendor said, never as ALiX state: where the two could
  be confused, the code and `ALiX-Jev-Status.md` win. Preserve primary-source provenance so later disagreements can be traced.
- **Name collision:** `src/cli/commands/decision/` is the governance-lens CLI
  and is unrelated to `src/decision/`. The Jev surface is `alix jev`.

## Work Guidance

- Read `ALiX-Jev-Status.md` first; it answers "is this already done?" faster
  than the plan.
- Read the Plan when adding a phase or deciding whether an exit criterion is
  met; read the Architecture when questioning a boundary or an invariant.
- When the runtime wiring decision is made or changes, update §5 of the status
  doc — that section is the handover's most load-bearing part.

## Verification

Confirm the status doc still matches reality before trusting or editing it:

```bash
# Live-verified mappings and current engine/config state
alix jev status

# Local replay is free; confirms corpora and baselines still behave
alix jev replay --engine local --compare local

# Confirm agent/runtime/policy/provider/kernel modules do not directly import decision code.
# Tool handlers and run/observability candidate tracing have separate allowed boundaries.
rg -n 'from "[^"]*decision/' src/agent src/runtime src/policy src/providers src/kernel
```

`journal records: 0` means the tool is **wired but not activated (or not yet
used) here** — default `mode: "baseline"` journals nothing; a non-zero count
means experiment pairs are accumulating and §5 of the status doc owns the gate.
The search must stay empty for the listed directories. Tool handlers may call
decision services; run and observability modules may import frozen-candidate
trace types and helpers. These imports do not activate the offline scorer.
A new direct import in a listed directory requires boundary review and a
corresponding status update.

## Child DOX Index

None.
