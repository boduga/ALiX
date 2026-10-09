# DOX — Replay + Regression (J5)

**Purpose:** Evaluate an engine/model/threshold change on stored fixtures BEFORE production activation. Dry-run only: replay admits fixtures and executors, so it cannot execute tools or mutate governance state by construction.

**Ownership:**
- `fixtures.ts` — `ReplayFixture` (sealed projection + id/decision/candidates/expected), `exportReplayFixture` (re-verifies the seal), `saveReplayFixture`/`loadReplayFixture`/`listReplayFixtures` (atomic, 0o600, validated).
- `harness.ts` — `replayFixture` (one fixture × one executor, time-bounded, failures become explicit outcomes; carries provider-reported `usage` when present) + `replaySuite` (keyed by engine id).
- `cost.ts` — cost model: local = 0; Jev = $0.042/MTok input, output free. **Reported usage wins**: `costFromUsage`/`costForRun` use provider-reported tokens when the engine reports them and fall back to the chars/4 estimate only when it does not. Unknown engines throw rather than price 0.
- `compare.ts` — `compareEngineRuns`: agreement, accuracy (caller-supplied `isCorrect`), mean/p95 latency, cost — matched by fixture id, comparing answers not confidences.
- `gates.ts` — `evaluatePromotionGate`: fail-closed on empty corpus, agreement below floor, accuracy regression beyond allowance, or any malformed candidate outcome. Latency and cost are reported, never gated.
- `index.ts` — barrel.

**Local Contracts:**
- Only a verified seal becomes a fixture; forged payloads and corrupt files are rejected (`FixtureValidationError`).
- The harness signature admits no journal, approval store, or tool surface — a dry run has no channel by which it could mutate runtime state.
- Agreement compares the ANSWER (choice/score/probability), never confidence, provenance, or latency — two versions may legitimately recalibrate the same answer. **Choice compares exactly; Noul/Score compare within `continuousTolerance` (default 0.1)** — a float probability is never bit-identical, so exact equality would report 0% agreement for every probabilistic decision. `meanAbsoluteDelta` carries the real signal.
- Fixtures present on only one side are excluded from `paired` but each side still reports its own run count.
- Cost is exact when the engine reports usage and an estimate otherwise; vendor pricing is a named constant so a pricing change is a one-line reviewable diff. The comparison reports `reportedInputTokens`/`reportedOutputTokens` so a cost figure is auditable.
- Failure outcomes are first-class comparison data (agreement counts shared failures); transport failure/timeout surfaces as a failure outcome, never a throw.

**Work Guidance:**
- To evaluate a change: export the fixtures once, replay baseline + candidate, run the gate. Promote only on pass (with the J4 governance approval).
- Keep fixtures redacted-by-construction: they are sealed projections, never raw state.
- Record a versioned threshold change by re-running the gate over the same fixture set.

**Verification:**
- `tests/decision/replay.test.ts` — fixture validation/round-trip/corrupt, dry-run outcomes/timeout/suite, no-mutation proof, agreement/accuracy/latency/cost, cost model, gate pass/fail paths.

**Child DOX Index:** none.
