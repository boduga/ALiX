# Pre-2.0 harness acceptance reconciliation — 2026-10-23

**Verdict: OPEN; Gate B HOLD.** This is an evidence assessment, not self-certification, ablation authority, or release clearance.
**Requirements:** [PRD v1.2](../ALiX_PRE_2_0_HARNESS_PRD_v1.1.md) (filename retained).
**Source reviewed:** local `main`, `c0def71d32f430d336b2cae7d749aaec0043bb11`;
clean tracked tree at entry, Node v26.11.0, package 0.6.0. Historical release pin:
`4ac6df14` / tree `8bf5ac2b6dfaeccaa69567410e32e6f7a768a305`.
The source comparison spans 193 files (25,422 additions / 268 deletions), not a
newly qualified release. Reproduce with `git diff --stat 4ac6df14..c0def71d`.
`main` was 104 commits ahead of the local `origin/main` tracking ref; no remote
fetch or publication performed. This assessment does not certify every intervening change.

> **Agent-driven contract amendment — 2026-10-28.** Harness PRD v1.2 now removes routine human-in-the-loop planning, grading, review, remediation and readiness assessment. Historical operator approvals/signatures below remain factual provenance, but they are no longer Harness-local completion criteria. Active acceptance now uses independent verifier/critic agents, deterministic oracles, and machine-verifiable delegated authority. If authority is absent, the result is durable `BLOCKED`; no agent may self-authorize. Gate F in this Harness program is a readiness handoff, not an in-loop human release decision.


Reconciled again at `c1727aa5` for PRE-R002, PRE-R005, PRE-R009, PRE-R010,
PRE-R011, PRE-R017, PRE-R020 and PRE-R031. Reconciled at `9e0ae4dd` for
PRE-R006 (delegate deny-case: honest-refusal reading excluded; reported status
string unrecovered).

Corpus/evidence pass at `a4ce4980` plus working changes:
[complete case audit](2026-10-23-eval-corpus-audit.md). PRE-R005/006 and Gate B
below now include later retained repetitions, deny-task correction and explicit
oracle limits. Other rows retain their earlier source scope.

**Authorization pass (2026-10-23).** The operator authorized all remaining work,
recorded in `docs/audits/2026-10-23-harness-authorization.md`. This pass re-read **every one
of the 32 requirement rows** and the six gates against one question: *was this
row blocked on authority, or on something an approval cannot supply?*

- **Blocked on authority only** → now marked authorized, with the run that still
  has to happen named (PRE-R007, R008, R024, R032).
- **Blocked on missing evidence** → unchanged; an approval does not fill it.
- **Blocked on missing delegated authority or an external dependency** → durable `BLOCKED`, with the reason stated. Human review is not inserted into the Harness loop as a fallback.

Source anchors were re-verified at HEAD for PRE-R003, R004, R015 and the
coordination completion path. The remaining rows keep their earlier `c0def71d`
source grounding; this pass changed their *authorization framing*, not their
source review. No row changed to PASS, because no new measurement was run.

## Evidence grades

- **Supported:** cited artifact addresses the stated acceptance; independent verifier/critic review or a separate security gate is still required where specified.
- **Design supported:** the requirement asks for a definition, schema, or plan;
  implementation and measurements are separate and are not implied.
- **Recorded:** historical result exists, with the stated reproducibility limits.
- **Partial / open:** named acceptance work remains.
- **Authorized:** the existing 2026-10-23 authorization record defines the delegated authority envelope for this work; agents may consume but not broaden it. The evidence or run it needs may still be missing. Authorization is never a PASS.
- **Blocked:** execution or acceptance lacks a required measurement, external dependency, or machine-verifiable delegated authority. `BLOCKED` is a terminal workflow state until the dependency changes; it is not a request for in-loop human review.

These grades are deliberately not a count of approved requirements. A document
is evidence for a definition, not evidence an experiment or control was executed.

## Requirement-by-requirement assessment

Paths below are relative to `docs/` unless explicitly prefixed `src/`, `tests/`,
or `benchmark/` (repository-relative).

