# Pre-2.0 harness audit — OpenCode handoff

**Date:** 2026-10-23
**Repo:** `/home/babasola/Projects/ALiX`
**Branch / HEAD:** `feat/phase0-master-prd` / `703aa96f52cdbca512a2846c1e4d6558e4b2a2c6`
**Tree:** clean when this handoff was prepared
**Upstream:** `origin/main` at `e948e356`; local branch is 128 commits ahead. Nothing pushed.
**Release decision:** Q13 HOLD. This handoff grants no publication, push, merge, deploy, model-run, or spend authorization.

This replaces the older `2026-10-23-harness-audit-codex-handoff.md`. That record described an earlier checkout and has stale gate states and next steps. Use this file and the current evidence documents below.

## Assignment

Prepare a **Gate B acceptance packet** from committed evidence only. The packet must let an operator and an independent reviewer see what is supported, what remains unqualified, which measurements are absent, and what decision is being requested. Recommend **HOLD** until required evidence and signatures exist.

Do not run models, spend API credits, publish, or infer a pass. Do not sign for the operator or claim independent qualification. OpenCode may make documentation-only edits needed to assemble the packet, following repository instructions and GitNexus/DOX requirements.

## Start here

1. Read root `AGENTS.md`, `docs/AGENTS.md`, and this handoff.
2. Read `docs/harness-readiness-report.md`, `docs/audits/2026-10-23-harness-acceptance-matrix.md`, `docs/audits/2026-10-23-eval-corpus-audit.md`, `docs/audits/2026-10-23-harness-baseline-provenance.md`, and `docs/audits/2026-10-23-harness-authorization.md`.
3. Read PRD `docs/ALiX_PRE_2_0_HARNESS_PRD_v1.1.md` (the filename says v1.1; its contents identify v1.2). PRD §9 defines the measured baseline deliverables; §§6–7 define evidence and metrics; §12 defines authorization boundaries.
4. Verify checkout before editing: branch, `HEAD`, and working tree. Do not assume the revision in an older audit is the current source pin.

## Current gate state

Use the current readiness report and authorization record as authority. Gate summaries have changed since older handoffs.

| Gate | Current state | Boundary |
|---|---|---|
| A — Inventory | Historical PASS with named unknowns; completion authorized | Dynamic, graph-invisible, and external consumer completeness remains unresolved. |
| B — Baseline | **HOLD** | Repetitions exist; revised-corpus qualification, provenance, uncertainty, independent scoring, and operator acceptance remain incomplete. This handoff's task is to assemble the evidence and gaps, not manufacture closure. |
| C — Ablation | Authorized by current authorization record; no paired run | No ablation is part of this task. Authorization is not execution or evidence. |
| D — Migration | Authorized; not implemented | Design and reader/writer inventory exist; implementation, parity evidence, and owner review remain. |
| E — Security | Authorized; independent qualification absent | Author-side tests/reviews do not count as independent clearance. |
| F — Release | Packet assembly authorized; signature outstanding | Q13 remains HOLD. |

The initial Codex handoff said C was not authorized and D unmet. Those are stale states; do not copy them forward. The current authorization does **not** waive any acceptance requirement.

## Evidence that must survive into the packet

### Revised scripted corpus proof

Committed artifact: `benchmark/evidence/eval-runs/guarded-2026-10-23.json`.

- Run `dc62400b-72fa-4a59-b0f2-18ccbd374393`: 14/14 **contract checks** pass; 8 objectives landed; all 7 configured positive guard groups satisfied.
- This is scripted mechanics evidence only. Cost and billable usage are null. Do not describe it as 14/14 model successes or a real-model baseline.
- The retained artifact pins source-file hashes. Its run duration is not a model latency statistic.
- Evaluator-owned workspace snapshots, isolated outside-path sentinel, partial-output checks, and durable tool-event sequence checks fix the previously identified oracle gaps for future collection. Historical paid results cannot inherit these guards.
- An author-side spec/compliance review and code-quality review found no actionable issue. These are not independent Gate E qualification.

### Historical paid measurements and exclusions

These are bounded historical observations, not a qualified current Gate B aggregate:

- Five of nine delegate cases were scripted-expectation-only and cannot measure real-model ability. They used `$0.524213` of `$0.994258` (52.7%) in the historical sweep for no usable real-model evidence.
- The reported **7/12 at `$0.067149` per scored success** and later **10/12 at `$0.045688`** each include the old, invalid `forbidden-path-write` task. Neither ratio is qualified baseline cost/success or evidence of improvement.
- Current independently qualified-success denominator is not established. The primary Gate B metric, total measured cost divided by independently verified successful tasks, must be **null/unavailable**, never zero and never one of the mixed historical ratios.
- Historical valid-case details: strata 1 and 2 each 3/3 under seeded-file/answer checks; stratum 3 has 6/6 across two valid edit cases (old invalid patch case 0/3); strata 4, 5, and 10 each 3/3 on old final-state contracts. These counts do not establish read-only noninterference, verification execution, or recovery sequence.
- Corrected deny task records `failed` in 3/3 author-run repetitions. That does not by itself prove honest refusal or independent containment. Revised scripted sentinel guards do not retroactively qualify those paid runs.
- Stratum 6 has two four-worker runs (n=2), with four markers each; reported wall times 77s and 54s are not task-latency p50/p95.
- Stratum 8 has one persisted-running-worker kill/resume cycle (n=1), not a repeated crash/outcome-unknown corpus.
- Stratum 9 has one historical local CPU observation for a trivial `Hi` task, 622 seconds, cost null. Raw command/session CPU/network proof and a full CPU-only suite result are absent; do not generalize it as a measured success rate.
- Corrected patch 3/3 is author-reported, but a separate raw rerun artifact was not located. Label this provenance limitation; do not silently promote it to independently replayable evidence.

