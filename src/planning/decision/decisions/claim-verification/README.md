# Claim Verification Decision

## Overview
First production-shaped decision (J1): judges whether evidence supports, contradicts, or cannot judge a claim. The verdict space is enumerated in code, the projection is minimal and bounded, the default engine is a deterministic local baseline, and shadow observations grant no execution authority.

## Interface
- `CLAIM_VERDICTS`, `ClaimVerdict`, `CLAIM_VERDICT_CANDIDATES`, and `isClaimVerdict()` define the legal verdict space [schema.ts:CLAIM_VERDICTS] [schema.ts:isClaimVerdict]
- `ClaimVerificationInput`, `ClaimEvidenceExcerpt`, `ClaimVerificationProjection`, `MAX_CLAIM_CHARS`, `MAX_EVIDENCE_ITEMS`, and `MAX_EXCERPT_CHARS` define the bounded projection shape [projection.ts:MAX_CLAIM_CHARS]
- `createClaimVerificationProjector()`, `projectClaimVerification()`, and `readClaimProjection()` create, seal, and leniently read the projection [projection.ts:createClaimVerificationProjector] [projection.ts:projectClaimVerification] [projection.ts:readClaimProjection]
- `classifyClaimLocally()`, `LocalClaimVerdict`, `LocalClassifyOptions`, and `SUPPORT_OVERLAP_THRESHOLD` provide the deterministic no-network baseline [local-baseline.ts:classifyClaimLocally] [local-baseline.ts:SUPPORT_OVERLAP_THRESHOLD]
- `resolveLocalClaimThreshold()` resolves the support-overlap threshold from config and profile registry [thresholds.ts:resolveLocalClaimThreshold]
- `ClaimVerificationFixture` and `CLAIM_VERIFICATION_CORPUS` provide labeled fixtures, including adversarial instruction-bearing evidence [corpus.ts:CLAIM_VERIFICATION_CORPUS]
- `sweepLocalClaimThreshold()` re-runs the classifier across a threshold grid against the corpus [accuracy-sweep.ts:sweepLocalClaimThreshold]
- `JEV_CLAIM_QUESTION_ID`, `renderClaimState()`, `toJevRequest()`, `fromJevResponse()`, and `CLAIM_VERDICT_OPTIONS` map the decision to the System One wire shape [jev-mapping.ts:toJevRequest] [jev-mapping.ts:fromJevResponse]
- `runClaimVerificationShadow()`, `ClaimVerificationShadowResult`, `ShadowObservation`, and `ClaimVerificationShadowDeps` run and journal configured and baseline observations [shadow.ts:runClaimVerificationShadow]
- `selectClaimVerification()`, `ClaimSelectionMode`, and `ClaimSelection` expose `baseline | shadow | active` selection [selection-service.ts:selectClaimVerification]
- `createExperimentProjectionStore()`, `experimentStorePath()`, `EXPERIMENTS_FILE`, and `ClaimVerificationExperimentProjection` retain sealed projections for operator labeling [experiment-store.ts:createExperimentProjectionStore] [experiment-store.ts:experimentStorePath]
- `index.ts` re-exports the entire public surface as a barrel [index.ts]

## Invariants
- Only `supported`, `contradicted`, and `insufficient` are legal; an unknown value is rejected rather than coerced [schema.ts:isClaimVerdict]
- A missing or empty claim throws during projection, so no engine runs, no remote call occurs, and no journal write happens [projection.ts:createClaimVerificationProjector]
- The projection is clipped to 2,000 claim characters, 8 evidence items, and 1,200 characters per excerpt [projection.ts:MAX_CLAIM_CHARS] [projection.ts:MAX_EVIDENCE_ITEMS] [projection.ts:MAX_EXCERPT_CHARS]
- Empty evidence excerpts are filtered out of the projection [projection.ts:createClaimVerificationProjector]
- `readClaimProjection` degrades a missing claim to `""` for local engines; remote mapping rejects instead [projection.ts:readClaimProjection] [jev-mapping.ts:requireClaimProjection]
- The local baseline emits only a verdict and reason, never a confidence [local-baseline.ts:LocalClaimVerdict]
- The local baseline returns `insufficient` when the claim has no content words, there is no evidence, or claim-term overlap is below the threshold [local-baseline.ts:classifyClaimLocally]
- Negation markers or a numeric mismatch produce `contradicted` only after the overlap threshold is met [local-baseline.ts:classifyClaimLocally]
- Instruction text inside evidence is data: classification is deterministic rules only and the adversarial fixtures expect rule-derived verdicts [local-baseline.ts:classifyClaimLocally] [corpus.ts:CLAIM_VERIFICATION_CORPUS]
- Threshold resolution is configured-active-local profile, then the scope's active local profile, then `SUPPORT_OVERLAP_THRESHOLD`; a foreign or Jev profile is never applied to local [thresholds.ts:resolveLocalClaimThreshold]
- A missing profile registry degrades to an empty registry and the default threshold [thresholds.ts:resolveLocalClaimThreshold]
- Corpus `expected` labels are the ground truth; the sweep measures accuracy by re-classifying at each grid point [corpus.ts:ClaimVerificationFixture] [accuracy-sweep.ts:sweepLocalClaimThreshold]
- The Jev request sends one choice question keyed by `claim-verdict`, with rubric descriptions per verdict [jev-mapping.ts:toJevRequest]
- An unknown verdict, a missing choice answer, or confidence outside `0..1` raises `MalformedResultError` [jev-mapping.ts:fromJevResponse]
- Shadow results always carry `authority: "none"` [shadow.ts:ClaimVerificationShadowResult]
- Baseline and observed outcomes are journaled under the one sealed `projectionHash`, including failed remote attempts [shadow.ts:runClaimVerificationShadow]
- The local baseline comparison is skipped when the observed engine is already local or `compareBaseline` is false [shadow.ts:runClaimVerificationShadow]
- `shadow` selection returns the baseline verdict, never the observed verdict; if the baseline was skipped it classifies locally directly [selection-service.ts:selectClaimVerification]
- `baseline` selection performs no engine plan, journal write, or network call [selection-service.ts:selectClaimVerification]
- The experiment store path is `~/.alix/decisions/experiments.jsonl` unless a `storeDir` is supplied [experiment-store.ts:experimentStorePath]
- Stored experiment records require a hash, the `claim-verification` decision, a claim, evidence entries with string excerpts, and a creation timestamp [experiment-store.ts:isExperimentProjection]

## Side Effects
- `runClaimVerificationShadow` executes the configured engine through the fallback plan and may execute the local executor for the baseline [shadow.ts:runConfigured] [shadow.ts:runLocalBaseline]
- Shadow and active modes append `DecisionJournalRecord`s to the supplied journal store [shadow.ts:runClaimVerificationShadow]
- The local baseline measures latency with `Date.now()` around the executor call [shadow.ts:runLocalBaseline]
- `createExperimentProjectionStore` reads and appends JSONL records on disk [experiment-store.ts:createExperimentProjectionStore]
- `projectClaimVerification` computes a sealed projection and hash; it performs no I/O beyond that [projection.ts:projectClaimVerification]
- `classifyClaimLocally` performs no I/O, model call, or network access [local-baseline.ts:classifyClaimLocally]

## Verification
- Run: `pnpm test`