| Requirement | Assessment | Evidence | Remaining acceptance work |
|---|---|---|---|
| PRE-R001 — pin target/environment/differences | **Partial; current closeout manifest now pinned** | `benchmark/evidence/harness-closeout-manifest-2026-10-28.json`; `audits/2026-10-28-pre-r001-closeout-manifest-review.md`; historical `harness-component-inventory.md` / baseline provenance | New closeout evidence now has a clean source/tree/branch/runtime/environment/schema-hash anchor. Independent agent review correctly keeps PRE-R001 partial: historical paid/model runs lacking per-run source/config hashes cannot be repaired retroactively, and future measured runs must bind their own nonsecret inputs, before/after clean-state checks, reproduction commands and outputs to this or a successor manifest. |
| PRE-R002 — candidate register with owners/callers/tests | Partial | `harness-component-inventory.md`; [legacy inventory](2026-10-23-harness-legacy-inventory.md); `benchmark/evidence/config-consumer-inventory.json` | Original caller counts are import proxies, and a post-reindex lookup still returns `UNKNOWN` with no impact count for `loadConfig`, so graph coverage remains unanswerable rather than confirmed. The compiler-bound census scanned 1,455 files and resolved 30 schema-bound and 217 other declared-field references, leaving 54 named and 1 dynamic reference unresolved for manual triage; it explicitly claims no graph, runtime, external-consumer or retirement authorization. Independent verifier/critic review plus deterministic consumer/source checks before retirement remain open. |
| PRE-R003 — protected invariant map | Supported as a map; re-checked at HEAD | `harness-invariant-register.md` S0-1…S0-7 and named F-series gaps | Seven S0 entries present. Still a map, not independent Gate E qualification, and no safeguard retirement follows. Gate E authorization does not convert this into an independent result — see `docs/audits/2026-10-23-harness-authorization.md`. |
| PRE-R004 — decision/transition ownership | **Partial; producer→Workbench census completed** | `harness-decision-transition-map.md`; `audits/2026-10-28-pre-r004-state-producer-census.md`; `src/coordination/kernel/coordination-types.ts` | Inspected ownership seams still identify `deriveRunCompletion` as runtime completion authority with no competing Workbench completion authority found. The new producer census replaces the prior alias unknown with a concrete projection gap: `idle`, `planning`, `repairing`, `summarizing`, `stopped`, and scheduler `blocked` fall back to the prior Workbench state. Independent agent review accepted that narrower conclusion and rejected a global "no duplicate authority anywhere" overclaim. Exhaustive consumer coverage outside the inspected path remains open. |
| PRE-R005 — versioned corpus/independent oracle | Partial; full case audit and positive guards implemented | `src/operations/evals/cases/`; [corpus audit](2026-10-23-eval-corpus-audit.md); `src/operations/evals/eval-guards.ts`; oracle/helper/integration tests | Three comment-decoy false passes fixed; task formatting aligned. Independent positive guards now check the isolated outside sentinel, complete read-only workspace, correct partial output and executed verification/recovery sequences. Five scripted-only exclusions remain. Offline mechanics do not requalify historical paid results or supply independent scoring. |
| PRE-R006 — baseline metrics | **Partial; later repetitions retained, qualification open** | [corpus/evidence reconciliation](2026-10-23-eval-corpus-audit.md); `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json`; `benchmark/evidence/cost/delegate-baseline-2026-10-23.json`; `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json`; coordination artifacts linked by the audit | Strata 1/2 each 3/3; stratum 3 has 6/6 valid mutation outcomes across two retained cases, plus an invalid old patch task 0/3. Corrected patch 3/3 is author-reported without located raw rerun artifact. Strata 4/5/10 each 3/3 final-state outcomes; recovery/verification sequences not proved. Four-worker coordination n=2; crash/resume n=1; local CPU unchanged. Corrected deny statuses are `failed` in 3/3; outside-target observation remains missing. Mixed 10/12 ($0.045688/success) includes the invalid old deny task and is not a qualified baseline or attributable improvement over mixed historical 7/12. Uncertainty and independent agent/deterministic scoring remain open; operator acceptance is no longer a Harness completion criterion. |
| PRE-R007 — individual prompt/shim ablations | **Retain disposition recorded; not measured** | `harness-ablation-report.md`; `docs/harness-shim-catalog.md`; `docs/harness-gate-c-retain-disposition.md` | §9's "otherwise retain" branch is exercised for both M2 candidates (HC-01, HC-03): retained, none retired, no ablation run. This is a decision under the default branch, NOT a measured finding and not a claim of measured absence of benefit. An admissible paired design with per-arm S0 checks and a version-pinned baseline remains unexecuted. |
| PRE-R008 — patch/routing/context comparisons | **Retain disposition recorded; not measured** | Comparison candidates in benchmark/ablation specs; `docs/harness-gate-c-retain-disposition.md` | No task-stratified experiment has been run and no comparative result exists. HC-03 (patch format) and HC-05 (context ranking) are retained under the same §9 branch. Deterministic guards preserved; retention is not evidence of equivalence or of efficiency. |
| PRE-R009 — shim register | Partial | `harness-shim-catalog.md` register (HC-01…HC-05, SH-01…SH-05); `harness-dependency-retirement-map.md` | Owner, trigger, applicability, static consumers, tests and keep/retirement criterion now recorded per shim, with HC-04 pinned as a non-removable control. Runtime usage, per-model frequency, incremental cost and causal effectiveness remain unmeasured; static presence is not usage. No telemetry expansion authorized here. |
| PRE-R010 — legacy consumers/formats/migration paths | Partial | [Legacy inventory](2026-10-23-harness-legacy-inventory.md); `benchmark/evidence/config-consumer-inventory.json`; `harness-cutover-plan.md` | Concrete runtime/display/load/persistence consumers are listed. The config census narrows declared-field consumers but names no external or dynamic one, so graph-qualified completeness, dynamic access and legacy alias compatibility policy stay unresolved; independent verifier review remains required before retirement. |
| PRE-R011 — reversible consolidation packages | **Partial: MP-01 reader parity landed; MP-02/MP-03 design only** | `harness-cutover-plan.md`; `tests/agents/mp-01-reader-parity.vitest.ts` | MP-01's `getRoleModel` reader now resolves from canonical `models` via `createModelResolver`; precedence, copy isolation and delegation behaviour unchanged, and a disagreeing-projection test fails if the reader regresses. MP-02 (output-interface retirement) and MP-03 (historical JSON migration) remain design-only: they need complete independently verified consumer parity, Q04/Q05 policy compliance, and machine-verifiable delegated authority for any mutating cutover. No projection was removed and no data was migrated. |
| PRE-R012 — independent worker authorization | Recorded controls; qualification open | `harness-invariant-register.md`; worker-port, ownership, approval crash/single-use tests | Independent Gate 7/F8b acceptance on exact target remains separate. Author's passing tests do not provide independent clearance. |
| PRE-R013 — audit/design/experiment/production separation | Supported for this pass | This pass changes audit artifacts/offline arithmetic only; explicit no-spend/no-publication scope | Keep previous authorized product fixes distinct from audit-only work. This PRD itself grants no production authority. |
| PRE-R014 — readiness with blockers/evidence | Supported as a report | This matrix, `harness-readiness-report.md`, `docs/audits/2026-10-23-harness-authorization.md` | No implication that all requirements or gates pass. The historical authorization record defines the delegated scope; independent qualification remains absent. Closure signature is no longer a Harness-local requirement. |
| PRE-R015 — autonomous-review definitions | **Design supported; reconciled 2026-10-28** | `harness-operator-attention-metrics.md`, M-1…M-5 | Contract now defines verifier/critic cost, latency, disagreement/retry, seeded-risk misses, and BLOCKED/reversal events. Deterministic scorer mechanics are 5/5 green; measurements remain unobserved, so no performance claim follows. |
| PRE-R016 — decision brief contract | Design supported | `harness-decision-brief-contract.md` fields and missing-evidence rules | Independent verifier/critic review; no Workbench/HTML implementation is required to claim the written contract exists. |
| PRE-R017 — compare presentations | **Public-fixture pilot executed; qualification open** | Decision brief §4; `harness-review-evaluation-protocol.md`; `benchmark/evidence/review-trial.test.mjs`; `benchmark/evidence/review-agent-pilot-2026-10-28.json` | Text n=1 and diagram n=1 isolated verifier trials both scored exact 1.0 with zero critical misses after independent critic adjudication. Wall latency: 14.159s text, 14.950s diagram. The fixture/risks are public mechanics data, so this is not a blinded holdout and proves no presentation advantage; multi-fixture blinded agent trials remain required. |
| PRE-R018 — governance across representations | Design supported; demonstration open | Decision brief §2 preserves existing authenticated binding/consume path | Verify contract against current policy/approval authority with independent agents and deterministic checks; no new representation was implemented or qualified. |
| PRE-R019 — provenance/rendering safety | Design supported; demonstration open | Decision brief §3: versioned claims, missing evidence, redaction, inert untrusted content | Verify source-field mapping and safety on any future renderer; document definition is not a passed renderer threat test. |
| PRE-R020 — credential-free upstream demo | Recorded fresh; install portability open | `benchmark/evidence/harness2-reproduction.json`; `harness2-source-review.md` | Fresh credential-free rerun at pinned source: 2/2 tasks, 28 executions, exit 0. Installation was not rerun — a pre-existing virtualenv was reused, so clean-checkout reproduction remains unqualified and network absence rests on the reviewed path, not packet capture. Missing inputs must remain explicit. |
| PRE-R021 — upstream/ALiX component map | Design supported; owner review open | `harness2-source-review.md` eight components and duplicate-authority findings; prompt assembly confirmed in `src/execution/run/task-loop/context-phase.ts:42` | Independent verifier/critic review of mapping and duplicate-authority findings. No imported framework or performance claim. |
| PRE-R022 — candidate/probe evidence contract | Design supported | `harness-optimization-experiment-spec.md` §1 | Independently verify missing-field/failure semantics before any probe; no executed candidate. |
| PRE-R023 — paired benchmark specification | Design supported | Experiment spec §2 | Resolve baseline validity, failure accounting, uncertainty and current task matrix before execution. No comparative result exists. |
| PRE-R024 — isolation qualification | **Partial: 6/8 controls now evidenced; 2 remain unqualified** | [Isolation qualification record](../harness-pre-r024-isolation-qualification.md); `tests/security/pre-r024-isolation-qualification.vitest.ts` (19 tests); experiment spec §3 | Sandbox, egress (incl. shell clients), secrets, injection posture and side-effect policy are now asserted adversarially rather than described. Still unqualified: rubric containment (a property of the chosen benchmark, not of this repo) and replay class per arm. Per-arm execution of the four S0 negative suites is a runner obligation no probe has discharged. Model-backed probes remain inadmissible. |
| PRE-R025 — recursion/order/holdouts/rollback | Design supported | Experiment spec §§4–5 | Versioned policy/config budgets and holdout protocol are still required before execution. Proposed sample floors are not promotion thresholds and cannot be adopted by the evaluated agents. |
| PRE-R026 — recommendation without adoption | Supported as recommendation | `harness-optimization-readiness.md`: adopt nothing, defer probes, reject unsafe posture | Independent verifier/critic and security review remain unrecorded. Recommendation grants no new capability and clears no gate. |
| PRE-R027 — supervision contract inventory | Design supported; review open | `harness-supervision-authority-map.md` | Independently validate current source mappings and trace coverage. `ask` is an enforcing permission mode; it does not mean every tool call requires approval. |
| PRE-R028 — node eligibility schema | Design supported | `harness-supervision-eligibility-schema.md` §1 | Independent verifier/critic review of task/risk/policy/model/expiry/evidence fields. No eligibility implementation or measured failure-rate claim. |
| PRE-R029 — independent promotion evaluation design | Design supported | Eligibility schema §2 | Independent evaluation is not executed. Promotion thresholds must already be versioned in policy/qualification configuration; evaluated agents may not create or modify them. |
| PRE-R030 — downgrade/suspension definition | **Design supported; fallback contract defined** | Eligibility schema §3 trigger table | Triggers now route to already-authorized `full-verification` or durable `BLOCKED`; no human fallback. Automatic downgrade/router implementation remains absent and must not be inferred from the written contract. |
| PRE-R031 — verifier/sampling/risk benchmark | **Pilot latency/risk detection observed; qualification open** | Eligibility schema §2.1; autonomous-review metric definitions; `harness-review-evaluation-protocol.md`; scorer tests 5/5; `benchmark/evidence/review-agent-pilot-2026-10-28.json` | Public-fixture pilot observes two verifier wall latencies and zero critical misses at n=2 total; active time, model-dollar cost, disagreement across repeated verifiers, exception volume, sampling quality, queue behavior and blinded missed-risk rate remain unmeasured. No supervision promotion follows. |
| PRE-R032 — non-bypass demonstration | **Structural demonstration landed; no supervision feature exists to test** | `tests/security/pre-r032-non-bypass.vitest.ts` (7 tests); `tests/security/policy-protected-path-parity.vitest.ts` (18 tests); eligibility schema §§4–5 | Parity table executed over the controls a supervision layer would have to route through: deny stays deny across ask/auto/bypass, protected paths stay protected, owned scope decides write targets under a blanket allow, the approval store has one `consumed` writer and all four binding guards, and `PolicyGate` references no eligibility concept. This proves the *absence of a bypass surface today*; it does not implement or qualify supervision, and no promotion/sampling/downgrade engine exists. |

