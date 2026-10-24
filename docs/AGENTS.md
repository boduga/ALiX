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
| `docs/audits/2026-10-23-gate-b-acceptance-packet.md` | Gate B acceptance packet, v1.1, assembled from committed evidence and reconciled at `148dabc7` after model-independent review. Requirement matrix, ten-stratum reconciliation, metric ledger with explicit `null` fields, provenance and uncertainty limits, hashed artifact manifest, blank decision record. v1.1 corrects three false or stale statements (paid-run event retention, deletion history, GB-08) and records the Gate C retain disposition and MP-01 parity. Recommends HOLD; not a pass, signature or independent qualification, and authorizes no collection or spend. |
| `docs/audits/2026-10-23-gate-b-collection-proposal.md` | Priced, scoped proposal for the next Gate B real-model collection: 52 planned runs, recorded-rate estimate `$2.947558` / approved ceiling `$4.50`, frozen-input contract, capture prerequisites, stop rules. Approved at proposal scope by the operator on 2026-10-23. The §4 capture extension and §3 frozen-input pins are implemented and tested; execution still blocked on review, a recorded rate snapshot, and the independent scorer. No spend, Gate B HOLD. |
| `docs/audits/2026-10-23-gate-b-scoring-record-template.md` | Blank record shape for an independent Gate B scorer (GB-01..GB-14, one verdict each) plus the validator contract: `met` needs cited evidence, the reviewer must not be the author, and eligibility requires a complete declared-independent record. Unfilled; supplies no independence. |
| `docs/audits/2026-10-23-gate-b-scorer-engagement.md` | Recruitment packet for an independent GB-12 scorer: what to score, the validator rules, inputs, scoring hazards, and what an eligible record does and does not clear. No scorer engaged. |
| `docs/audits/2026-10-23-gate-b-author-only-scoring.json` | AUTHOR-ONLY scoring of GB-01..GB-14 (3 met, 7 partial, 4 missing). The validator rejects it on independence by design; it is not GB-12 evidence and must never be attached to a Gate B signature. |
| `docs/audits/2026-10-23-gate-b-model-independent-review.md` | Review of the Gate B packet by Codex (`gpt-6.1-sol`, read-only). Verdict HOLD; corrected two false claims in the packet and three errors in the author-only scoring record. Model-independent, NOT human independence, NOT GB-14 authority, NOT Gate E clearance. |
| `docs/audits/evidence/` | Raw reviewer evidence committed so a signature is verifiable: the Codex Gate B review prompt and its verbatim output, with SHA-256 recorded in the packet (§6.0). Never edit these; they are what the verdict points at. |
| `docs/audits/2026-10-23-gate-b-scoring-record-codex.json` | Model-independent GB-12 scoring record (Codex / gpt-6.1-sol, `reviewerKind: model`). Validator classifies it `model-independent` — a distinct, weaker class from human independence. Operator-accepted under packet §6.3. |
| `docs/audits/2026-10-23-gate-b-collection-run-manifest.md` | Gate B run manifest and spend gate: 7 preconditions, exact invocation, ordered plan with stop rules, and an honest spend ledger that keeps the proxy rate separate from the unknown actual bill. Not run; no spend authorized. |
| `docs/audits/2026-10-24-gate-b-collection-results.md` | 2026-10-24 Gate B collection: 45 runs across 9 cases, 36 verified, `$2.9520` at the operator gpt-4o proxy, per-case latency measured. Strata 6/8/9 not run because the projected spend would breach the `$4.50` ceiling. Records `verification-repair` 0/5 (exit-code masking) and one `forbidden-path-write` status-honesty failure as real findings, not defects to smooth over. |
| `docs/audits/2026-10-23-eval-false-pass-defect.md` | Fixed defect record: a provider/transport failure (429 quota) satisfied the `failed` expectation and scored as a verified refusal on the security case. Fix is `src/operations/evals/eval-admissibility.ts`; parity table in `tests/evals/eval-admissibility.vitest.ts`. |
| `docs/2026-10-23-delegate-baseline-remeasurement.md` | Dated hand-off: four real-model delegate cases re-measured on the historical gpt-4o baseline after the admissibility fix — 10/12 at $0.045688/success, delta unattributed because `c0def71d` postdates the historical sweep. Its deny-case reading was later corrected: the case was mis-specified, not the model. |
| `docs/2026-10-23-strata-repetition-pass.md` | Dated hand-off: six n=1 strata repeated on the baseline model ($1.76), plus three harness defects found — an unpassable `patch-application` case, a three-worker driver against a four-worker contract, and a fixed-delay crash kill that captured nothing. |
| `docs/2026-10-23-harness-closeout-handoff-2.md` | Dated hand-off, current: supersedes the first closeout handoff. Evaluator false-pass fix, two broken eval cases found and repaired, gpt-4o baseline re-measurement, six strata repeated, and every retracted claim marked as such. |
| `docs/harness-shim-catalog.md` | Harness shim owners, triggers, tests, retirement criteria, and measurement limits. |
| `docs/harness-review-evaluation-protocol.md` | No-model scoring protocol for future human review; protocol readiness does not imply observations or qualification. |
| `docs/harness-gate-c-retain-disposition.md` | Gate C decision under PRD §9's default "otherwise retain" branch: HC-01/HC-03 (and HC-02/HC-05) retained, none retired, no ablation run. Explicitly not a measured efficiency finding and not evidence of measured absence of benefit. |
| `docs/harness-pre-r024-isolation-qualification.md` | PRE-R024 isolation qualification: 6/8 controls evidenced by adversarial test (`tests/security/pre-r024-isolation-qualification.vitest.ts`), 2 deliberately unqualified (rubric containment, replay class). Gates model-backed probes; does not clear them. |
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
