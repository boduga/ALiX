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
- `engines/local.ts` — LocalBaselineExecutor (claim classifier + relevance scorer, unsupported elsewhere, no confidence).
- `engines/jev-protocol.ts` — Jev System One wire types (Choice + Noul) + injectable `JevTransport` (neutral: no decisions/engines imports).
- `engines/jev.ts` — Jev adapter: transport, per-decision mapping table, capability declaration, store-only key, disabled by default.
- `decisions/claim-verification/` — first decision (schema/projection/baseline/corpus/mapping/shadow); see its AGENTS.md.
- `decisions/context-relevance/` — second decision (per-item Noul scoring, engine-specific thresholds, `selectContextItems` off/shadow/active seam); see its AGENTS.md.
- `decisions/shared/` — `text.ts` (tokenizer), `attempts.ts` (attempt-list readers), `journaling.ts` (one attempt→journal-record shape) shared by decisions.
- `approval.ts` — Approval floor composition (policy OR risk-escalation, never waive).
- `index.ts` — barrel.

**Local Contracts:**
- Choice/Score/Noul never flattened to {value, confidence}. Noul = probability.
- Unknown choice rejected, never coerced to executable action.
- Remote engine resolution fails closed without `allowRemote`.
- Threshold profiles engine-specific; Jev calibration never transfers to local/LLM.
- Jev selects canonical tiers only, never provider/model IDs (enforced J3).
- Boundary caps/timeouts are uncalibrated operational defaults pending J4 evidence.
- Engines declare `supportsDecision`; `buildPlan` fails closed when an engine cannot answer the decision.
- The Jev adapter re-verifies the sealed projection before transport (arch §6); a forged/unsealed payload is rejected, never sent.
- Enabling remote requires `acknowledgeUnverifiedWireFormat` until the wire shape is verified against the official SDK.
- Shadow runs journal every attempt (including a failed remote attempt) under one `projectionHash`.
- Decision routes carry `enabled`; absent/false means the consumer keeps existing behavior.
- Threshold profiles are versioned and engine-specific; a fallback engine uses its own profile or fails closed (JEV-9).
- No runtime wiring until projection/redaction/journal/fallback are tested; `PolicyGate`/`createProvider`/loader stay untouched by decision work.

**Work Guidance:**
- New decision = projector (decision folder owns its schema) + route policy + executor mapping + journaled attempts. Reuse `projectForRemote`, `buildPlan`/`executeWithFallback`, `recordDecision`, `runClaimVerificationShadow` as the shadow template.
- Keep the wire protocol in `engines/jev-protocol.ts`; per-decision mapping stays in the decision folder (avoids an engines↔decisions cycle).
- Prefer factories and pure functions (CONTRIBUTING); classes only for `Error` subclasses.
- Share range/shape gates via `outcomeIssue`; keep error types per module.
- Thresholds stay per decision/engine/risk; never copy a Jev profile onto local/LLM.
- J1-J3 wiring reads `AlixConfig.decision` (canonical); `DEFAULT_DECISION_CONFIG` is the fallback, not a second truth.

**Verification:**
- `tests/decision/decision-foundation.test.ts` — contracts, registry, config, JEV-1/7/9/10 slices.
- `tests/decision/decision-boundary.test.ts` — gates, seal/verify, JEV-2..6.
- `tests/decision/decision-journal.test.ts` — provenance, store, failure policy, debug separation.
- `tests/decision/decision-fallback.test.ts` — local baseline, Jev seam, fallback policy, plan errors.
- `tests/decision/decision-approval.test.ts` — JEV-8 floor truth table.
- `tests/decision/claim-verification.test.ts` — J1 decision (schema, projection, baseline, mapping, shadow).
- `tests/decision/context-relevance.test.ts` — J2 decision (per-item projection, Noul mapping, JEV-9 thresholds, selection, shadow).
- `tests/config/decision-section.test.ts` — canonical `decision` section wiring.

**Child DOX Index:**

| Path | Scope |
|------|-------|
| `src/decision/decisions/claim-verification/AGENTS.md` | First decision — verdict schema, projection, local baseline, corpus, Jev mapping, shadow runner |
| `src/decision/decisions/context-relevance/AGENTS.md` | Second decision — per-item Noul scoring, engine-specific thresholds, deterministic selection, shadow runner |
