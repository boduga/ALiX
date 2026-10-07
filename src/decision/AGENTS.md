# DOX — Decision Subsystem (Jev / System One)

**Purpose:** Bounded probabilistic decision primitive. ALiX owns workflow/governance; Jev answers atomic classification/scoring/bounded-choice only. Local-first; Jev opt-in remote.

**Ownership:**
- `contracts.ts` — Choice/Score/Noul native result types + provenance (incl. optional provider `usage`) + strict validators (no coerce, JEV-1).
- `registry.ts` — DecisionEngine contract + EngineRegistry; local baseline pre-registered (`createDefaultRegistry({ claimThreshold? })`); remote resolves only with explicit opt-in.
- `config.ts` — DecisionConfig + canonical AlixConfig decision-section wiring + local-first defaults + pure validator.
- `projector.ts` — Projector contract + projectForRemote (project -> gate -> seal).
- `boundary.ts` — Remote-boundary gates + seal/verify (secret/shape/size/depth, fail-closed).
- `journal.ts` — Journal schema + recordDecision + JSONL store + queries + separate debug retention.
- `executors.ts` — DecisionExecutor contract + outcome validation (JEV-1 failure model).
- `fallback.ts` — Execution plan + executeWithFallback (timeout/malformed/unavailable -> fallback or explicit failure).
- `engines/local.ts` — LocalBaselineExecutor (claim classifier + relevance scorer, unsupported elsewhere, no confidence); optional `{ claimThreshold }` binds the active local claim profile into the classifier.
- `engines/jev-protocol.ts` — System One wire types (Choice + Noul), verified against the official API reference + SDK types (source links in the header); injectable `JevTransport` (neutral: no decisions/engines imports).
- `engines/jev.ts` — Jev adapter: fetch transport with bounded 429/529 retry, per-decision mapping table, capability declaration, store-only key (`JEV_KEY_PROVIDER_ID`, re-exported by `cli/commands/jev/ops.ts`), disabled by default.
- `paths.ts` — decision-owned state paths (`resolveDecisionPaths`); tools import this instead of `src/cli/commands/*`.
- `decisions/claim-verification/` — first decision (schema/projection/baseline/thresholds/corpus/mapping/shadow/selection-service/experiment-store); see its AGENTS.md.
- `decisions/context-relevance/` — second decision (per-item Noul scoring, engine-specific thresholds, `selectContextItems` off/shadow/active seam); see its AGENTS.md.
- `decisions/model-tier/` — third decision (bounded Choice over enabled canonical tiers, resolved via `models.*`); see its AGENTS.md.
- `decisions/risk-escalation/` — J6 decision (bounded risk tiers + composed approval recommendation, advisory only); see its AGENTS.md (records the §14 admission review).
- `decisions/shared/` — `text.ts` (tokenizer), `attempts.ts` (attempt-list readers), `journaling.ts` (one attempt→journal-record shape) shared by decisions.
- `calibration/` — J4 evidence pipeline: outcome labels, label store, dataset join/export, reliability, accuracy sweep (scoreless engines), versioned threshold profiles. See its AGENTS.md.
- `tool-selection-*.ts` — offline tool-selection experiment surface (T2), never a runtime decision: `tool-selection-candidates.ts` (the frozen candidate descriptor, id helpers, local-only binding), `tool-selection-replay.ts` (frozen `scopeId` scopes, per-domain builtin/MCP replay, exact set preservation), `tool-selection-evaluation.ts` (observed/replayed/unknown outcomes), `tool-selection-snapshot.ts` (isolated snapshot runner), `tool-selection-fixtures.ts` (recorded-response replay for external tools), `tool-selection-experiment.ts` (projection + per-candidate scorer, pinned `tool-selection/v1` projector), `tool-selection-jev-mapping.ts` (the experiment's System One wire mapping + `createJevToolSelectionScorer`; offline only, imported by nothing in the live loop).
- `tool-selection-corpus.ts` — T3 measurement contract, the executable form of `docs/jev/T3-selection-evaluation-preregistration.md`: two independent eligibility tracks over a closed exclusion vocabulary (`deriveEvaluationEligibility`), the blind A/B labelling card (`buildBlindLabellingCard`, deterministic rotation from the scope key), the disagreement and gap-closure label records with strict parsers, and a facts-only corpus summary. It scores no selector and ranks none.
- `selection-outcome.ts` — the CLOSED VOCABULARY shared by the run layer's tool-selection trace and the offline experiment: `ExecutionOutcome`, `SelectionOutcome`, `EvidenceContribution`. Decision-owned so the dependency direction stays `run/task-loop → decision` and the experiment never reaches back into the loop. These are the single definitions — `src/observability/tool-selection-observation.ts` re-exports them rather than redeclaring them, so the two cannot drift.
- Risk context (`RiskContext`) is captured at decision time on the journal record, never on a post-hoc label.
- `approval.ts` — Approval floor composition (policy OR risk-escalation, never waive).
- `index.ts` — barrel.

**Local Contracts:**
- Decision boundary vs tool selection: `context-relevance` answers whether a
  context item should be *included* for reasoning; choosing which already-
  applicable tool or resource to act on next belongs to tool selection, not to
  `context-relevance`. Keep that split so the context decision does not become a
  catch-all for selection questions.
- Choice/Score/Noul never flattened to {value, confidence}. Noul = probability.
- Unknown choice rejected, never coerced to executable action.
- Remote engine resolution fails closed without `allowRemote`.
- Threshold profiles engine-specific; Jev calibration never transfers to local/LLM.
- Jev selects canonical tiers only, never provider/model IDs (enforced J3).
- Boundary caps/timeouts are uncalibrated operational defaults pending J4 evidence.
- Engines declare `supportsDecision`; `buildPlan` fails closed when an engine cannot answer the decision.
- The Jev adapter re-verifies the sealed projection before transport (arch §6); a forged/unsealed payload is rejected, never sent.
- The System One wire shape is verified against the official API reference and SDK types (links in `engines/jev-protocol.ts`); remote is opt-in via `remote.jev.enabled`.
- Shadow runs journal every attempt (including a failed remote attempt) under one `projectionHash`.
- Decision routes carry `enabled`; absent/false means the consumer keeps existing behavior.
- Tool selection stays an experiment, not a `DecisionType`: no route entry, no
  policy authority, no runtime influence until T2 evidence justifies promotion.
  An offline experiment uses the sealed `experiment:<id>` subject
  (`RemoteDecisionSubject`) so it can call an engine without becoming a
  supported decision surface.
- T3 freezes measurement before collection: eligibility is two independent
  tracks (`selection`, `outcome`) over a closed exclusion vocabulary with no
  generic `bad-run`; appropriateness is labelled blind, per candidate, with the
  A/B rotation derived from the scope key; `gapClosure` is an offline label that
  is never read off the live loop. The checkpoint is 30 eligible scopes AND 10
  labelled disagreements. The summary reports facts and prerequisites — it never
  ranks selectors or declares a winner; that judgement is the operator's, at T3-f.
  Amending a code, label, or the checkpoint belongs in the pre-registration's
  amendment table and invalidates comparability with earlier rows.
- Comparison eligibility is not the same as an observed choice: agreement
  requires a complete alternative ordering (`candidateSetPreserved: true`), so a
  scope whose scorer failed mid-set keeps its model choice as trace fact and is
  excluded from comparison. A row holds one chosen `reason` plus `diagnostics`
  (every other code that fired) — a run may have two defects and both stay
  visible. The replay reports `attemptedCandidates`/`failedCandidates`, so scorer
  completion is experiment data (full-scope success rate, candidate failure rate,
  per-scope latency percentiles), not a silent exclusion. Corpus cohorts are
  comparable only under the run controls listed in the pre-registration: a change
  to revision, projector, Jev model/config, or candidate-freeze schema starts a
  new cohort rather than mixing rows.
- An engine never borrows a runtime mapping for an `experiment:` subject: the
  Jev adapter takes experiment mappings only through `experimentMappings`
  (`experiment:<id>` → mapping, keyed by experiment id) and still fails closed
  for an experiment with nothing registered. `TOOL_SELECTION_JEV_MAPPING` is the
  tool-selection experiment's mapping; `createJevToolSelectionScorer` composes
  adapter + mapping + scorer in one call and touches no route table.
- A tool-selection selector scores ONE candidate at a time. ALiX owns candidate
  enumeration, identity, complete-set validation, sorting and tie-breaking;
  `set(ranking) == set(offered)` or the replay attempt is invalid.
- Candidate identity is the frozen `candidateId` (`builtin:<name>`,
  `mcp:<short hash>`), not an executor identifier. The local-only binding
  (candidateId -> model/executor name) resolves executable machinery for replay;
  raw `mcp__<handle>` strings never enter a projection, and a scope that still
  offers one fails closed at projection time.
- The selection engine's answer is a Noul probability used as a ranking value:
  provenance records `outcomeKind: "noul"`, `probability` and `rankValue`, and
  the ordinal `Score` primitive stays unmodelled until evidence says ranking
  needs it. The question is per-candidate ("would executing this tool now be an
  appropriate next step?"), never "best" — a candidate never sees the others.
- The recorded scoper ordering is a RELEVANCE ordering (`scoperRanking` /
  `scoperTop`, native token-overlap scores). Never present it as the
  deterministic selection baseline: T3 must compare against the component that
  actually influences next-tool choice, or it compares two different questions.
- T3 comparison policy (decided): the BASELINE is what the model actually
  selected — the component that really influences next-tool choice today. The
  scoper ordering and the per-domain MCP selector ordering are context only, and
  builtin/MCP values are never compared on one scale. Any alternative ordering
  comes from the opt-in offline scorer, one candidate at a time.
- A failed candidate invalidates the WHOLE replay attempt: no domain keeps a
  usable ordering (`selectorRanking: []`, every domain
  `candidateSetPreserved: false`), so a partial ordering is never read as a
  complete one. Per-domain populations stay separate otherwise: builtin and MCP
  values are never merged into one ordering.
- Tool-selection projections carry selection-time information only
  (`assertNoPostSelectionFields`): `actualChoice`, execution outcome, evidence
  contribution and the deterministic ranking must never reach a scorer.
- Replay never touches the live network: external tools replay only from
  recorded-response fixtures under exact `(tool, argsSignature)` matching, and a
  miss is `unknown` — never a live call, never an upgraded evidence claim.
- Threshold profiles are versioned and engine-specific; a fallback engine uses its own profile or fails closed (JEV-9).
- New runtime wiring requires tested projection/redaction/journal/fallback boundaries. The claim-verification tool is wired; other activation seams remain separately gated. Decision work must not alter `PolicyGate`, `createProvider`, or the loader.

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
- `tests/decision/model-tier.test.ts` — J3 decision (candidate tiers, feature-only projection, canonical resolution, JEV-10, shadow, selection).
- `tests/decision/risk-escalation.test.ts` — J6 decision (schema, projection, baseline, mapping, shadow recommendation, selection).
- `tests/decision/calibration.test.ts` — J4 labels/store/dataset/reliability.
- `tests/decision/threshold-profiles.test.ts` — J4b versioned profiles, provenance-gated promotion/rollback, scope resolution.
- `tests/decision/replay.test.ts` — J5 fixtures, dry-run, comparison, cost, promotion gate.
- `tests/decision/jev-protocol.test.ts` — the verified System One request/response shape (map questions/answers, `noul` field, legacy shape rejected).
- `tests/config/decision-section.test.ts` — canonical `decision` section wiring.
- `tests/run/tool-selection-*.vitest.ts` — T2 tool-selection experiment surface:
  frozen-candidate sanitization + local-only bindings, scope/ranking recording,
  replay set preservation over candidate ids, snapshot runner, recorded-response
  fixtures, the experiment scorer's anti-leakage projection + Noul-only contract,
  and the offline-only import isolation pin (nothing outside `src/decision/`
  imports the scorer, its mapping, or the replay engine).
- `tests/run/tool-selection-corpus.vitest.ts` — T3 measurement contract: the
  closed exclusion vocabulary (no generic `bad-run`), per-track eligibility
  derivation + override semantics, the blind card carrying no provenance field
  and rotating A/B from the scope key, strict label-record parsing and
  slot→actual/alternative mapping (a mismatched card is ignored), and a summary
  that reports facts and prerequisites without ranking a selector.

**Child DOX Index:**

| Path | Scope |
|------|-------|
| `src/decision/decisions/claim-verification/AGENTS.md` | First decision — verdict schema, projection, local baseline, threshold resolution, corpus, Jev mapping, shadow runner, selection-service, experiment-store |
| `src/decision/decisions/context-relevance/AGENTS.md` | Second decision — per-item Noul scoring, engine-specific thresholds, deterministic selection, shadow runner |
| `src/decision/decisions/model-tier/AGENTS.md` | Third decision — canonical tier candidates, feature-only projection, `models.*` resolution, shadow runner |
| `src/decision/decisions/risk-escalation/AGENTS.md` | J6 decision — bounded risk tiers, composed approval recommendation, §14 admission review |
| `src/decision/calibration/AGENTS.md` | J4 evidence pipeline — outcome labels, dataset join, reliability, accuracy sweep, versioned threshold profiles + promotion/rollback |
| `src/decision/replay/AGENTS.md` | J5 dry-run harness — stored fixtures, comparison, promotion gate |
