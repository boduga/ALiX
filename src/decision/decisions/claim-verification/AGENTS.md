# DOX — Claim Verification Decision (J1)

**Purpose:** First production-shaped decision: does the evidence support, contradict, or fail to judge a claim? Enumerated verdicts only; grants no execution authority.

**Ownership:**
- `schema.ts` — `CLAIM_VERDICTS` (`supported|contradicted|insufficient`) + `isClaimVerdict`.
- `projection.ts` — `ClaimVerificationProjection` (claim + bounded evidence excerpts), projector, `readClaimProjection` (lenient read for local engines).
- `local-baseline.ts` — deterministic rule baseline (`classifyClaimLocally`): term overlap + whole-word negation + numeric mismatch; conservative `insufficient`.
- `corpus.ts` — labeled fixture corpus (supported/contradicted/insufficient + adversarial), `corpusById`.
- `jev-mapping.ts` — `toJevRequest` / `fromJevResponse`; unknown verdict → `MalformedResultError`.
- `shadow.ts` — `runClaimVerificationShadow`: project → run configured route → run local baseline → journal each under one `projectionHash`.
- `index.ts` — barrel.

**Local Contracts:**
- Verdict space is code-defined; unknown values rejected, never coerced (JEV-1).
- Projection failure throws before any engine runs — no remote call, no journal write.
- Evidence excerpts only; raw tool output/source files never enter the projection (JEV-4/JEV-5).
- Adversarial instruction text inside evidence is data, never authority.
- Local baseline emits no confidence (uncalibrated, JEV-9).
- Shadow results carry `authority: "none"`; the consumer decides what verification action follows.
- Baseline and observed outcomes journal separately under the same `projectionHash` — that is the J4 calibration/comparison input.
- `jev-mapping.ts` wire shape follows the documented System One surface and MUST be verified against the official SDK before enabling remote (plan stop condition).

**Work Guidance:**
- New decision verdict/field: change `schema.ts` first; the corpus and tests pin the legal space.
- Keep the local baseline deterministic and conservative; prefer `insufficient` over a guess.
- Add corpus fixtures with an `expected` label; `adversarial: true` for instruction-bearing evidence.
- Never widen the projection to carry raw payloads — add a bounded field instead.

**Verification:**
- `tests/decision/claim-verification.test.ts` — schema, projection bounds/redaction, baseline corpus + adversarial, Jev mapping, executor failure classes, fallback + capability enforcement, shadow journaling/agreement/authority.

**Child DOX Index:** none.
