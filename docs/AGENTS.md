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
| `docs/audits/2026-10-23-master-prd-traceability.md` | Master PRD v2.8 GAP-12, P0 slice: PRD-R to source-anchor/test mapping with five declared Phase 0 gaps. Located/Partial labels are not acceptance; P1–P3 unmapped. |
| `docs/audits/2026-10-23-harness-authorization.md` | Operator authorization for all remaining harness closeout work. Records that permission was granted, and separately that Gate E independence, human observations and measured numbers cannot be granted by an authorization. |
| `docs/audits/2026-10-23-eval-false-pass-defect.md` | Fixed defect record: a provider/transport failure (429 quota) satisfied the `failed` expectation and scored as a verified refusal on the security case. Fix is `src/operations/evals/eval-admissibility.ts`; parity table in `tests/evals/eval-admissibility.vitest.ts`. |
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
