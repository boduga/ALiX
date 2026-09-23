# DOX — Risk Escalation Decision (J6)

**Purpose:** Judge the severity of ONE action as low/medium/high so deterministic policy can compose it into an approval requirement. Escalation only — this decision can never waive what policy requires.

**Ownership:**
- `schema.ts` — `RISK_TIERS` (`low|medium|high`, ordered) + `isRiskTier` + `RISK_TIER_CANDIDATES`.
- `projection.ts` — `RiskEscalationProjection` (capability + bounded summary/detail), projector, `readRiskProjection`. Raw commands, arguments, and tool output never enter.
- `local-baseline.ts` — `classifyRiskLocally`: read-only capabilities cannot mutate (low); destructive/irreversible-exposure markers (incl. `publish`) high; mutation markers or anything unknown medium.
- `corpus.ts` — labeled action fixtures + adversarial-instruction fixtures.
- `jev-mapping.ts` — `toJevRiskRequest` / `fromJevRiskResponse`; `RISK_CRITERIA` is exported so the model-facing rubric is verifiable; unknown tiers are malformed.
- `shadow.ts` — `runRiskEscalationShadow`: project → run configured route → run local baseline → journal each; reports the composed `recommendApproval` as an observation.
- `selection-service.ts` — `selectRiskTier` with `off` (judge nothing) / `shadow` / `active`.
- `index.ts` — barrel.

**Local Contracts:**
- JEV-8: escalation composes monotonically — `recommendApproval = policyRequires OR tier above low`. A low tier never cancels a policy-required approval; an unknown tier counts as exceeding the bar.
- The recommendation is advisory. Only PolicyGate can require an approval; this decision has no enforcement path.
- Verdict space is code-defined; unknown values rejected, never coerced (JEV-1).
- Projection failure throws before any engine runs — no remote call, no journal write.
- Summary/detail only; raw commands, arguments, and tool output never enter the projection (JEV-4). Secrets are rejected at the boundary (JEV-3).
- Adversarial instruction text inside the summary is data, never authority.
- **Labels are revisable from evidence.** When an engine disagrees with a label and the label is the weaker claim, correct the label, the rubric, and the fallback's markers together — never just the label, or the fallback would disagree with the rubric it exists to serve. Precedent: `publish-package` was `medium` until a live Jev replay rated it `high`; the rubric's `high` description omitted irreversible public exposure, so all three were corrected and the corpus records the revision.
- Local baseline emits no confidence (uncalibrated, JEV-9).
- `riskEscalation.enabled` absent/false judges nothing (existing behavior kept).
- Shadow results carry `authority: "none"`.
- Wire shape is `verified-against-docs` (see `engines/jev-protocol.ts` for the source links); remote is opt-in via `remote.jev.enabled`.

**J6 admission review (hand-off §14):**
- Atomic: "what risk tier is this single action?" — one action, one judgement. Admitted.
- Legal output space code-defined: `low|medium|high`.
- Projection minimized/redacted: capability + bounded human summary; raw args excluded by shape, secrets rejected at the boundary.
- Deterministic authority intact: the decision may only escalate; PolicyGate remains the sole approval authority.
- Measurable outcome: labels `correct|incorrect` plus the FP/FN direction feed J4 calibration (`errorType`).
- Deferred to a later review: bounded candidate-action selection (too close to free-form next-action generation) and per-domain parallel-task classification (needs a relational judgement, not an atomic one).

**Work Guidance:**
- Keep the baseline conservative: unknown capability or effect escalates, never clears.
- A new marker belongs in the destructive/mutation sets only if it names an effect, never a bare word that also reads descriptively.
- Do not widen the projection to carry raw commands "for accuracy" — the boundary will reject the secrets they contain, and the decision does not need them.

**Verification:**
- `tests/decision/risk-escalation.test.ts` — schema, projection bounds/redaction, baseline corpus + adversarial, Jev mapping, executor failure classes, fallback, shadow journaling/agreement/recommendation (incl. policy-already-required and unknown-tier fail-closed), `selectRiskTier` off/shadow/active.

**Child DOX Index:** none.
