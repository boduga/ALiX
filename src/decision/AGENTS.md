# DOX — Decision Subsystem (Jev / System One)

**Purpose:** Bounded probabilistic decision primitive. ALiX owns workflow/governance; Jev answers atomic classification/scoring/bounded-choice only. Local-first; Jev opt-in remote.

**Ownership:**
- `contracts.ts` — Choice/Score/Noul native result types + provenance + strict validators (no coerce, JEV-1).
- `registry.ts` — DecisionEngine contract + EngineRegistry; local baseline pre-registered; remote resolves only with explicit opt-in.
- `config.ts` — DecisionConfig skeleton (standalone in J0a; canonical AlixConfig wiring later) + local-first defaults + pure validator.
- `projector.ts` — Projector contract + projectForRemote (project -> gate -> seal).
- `boundary.ts` — Remote-boundary gates + seal/verify (secret/shape/size/depth, fail-closed).
- `journal.ts` — Journal schema + recordDecision + JSONL store + queries + separate debug retention.
- `executors.ts` — DecisionExecutor contract + outcome validation (JEV-1 failure model).
- `fallback.ts` — Execution plan + executeWithFallback (timeout/malformed/unavailable -> fallback or explicit failure).
- `engines/local.ts` — LocalBaselineExecutor (insufficient/abstain/unsupported, no confidence).
- `engines/jev.ts` — Jev adapter seam (explicit opt-in, store-only key, SDK maps in J1).
- `index.ts` — barrel.

**Local Contracts:**
- Choice/Score/Noul never flattened to {value, confidence}. Noul = probability.
- Unknown choice rejected, never coerced to executable action.
- Remote engine resolution fails closed without `allowRemote`.
- Threshold profiles engine-specific; Jev calibration never transfers to local/LLM.
- Jev selects canonical tiers only, never provider/model IDs (enforced J3).
- No runtime wiring until J0 projection/redaction/journal/fallback tested.
- New files only in J0a; `PolicyGate`/`createProvider`/loader untouched.

**Verification:**
- `tests/decision/decision-foundation.test.ts` — contracts, registry, config, JEV-1/7/9/10 slices.
- `tests/decision/decision-boundary.test.ts` — gates, seal/verify, JEV-2..6.
- `tests/decision/decision-journal.test.ts` — provenance, store, failure policy, debug separation.
- `tests/decision/decision-fallback.test.ts` — local baseline, Jev seam, fallback policy, plan errors.

**Child DOX Index:** none.
