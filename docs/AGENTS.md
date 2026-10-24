# docs — Durable Documentation

## Purpose

Repository documentation. Dated hand-off records live at this root; domain,
architecture, agent-workflow, and implementation-design material lives in the
subtrees below.

## Ownership

| Path | Contents |
|------|----------|
| `docs/YYYY-MM-DD-<topic>.md` | Dated hand-off / status records that span subsystems |
| `docs/agents/` | Agent workflow guides (issue tracker, triage labels, domain) |
| `docs/architecture/` | Architecture plans, specs, checkpoints, reports |
| `docs/audits/` | Durable architecture evidence — evidence-graded audits, document inventory/classification, phase registry, SRAP readiness |
| `docs/audits/2026-10-23-harness-acceptance-matrix.md` | Point-in-time PRE-R001–R032 evidence reconciliation; companions record baseline provenance and legacy config consumers. Definitions, historical observations, executed tests, independent qualification and operator acceptance remain distinct. |
| `docs/audits/2026-10-23-eval-corpus-audit.md` | All 14 behavioral cases and two synthetic fixtures: exact-content and positive-guard fixes, retained scripted proof, historical repetition reconciliation and independent-qualification limits. |
| `docs/audits/2026-10-23-master-prd-traceability.md` | Master PRD v2.8 GAP-12, P0 slice: PRD-R to source-anchor/test mapping with five declared Phase 0 gaps. Located/Partial labels are not acceptance; P1–P3 unmapped. |
| `docs/audits/2026-10-23-harness-authorization.md` | Operator authorization for all remaining harness closeout work. Records that permission was granted, and separately that Gate E independence, human observations and measured numbers cannot be granted by an authorization. |
| `docs/audits/2026-10-23-gate-b-acceptance-packet.md` | Gate B acceptance packet assembled from committed evidence only. Requirement matrix, ten-stratum reconciliation, metric ledger with explicit `null` fields, provenance and uncertainty limits, blank decision record, next work order, hashed artifact manifest. Recommends HOLD; not a pass, signature or independent qualification, and authorizes no collection or spend. |
| `docs/audits/2026-10-23-gate-b-collection-proposal.md` | Priced, scoped proposal for the next Gate B real-model collection: 52 planned runs, recorded-rate estimate `$2.947558` / approved ceiling `$4.50`, frozen-input contract, capture prerequisites, stop rules. Approved at proposal scope by the operator on 2026-10-23. The §4 capture extension is implemented and tested but not yet reviewed; execution still blocked on review, the §3 pins, and the independent scorer. No spend, Gate B HOLD. |
| `docs/audits/2026-10-23-eval-false-pass-defect.md` | Fixed defect record: a provider/transport failure (429 quota) satisfied the `failed` expectation and scored as a verified refusal on the security case. Fix is `src/operations/evals/eval-admissibility.ts`; parity table in `tests/evals/eval-admissibility.vitest.ts`. |
| `docs/2026-10-23-delegate-baseline-remeasurement.md` | Dated hand-off: four real-model delegate cases re-measured on the historical gpt-4o baseline after the admissibility fix — 10/12 at $0.045688/success, delta unattributed because `c0def71d` postdates the historical sweep. Its deny-case reading was later corrected: the case was mis-specified, not the model. |
| `docs/2026-10-23-strata-repetition-pass.md` | Dated hand-off: six n=1 strata repeated on the baseline model ($1.76), plus three harness defects found — an unpassable `patch-application` case, a three-worker driver against a four-worker contract, and a fixed-delay crash kill that captured nothing. |
| `docs/2026-10-23-harness-closeout-handoff-2.md` | Dated hand-off, current: supersedes the first closeout handoff. Evaluator false-pass fix, two broken eval cases found and repaired, gpt-4o baseline re-measurement, six strata repeated, and every retracted claim marked as such. |
| `docs/harness-shim-catalog.md` | Harness shim owners, triggers, tests, retirement criteria, and measurement limits. |
| `docs/harness-review-evaluation-protocol.md` | No-model scoring protocol for future human review; protocol readiness does not imply observations or qualification. |
| `docs/harness-cutover-plan.md` | Design-only migration packages and their prerequisites; not implementation approval. |
| `docs/superseded/` | Relocated superseded material, subtree-intact |
| `docs/jev/` | Jev / System One integration docs |
| `docs/superpowers/` | Implementation specs and plans |

## Local Contracts

- Root-level `docs/*.md` are dated hand-off records: point-in-time status, landed baselines, review findings, and next steps. They are history, not live contracts — a stale instruction inside one is not binding.
- Live contracts belong in the owning `AGENTS.md` file or the design spec the record points to; a hand-off must not restate or override them.
- Reference source with workspace-relative paths so claims resolve under `pnpm check:dox`.

## Work Guidance

- Add a hand-off as `docs/YYYY-MM-DD-<topic>.md`.
- Keep the record operational: pushed baseline, open work, verification, and next steps. Delete superseded records rather than letting them accumulate.

## Verification

Docs-only; no typecheck or test applies. Run `pnpm check:dox` when `AGENTS.md` content changes.

## Child DOX Index

| Path | Scope |
|------|-------|
| `superpowers/AGENTS.md` | Implementation specs and plans |
| `jev/AGENTS.md` | Jev / System One integration docs |

`agents/`, `architecture/`, and `audits/` are indexed from `agents/domain.md`, the architecture tree, and the audit artifacts respectively; none carries a child `AGENTS.md` today. `audits/` is a durable evidence and reconciliation directory: evidence-graded audits and inventories (verified claims plus explicitly provisional rows, resolved in follow-up work) that later architecture migrations reference back to. Roadmap and readiness content inside is proposal pending its own approval gates, not an approved plan. Treat it as history, not a live contract.