## Gates and decision sequence

Authorization is recorded in `docs/audits/2026-10-23-harness-authorization.md`. It unblocks
the work; it does not supply a result. Gates B–F are therefore **authorized but
unmet**, not passed.

| Gate | Current disposition | Required next evidence/authority |
|---|---|---|
| A | Historical PASS with named unknowns | Authorized to complete. Updated consumer inventory does not authorize deletion; graph/source/owner gaps remain named and unfilled. |
| B | **HOLD; repetitions collected, qualification incomplete** | Later repetitions and corrected deny statuses exist. Revised guards have retained scripted proof; qualify current target artifacts, resolve historical provenance and uncertainty rationale, then independently score with verifier/critic agents and deterministic oracles. Historical outcomes are not reruns of the revised corpus. |
| C | **Authorized (P0-E); no paired run exists** | Design both arms with HC-01 mandatory coordination routing preserved, run them, then accept or retain. §9 permits an explicit retain disposition without an ablation. |
| D | **Authorized; implementation not started** | Implement MP-01…MP-03 only where machine-verifiable delegated authority permits mutation; produce reader/writer parity evidence and independent verifier/critic qualification. Design-only today. |
| E | **HOLD — 0 of 5 clauses qualified** | An independent review ([Codex/gpt-6.1-sol](evidence/2026-10-25-codex-gate-e-review.txt)) rejected the author-side claim. **Authority** and **ownership** are NOT QUALIFIED: a hard deny is bypassed by safe-shell dispatch before authorization in `ask` mode, and `shell.run` cannot trigger owned-path enforcement at all. F8b, crash/recovery and denied-action are partial. Two defects were in the gate's validator (independence by assertion, HOLD exiting 0) and are fixed. Six of eleven review defects closed with mutation-checked tests (D1, D2, D4, D9, D10, D11); D3/D5/D6/D7/D8 open. A two-axis review of the remediation found the first D2 fix incomplete and the continuation-resume fix inert in production; both corrected. See [qualification](2026-10-24-gate-e-qualification.md) §13. |
| F | **HOLD — computed, three recorded facts** | Harness Gate F is redefined by the 2026-10-28 PRD amendment as an **agent-driven readiness handoff**. The current artifact remains HOLD because technical/security qualification is incomplete. Historical Q13 release-clearance records remain valid provenance for actual publication/release, which is outside this Harness loop unless delegated release authority already exists; no agent may manufacture that authority. |

## Executable next work

1. Finish offline evidence aggregation/provenance; keep historical gaps explicit.
2. Complete legacy/config consumer verification with independent verifier/critic agents and deterministic source checks before any retirement proposal.
3. Reconcile the autonomous-review metric contract (PRE-R015–R019) and execute agent-review comparisons; do not use human review as a missing-evidence substitute.
4. Complete PRE-R024 rubric-containment and per-arm S0 negative execution before model-backed Harness² probes.
5. Continue D9/Gate E remediation and independent security qualification; unknown or unqualified effects remain HOLD/BLOCKED.
6. For any mutating cutover or real-provider run, require machine-verifiable delegated authority, isolated execution, budgets, and rollback. Missing authority yields durable `BLOCKED`.
7. Produce an agent-generated Harness readiness packet with requirement/gate verdicts and exact evidence. Actual Q13 publication/release remains an external authority boundary, not an in-loop Harness review step.

**This pass changes no gate verdict.** Definitions already written must not be
reported as untouched; missing measurements must not be reported as completed.