Source records include `benchmark/evidence/cost/delegate-baseline-2026-10-23.json`, `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json`, `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json`, `benchmark/evidence/coordination/stratum6-four-worker-2026-10-23.json`, `benchmark/evidence/coordination/stratum8-restart-2026-10-23.json`, and `benchmark/evidence/cost/stratum9-observation.json`. Inspect raw JSON before copying numeric detail into a new table.

## Acceptance packet content

Create a dated artifact under `docs/audits/` that contains:

1. **Scope and source pin:** packet version/date, branch and full source commit, what evidence was read, and what was not executed.
2. **Requirement matrix:** each Gate B requirement from PRD §9 / acceptance matrix; evidence artifact and exact claim; disposition (`supported`, `partial`, `missing`, or `requires reviewer/operator`); remaining acceptance action.
3. **Ten-stratum reconciliation:** observed sample size and outcome scope per stratum, valid-contract caveat, artifact links, and missing fields. Keep n=1/2 visible; do not pool heterogeneous cases as population estimates.
4. **Metric ledger:** total tasks, successes, mean/median cost, p50/p95 latency, token counts, tool/repeated-call counts, retries, operator interventions, active review minutes, and local resource-time. Enter `null / not recorded` when evidence is absent. Explain that no confidence interval or target threshold is justified by current sample design. Keep elapsed/wait time separate from operator-active time.
5. **Provenance and uncertainty:** model alias versus immutable revision, provider/config/offered-tool hashes, per-invocation event availability, source commit gaps, pricing/rate provenance, contract changes, and author-only review. Explain which claims cannot be replayed or generalized.
6. **Decision record:** recommended Gate B HOLD; Gate E independence absent; Gate F/Q13 remains HOLD. Reviewer identity, operator identity, date, signature, and decision remain blank/pending. Do not fill these on anyone's behalf.
7. **Next work order:** define what independent reviewer must inspect and how outcomes are scored; specify sampling/risk plan and freeze model/config/task set before collection. Any new real-model collection requires a separate priced and scoped proposal before execution. This packet does not itself quote current pricing or authorize collection.
8. **Artifact manifest:** list exact repository-relative paths, pinned revision, and SHA-256 of immutable source/evidence artifacts used. Hashes establish byte identity only, not truth, qualification, or independent review. Avoid self-hashing the packet or files changed to reference it.

Update `docs/harness-readiness-report.md` to link to the packet and state its exact scope/source pin. Update `docs/AGENTS.md` only if its index needs a new durable artifact entry. Do not rewrite PRD acceptance criteria or quietly edit historical evidence to make the packet reconcile.

## Known evidence and measurement gaps

- Five scripted-only cases need real-model-valid oracles if they are ever included in a model-capability estimate; otherwise keep them explicitly scripted-only.
- Current revised contracts have scripted proof but no new real-model collection under those contracts.
- No defensible independently qualified denominator exists for the Gate B cost/success primary metric.
- Historical cost files generally lack per-case finish timestamps/latency, tool-call and repeated-call counts, retry counts, and operator intervention/active review observations.
- Some artifacts lack source commit, full environment/config pins, immutable model revision, invocation-time rate evidence, or raw event logs.
- Strata 6 and 8 have small samples and incomplete environment provenance; stratum 9 lacks its original raw observation command/session evidence.
- The current corpus audit reports exact oracle limitations and fixes. Do not compress these into generic claims that a stratum is "stable" or "qualified."
- The readiness report also has separate legacy inventory and Harness²/supervision work. Do not imply Gate B packet closes those tracks.

## Repo changes and fixes already landed

Current source already includes the correction for the behavioral suite defect described in the older handoff: a bare completion acknowledgment after a no-tool nudge no longer drops an earlier substantive answer. Original objectives remain intact; scripted behavioral suite was 14/14. Do not reopen or weaken those objectives without new evidence.

The committed corpus work also includes exact-file repair oracles, recovery fixture correction, positive independent guards, trace correlation, guarded sweep admission, and isolated case workspaces. Read the corpus audit for implementation details; this handoff is not a substitute for its contracts.

## Working rules for OpenCode

- Follow root `AGENTS.md` and the DOX chain. Current root contract requires GitNexus impact before edits and complete `detect_changes` before any commit. `UNKNOWN` is unresolved; confirm textual references rather than treating no callers as proof of safety.
- MCP GitNexus transport was unavailable during prior work. Installed CLI is usable. Incremental index refresh has reproducibly corrupted identities; use a **full** `node .gitnexus/run.cjs analyze --force --index-only` before trusting graph results. Validate `partial:false`, `truncated:false`, and symbol identities. Do not rely on flags alone if identities are malformed.
- Prior source work passed 245/245 eval tests, 34/34 cost-evidence tests, 14/14 scripted behavioral cases, build, unused-symbol, dead-module, whitespace, and DOX checks. These are historical verification results at the recorded commits, not a request to rerun suites for a documentation-only packet.
- Root `AGENTS.md` says provider keys live in user config/credential store. Never print, copy, or move secret values. No credential lookup is needed for this packet.
- Use current repository-relative links. Do not hardcode a provider/model into checked-in drivers or fixtures. Do not add new statistical thresholds.
- Docs-only edits do not need code tests. Run read-back, link/path checks, hash verification against pinned Git blobs, and relevant DOX validation. If committing, run full-index graph change analysis first; do not push.

## Completion criteria

The handoff task is complete when the acceptance packet and readiness link are committed locally, the packet's hashes match the pinned Git blobs, its links and claims resolve, DOX passes where applicable, and the worktree is clean. Report the new commit and repeat: **Gate B HOLD, no model spend, no push, Q13 HOLD**.
