# DOX — Benchmark harness history vs summary vs state vs hybrid

**Purpose:** Deterministic maintenance/reconciliation task harness proving the architecture (bounded state + hybrid retrieval vs history/summary baselines). C vs D primary bake-off, A/B baselines.

**Ownership:**
- `types.ts` — Substrate (A_full_history/B_summary_fixed/C_state/D_hybrid), DecisionCategory (state-complete/evidence-dependent/history-dependent), BenchmarkScenario/Event/DecisionPoint, BenchmarkResultRow (machine-readable {scenario, seed, horizon, substrate, taskSuccess, decisionAccuracy, prompt/state/evidence/historyTokens, escalations, retrieval_precision, state_sufficiency}), BenchmarkReport/Summary, GovernanceConfig, REQUIRED_HORIZONS 10/50/100/500.
- `scenario.ts` — createScenario(seed, horizon) deterministic mulberry32 maintenance/reconciliation generator: execution.created + state-affecting + distractors + evidence.observation + history.artifact_detail, decision points cycling 3 categories every 10 steps, controlled failures/distractors, sorted seq invariant.
- `fake-environment.ts` — FakeExecutionEnvironment deterministic tools: getFullHistory, getLatestObservation, getEvidenceById/Slice, getSummaryFixed (fixed-budget lossy), getProjectedStateView (bounded state view, no evidence/history leak), toolReconcileCheck.
- `fake-model.ts` — FakeModel deterministic (tests substrate not model): correct iff required info present per category — state-complete needs state/summary/history, evidence-dependent needs evidence/history, history-dependent needs slice/history; summary lossy on evidence/history.
- `substrates.ts` — assembleContext(substrate, env, point, {includeEvidence, includeHistory}) token accounting (state/evidence/history/promptTokens via estimateTokens ~char/4): A history+obs O(T), B summary bounded lossy, C state+obs bounded, D hybrid state+targeted slice bounded.
- `tokens.ts` — estimateTokens deterministically (JSON length /4).
- `metrics.ts` — MetricsCollector 4-group metrics: correctness (taskSuccess, decisionAccuracy), context efficiency (prompt/state/evidence/historyTokens, cumulativeTokens), adaptive (escalations, unnecessary_escalations, retrieval_precision, historical_retrieval_rate, state_sufficiency), horizon (tokensPerStep, boundedness invariants).
- `harness.ts` — runSingle (same scenario/seed/governance for one substrate) + runHorizons (all horizons×substrates) + BenchmarkSummary invariants (cStateTokensBounded, cStateCompleteInvariant, dRecovers, dBounded, dPrecisionOk); D escalates deterministically only when required (evidence/history-dependent).
- `mutation-conflict.ts` — Mutation-conflict benchmark (issue #638): deterministic N concurrent mutating calls sharing baseStateVersion V (v17 → inv-42 call-A/B same V overlapping), scheduler eligible but CAS decides; StateTransitionProposal → ExecutionStateStore CAS → EventLog → projector proof (one success + N-1 STATE_VERSION_CONFLICT, no partial mutation, rebuilt state == committed, scheduler did not decide winner); supports N=2 and N>2.

**Local Contracts:**
- Same scenario/seed/environment/governance/budget for A/B/C/D — comparable rows (acceptance 1).
- C horizon-invariant on state-complete (accuracy 1.0, tokens bounded 10→500), D recovers evidence/history-dependent where C fails (acceptance 2).
- D context bounded, retrieves only when required — retrieval_precision, unnecessary_escalations measured (acceptance 3).
- FakeModel isolates substrate — correctness reflects state adequacy, not intelligence (acceptance 4).
- Deterministic, fail-closed, no LLM, no I/O, no mutation of authoritative history (EventLog immutable, state disposable).
- Do NOT touch contract/store/projector/prompt/governor — only harness.

**Verification:**
- `pnpm build && pnpm typecheck` — types compile (benchmark/ included via vitest transform).
- `vitest run tests/benchmark-state-harness.vitest.ts` — invariants: same seed deterministic, C bounded 10→500, D recovers, D precision, A succeeds, B lossy, machine-readable fields present.
- `vitest run tests/benchmark-mutation-conflict.vitest.ts` — mutation-conflict: N=2 and N>2 deterministic, overlapping proof, exactly one success + N-1 STATE_VERSION_CONFLICT, no partial mutation, rebuilt state == committed, scheduler did not decide winner; C vs D horizon invariants still pass with scenario added.
