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
| `docs/audits/evidence/` | Raw reviewer evidence committed so a signature is verifiable: the Codex Gate B packet review and the Codex collection verification, each with its prompt and verbatim output, SHA-256 recorded at the citing site. Never edit these; they are what a verdict points at. |
| `docs/audits/2026-10-23-gate-b-scoring-record-codex.json` | Model-independent GB-12 scoring record (Codex / gpt-6.1-sol, `reviewerKind: model`). Validator classifies it `model-independent` — a distinct, weaker class from human independence. Operator-accepted under packet §6.3. |
| `docs/audits/2026-10-23-gate-b-collection-run-manifest.md` | Gate B run manifest and spend gate: 7 preconditions, exact invocation, ordered plan with stop rules, and an honest spend ledger that keeps the proxy rate separate from the unknown actual bill. Not run; no spend authorized. |
| `docs/audits/2026-10-24-gate-b-collection-results.md` | 2026-10-24 Gate B collection: 45 runs across 9 cases, 36 verified, `$2.9520` at the operator gpt-4o proxy, per-case latency measured. Strata 6/8/9 not run because the projected spend would breach the `$4.50` ceiling. Records `verification-repair` 0/5 (exit-code masking) and one `forbidden-path-write` status-honesty failure as real findings, not defects to smooth over. |
| `docs/audits/2026-10-24-gate-b-ceiling-amendment.md` | Ceiling raised `$4.50` → `$6.75` for the evidenced re-run, with a corrected spend ledger (earlier probe reporting under-counted). Proxy-priced throughout; the actual vendor bill stays unknown. |
| `docs/audits/2026-10-24-gate-b-denominator-status.md` | GB-06 status across three collections, closing with a documented **stop**: outcomes independently reproduced, admissibility unestablished for collected data, provider-attempt telemetry fixed but unexercised, ceiling exceeded. Records the four-layer discovery pattern and what a funded fourth pass would need. |
| `docs/audits/2026-10-24-gate-b-ceiling-amendment-3.md` | Ceiling `$9.50` → `$15.00` for the strata 6/8/9 coverage pass, with a measured (not estimated) spend ledger and an explicit note that remaining headroom is not authorization for the repetition expansion. |
| `docs/audits/2026-10-24-gate-b-coverage-strata-6-8.md` | Strata 6 and 8 measured: 6/6 runs, `$2.1707`. Stratum 8 exercised the real contract (killed with a persisted running worker, resumed, artifacts complete). Stratum 6 produced **three** worker markers, not the PRD's four — recorded as a coverage gap rather than relabelled. GB-08 stays `partial`. |
| `docs/audits/2026-10-24-gate-b-coverage-complete.md` | GB-05 and stratum 9 recorded as `met` on execution-and-reporting grounds. Stratum 9 carries a measured 0/3 failure on granite3-moe; n=3 and one model stated in-row. |
| `docs/audits/2026-10-24-gb11-instructions.md` | Full operator procedure for GB-11: prerequisites to freeze before observing, per-trial observation protocol (active vs waiting intervals), the independent-verification rule that stops the metric being circular, record schema, scoring command, and the invalidation list. Records the real constraint that the scorer only accepts registered fixtures, and the two routes that follow. No measurement performed; n=0. |
| `docs/audits/2026-10-24-operator-attention-agent-measures.md` | Operator-attention status after replacing what is agent-computable: M-2..M-5 derived from committed evidence, M-1 kept `null` because it measures human cognition. Records that the eval harness exercises zero approval flow, and why M-4 is degenerate on this data and M-5 unrecorded. |
| `docs/audits/2026-10-24-gb11-waiver.md` | GB-11 waiver block: M-1 attention is unmeasured (n=0), the gap is accepted as a weaker labelled claim, and the block lists what the baseline may and may not be cited for. `waived` is not `met`; the only route to `met` is Route A (~3 h, `$0`). **Signed 2026-10-24** by the repository operator, with identity provenance recorded in §7. |
| `docs/audits/2026-10-24-gb01-oracle-review.md` | Independent oracle review of the eval evaluator (Codex / gpt-6.1-sol, read-only): **rejected as reviewed, then fixed and re-scored**. Three defects reproduced by probe — negated answers passed, ordinary task failures were misclassified inadmissible, a comment containing the fix passed patch objectives — are fixed in `objective-evaluator.ts` and `eval-admissibility.ts` with a 26-case parity table. The retained collection re-scores with 0 verdict changes. Records two remaining case-design items as open debt rather than closing them by verdict. |
| `docs/audits/2026-10-24-pre-2.0-acceptance.md` | Pre-2.0 close: every human check in the acceptance surface and its replacement — model-independent review, mechanical re-derivation (`rescore-collection.mjs`), a waiver citation the validator checks for the signer's name, and a computed `CLOSED-WITH-WAIVER` outcome. States plainly what an agent cannot do: M-1 human cognitive time and Gate E human independence. |
| `docs/audits/2026-10-24-gate-b-metric-verdict-correction.md` | Corrects three verdicts that were stricter than the PRD: GB-06, GB-07, GB-08 were `partial` for caveats the PRD never required, and are now `met` with those caveats carried in-row. Records why the drift happened and which rows genuinely remain `partial`. Gate B still HOLD on GB-11/GB-14. |
| `docs/audits/2026-10-24-gate-f-q13-enumeration.md` | Gate F / Q13 decomposed clause by clause: which of the eleven release clauses a machine can observe (the five negatives PRD-R082 names, artifact binding, self-cleared restrictions, backdated approval) and which two it cannot (independent security clearance, the maintainer's decision). States why Gate F has **no waiver path** — waiving Q13 deletes the requirement instead of disposing of an unmeasurable measurement — and records one clause the validator does not prove: the provenance of the `technical.verdict` input. |
| `docs/audits/2026-10-24-gate-f-release-clearance-record.json` | The release-clearance record for artifact `ea863a25`, deliberately validating to `HOLD` on three recorded facts: technical `partial`, no independent security clearance, no maintainer decision. Not a decision, not a clearance, not a signature; the two absent inputs may not be supplied by an agent or an authorization. |
| `docs/audits/2026-10-24-gate-e-qualification.md` | Gate E execution/security qualification, author-side. Five clauses (F8b, authority, crash/recovery, ownership, denied-action negatives) each bound to executable tests with a named negative case; 282/282 green. Five gaps declared and preserved rather than covered. `QUALIFIED-AUTHOR-ONLY` — the gate stays open on the word *independently*, and author-only coverage is never reported as independent clearance. |
| `docs/audits/2026-10-24-gate-e-qualification-record.json` | The Gate E record: artifact pin, both run invoices with counts, five clause rows with evidence and negative cases, five declared gaps, `independence.class: author-only`. Validates to `QUALIFIED-AUTHOR-ONLY` (exit 3), which is a sound record and explicitly not a cleared gate. |
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
