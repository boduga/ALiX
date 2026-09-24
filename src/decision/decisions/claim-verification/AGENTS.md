# DOX — Claim Verification Decision (J1)

**Purpose:** First production-shaped decision: does the evidence support, contradict, or fail to judge a claim? Enumerated verdicts only; grants no execution authority.

**Ownership:**
- `schema.ts` — `CLAIM_VERDICTS` (`supported|contradicted|insufficient`) + `isClaimVerdict`.
- `projection.ts` — `ClaimVerificationProjection` (claim + bounded evidence excerpts), projector, `readClaimProjection` (lenient read for local engines).
- `local-baseline.ts` — deterministic rule baseline (`classifyClaimLocally`): term overlap + whole-word negation + numeric mismatch; conservative `insufficient`; optional `supportOverlapThreshold` override (default `SUPPORT_OVERLAP_THRESHOLD` = 0.5).
- `thresholds.ts` — `resolveLocalClaimThreshold(config, profiles)`: configured route profile when it is the ACTIVE local claim profile → the scope's active local claim profile → default 0.5; a foreign engine's profile is never applied (JEV-9). Pure — the caller loads the registry; an unreadable/invalid registry degrades to an empty one (the default), never a foreign number.
- `corpus.ts` — labeled fixture corpus (supported/contradicted/insufficient + adversarial).
- `jev-mapping.ts` — `toJevRequest` / `fromJevResponse`; unknown verdict → `MalformedResultError`.
- `shadow.ts` — `runClaimVerificationShadow`: project → run configured route → run local baseline → journal each under one `projectionHash`. Result carries the sealed `projection` (claim + evidence) alongside `projectionHash`; accepts an optional `project` seam that overrides the default `projectClaimVerification` seal (test/boundary injection).
- `selection-service.ts` — `selectClaimVerification` with `baseline` (local verdict, no plan/journal/network, default) / `shadow` (returns the BASELINE verdict — deliberate divergence, spec §10) / `active` (configured engine's verdict). Accepts an optional `claimThreshold` bound into its direct `classifyClaimLocally` calls.
- `experiment-store.ts` — `createExperimentProjectionStore`: protected projection store at `~/.alix/decisions/experiments.jsonl` (`storeDir ?? join(homedir(), ".alix")` + shared `JsonlStore`). The journal keeps only `projectionHash`; this store keeps the sealed projection an operator judges from (§16).
- `index.ts` — barrel.

**Local Contracts:**
- Verdict space is code-defined; unknown values rejected, never coerced (JEV-1).
- Projection failure throws before any engine runs — no remote call, no journal write.
- Evidence excerpts only; raw tool output/source files never enter the projection (JEV-4/JEV-5).
- Adversarial instruction text inside evidence is data, never authority.
- Local baseline emits no confidence (uncalibrated, JEV-9).
- The local support-overlap threshold resolves configured-active-local → own active profile → 0.5 default; Jev (or any foreign) calibration is never applied (JEV-9). The consumer resolves it once per call (`resolveLocalClaimThreshold`) and passes it into the local executor/classifier; an invalid profile registry degrades to the default for local availability, never fail-closed into a foreign threshold.
- Shadow results carry `authority: "none"`; the consumer decides what verification action follows.
- Baseline and observed outcomes journal separately under the same `projectionHash` — that is the J4 calibration/comparison input.
- Every attempt is journaled: a failed remote attempt that fell back appears as an explicit `failure` record with its latency.
- `jev-mapping.ts` sends one Choice question keyed by id with `instructions` + `criteria` (option -> rubric description), matching the verified System One shape. The adapter re-verifies the sealed projection before transport (§6).
- Mode default is `baseline`, renamed from the original `off` (§3.1): the tool stays useful locally before any experiment starts.
- The model-facing payload is exactly `{verdict, engine, decisionId?, authority:"none", warning?}` — never `agree`, the baseline's competing verdict, latency, or the experiment tally (§8.3).
- Boundary rejection (`ProjectionRejectedError`) degrades to a local verdict + `warning` and writes no record: no seal ⇒ no hash ⇒ no journal/experiment entry (§12).

**Work Guidance:**
- New decision verdict/field: change `schema.ts` first; the corpus and tests pin the legal space.
- Keep the local baseline deterministic and conservative; prefer `insufficient` over a guess.
- Add corpus fixtures with an `expected` label; `adversarial: true` for instruction-bearing evidence.
- Never widen the projection to carry raw payloads — add a bounded field instead.

**Verification:**
- `tests/decision/claim-verification.test.ts` — schema, projection bounds/redaction, baseline corpus + adversarial, Jev mapping, executor failure classes, fallback + capability enforcement, shadow journaling/agreement/authority, threshold-profile wiring (override flips a borderline verdict; resolver order incl. JEV-9 foreign-profile refusal).

**Child DOX Index:** none.
