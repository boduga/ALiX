# A9 — Full Verification (post-implementation contract + invariant audit)

**Date:** 2026-08-17
**Phase:** A9 — Pre-Execution Risk Forecast & Governance Gating
**Purpose:** Independent, read-only verification of the merged A9 implementation (`28a1d121`, PR #552) against its locked spec contract and §48 architectural invariants. No source files modified.

Source truth:
- A9 spec: `docs/superpowers/specs/2026-08-15-a9-forecast-calibration-and-provenance-design.md`
- A9 plan: `docs/superpowers/plans/2026-08-15-a9-forecast-calibration-and-provenance.md` (§37 closeout)
- A9 SDD ledger: `.superpowers/sdd/2026-08-15-a9-forecast-calibration-and-provenance/progress.md`
- Merge-time closeout (10 invariants): `.superpowers/sdd/2026-08-15-a9-forecast-calibration-and-provenance/slice-5-closeout.md`

Verification method: read-only source + git-diff analysis, full test-suite re-run, typecheck, and a real-surface drive against compiled production code (`dist/`). This checkpoint closes the merge-time **10→16 invariant sign-off gap** and adds the contract-verification and real-surface evidence that did not exist at merge.

---

## 1. Verification baseline (current HEAD `f3da76a7`)

| Check | Result | Notes |
|-------|--------|-------|
| Full vitest suite | **488 files passed, 5196 passed, 7 skipped, 0 failed** | Up from 5101 at A9 merge (the +95 are the #568/#569 delegate-runtime tests). The one merge-time failure (`governance-sentinel-retired.vitest.ts`) is now skipped, not failing. |
| Typecheck (`tsc -p tsconfig.json --noEmit`) | **0 errors** | At A9 merge the SDD recorded "33 pre-existing type errors, base = 33". Those 33 are now gone — cleared by the intervening delegate-runtime + canonical-agent-surface PRs (#564/#568/#569). No A9 errors introduced at any point. |
| `pnpm build` | clean | dist/ is newer than src/ (drive ran against current compiled output). |
| Real-surface drive | **PASS** (all assertions) | See §5 — full production path: EventLog → forecast CLI → forecasts.jsonl → correlation → correlations.jsonl → restart reconstruction. |

**Verification is green.** The A9 implementation is functionally sound, type-clean, and fully test-covered at the current HEAD.

---

## 2. Architectural invariant sign-off (spec §48 — 16/16)

Merge-time closeout (`slice-5-closeout.md`) verified invariants **1–10**. The six not enumerated there — **#11–#16** — are now verified explicitly below with file:line + test evidence. Invariants 1–10 are re-confirmed (their tests are part of the green suite; key files cited).

| # | Invariant | Status | Evidence |
|---|-----------|--------|----------|
| 1 | A9 owns identity | ✅ (re-confirmed) | `src/evolution/a9/identity.ts`; `tests/evolution/a9-identity.vitest.ts`; sentinel (64-hex, deterministic) |
| 2 | A9 owns persistence | ✅ (re-confirmed) | `src/evolution/a9/forecasts-store.ts`, `correlations-store.ts`, `jsonl-store.ts`; sentinel: `forecasts.jsonl`/`correlations.jsonl` defined only under `src/evolution/a9/` |
| 3 | A9 owns correlation | ✅ (re-confirmed) | `correlation-engine.ts` writes only via `CorrelationsStore`; CLI exposes no correlation command (spec §33) |
| 4 | Foreign IDs remain references | ✅ (re-confirmed) | `a9-contract.ts:130` `foreignProvenance.proposalId` documented as reference; measurement record carries none |
| 5 | Measurements remain capability-targeted | ✅ (re-confirmed) | `measurement-event-types.ts` unmodified (Q8 sentinel); §3 below |
| 6 | Correlation is positive evidence | ✅ (re-confirmed) | bridge-failure paths return `null`/nothing (`correlation-engine.ts:147,150,153,154,162,164`); no negative/attempt artifact type exists |
| 7 | Correlation is many-to-many | ✅ (re-confirmed) | `tests/evolution/a9-correlation.vitest.ts` (:453, :477, :937, :958) |
| 8 | Artifacts immutable | ✅ (re-confirmed) | append-only stores; dedupe no-op + fatal collision (`jsonl-store.ts`); `a9-correlation.vitest.ts:656,993` |
| 9 | Calibration separated from correlation | ✅ (re-confirmed) | `a9-contract.ts:113` carries no `primary`/`terminal`/`resolved`/`attempted`/`correlationStatus`; `correlation-builder.ts` resolution is interpretation metadata |
| 10 | No speculative artifacts | ✅ (re-confirmed) | no `A9CorrelationAttempt` anywhere in `src/` |
| 11 | **Correlation is deterministic** | ✅ **NEW** | Identity = SHA-256 of canonical content (`identity.ts:51-64`); correlationId over FULL content not forecastId-only (`correlation-builder.ts`; test :248); same content→same id (:667), key-order-invariant (:686); deterministic emission order (`correlation-engine.ts:200-208`); `timestamp` explicitly not identity-bearing (:308) |
| 12 | **Correlation availability is an architectural fact** | ✅ **NEW** | Engine asserts a relationship ONLY when canonical evidence establishes it, else silent absence: no submitted → none (:339); target mismatch → none (:347); no executed → none (:361); rejected → none (:370/:379); wrong capability → none (:389); outside horizon → none (:402/:415); unparseable horizon fail-closed (:442). Also demonstrated live in the drive (§5). |
| 13 | **A9 never modifies foreign namespaces** | ✅ **NEW** | A9 merge touched exactly **3 non-A9 src files**, all authorized: `platform.ts` (composition-root wiring, §22 authorization; 65 additive lines + 1 constructor-signature extension), `governance.ts` (CLI seam), `decision-engine.ts` (6th-kind map entry + pure exporter). `measurement-event-types.ts`, `governance-types.ts` (CAP-9 taxonomy), A8 normalization all **byte-identical to base**. Adapters expose `list()` only — no write surface (`a9-contract.ts:249-252`). Sentinels forbid A9→`src/evolution/learning` imports and JSONL definitions outside `src/evolution/a9/`. |
| 14 | **Capability equality is not proposal provenance** | ✅ **NEW** | Bridge requires the full two-hop: `proposal.submitted` with `payload.candidate.target.id === subjectCapability` AND `proposal.executed` (`correlation-engine.ts:147-153`). Capability equality alone never correlates — tests :339/:347/:389 prove that target.id mismatch or missing submitted yields nothing even when `measurement.capabilityId === forecast.subjectCapability`. |
| 15 | **Execution is an eligibility gate, not causality proof** | ✅ **NEW** | `proposal.executed` gates correlation; its absence → no correlation (:153, :361). Rejected never correlates even when executed present (:154, :379). Sentinel pins the engine's `case "proposal.executed"`/`case "proposal.rejected"` and the doc comment states the gate explicitly (`correlation-engine.ts` header). |
| 16 | **A3 remains sovereign** | ✅ **NEW** | `RISK_GATED_REVIEW` is a non-binding A2.5 kind; `decision-engine.ts:65` maps it 1:1 → `REQUEST_MORE_EVIDENCE` (advisory); A3 retains exactly 4 binding kinds + 3 target states (sentinel `a9-sentinel.vitest.ts:221-237`). Bridge maps band→kind only (`a9-bridge.ts:79-90`); A9 never constructs a binding decision. Verified end-to-end in tests (:306) and live in the drive (§5). |

**Invariant closeout: 16/16 verified.** No invariant regression found.

---

## 3. Contract verification against source (A6-style)

### 3.1 `A9Forecast` — `src/evolution/a9/contracts/a9-contract.ts:58-95`

Verified shape: `forecastId` (content-addressed), `forecastVersion`, `subject` (proposalId), `subjectCapability`, `prediction { kind, band, internalScore }`, `horizon { from, to }`, `confidence`, `provenance { generatedAt, generatorVersion, evidenceRefs }`.

- Required fields all present; contract rule "no `primary`/`correlationStatus`/correlation semantics" honored (type-level pin in `a9-contracts.vitest.ts`).
- `A9ForecastContent = Omit<A9Forecast, "forecastId">` — identity structurally excludes the id (line 100).
- **No drift vs spec §6.**

### 3.2 `A9Correlation` — `a9-contract.ts:113-145`

Verified: `correlationId`, `correlationVersion`, `forecastId`, `measurementId`, `foreignProvenance { proposalId?, notes? }`, `resolution { band, forecastBand, delta }`. No `primary`/`terminal`/`resolved`/`attempted`/`correlationStatus` fields. `foreignProvenance.proposalId` correctly documented as the correlated forecast's subject, NOT measurement-carried (Q8).

### 3.3 Raw adapter records — `a9-contract.ts:159-223`

- `ProposalEventRecord`: `proposalId` read from **payload** (canonical `ProposalStore` location, `proposal-store.ts:175-180`), top-level fallback for other writers; `payload` preserved verbatim so `candidate.target.id` survives.
- `CapabilityMeasurementRecord`: `measurementId, capabilityId, outcome, recordedAt, eventId` — **no** `proposalId`/`sourceProposalIds`/`forecastId`/`correlationId` (Q8, contract + runtime sentinel).
- `EnrichedProposalRecord`: reads `enrichedFields` directly, never A8's normalized layer (sentinel-forbidden).

### 3.4 A2.5 six-kind extension — `src/evolution/verification/contracts/recommendation-contract.ts:33-48`

`GovernanceRecommendationKind` = 6 kinds: `APPROVE | MONITOR | REQUEST_ADDITIONAL_EVIDENCE | REJECT | ESCALATE | RISK_GATED_REVIEW`. The 5 pre-existing kinds unchanged; `RISK_GATED_REVIEW` added with doc: "A3 routes REQUEST_MORE_EVIDENCE (UNDER_REVIEW) until risk gated." Array `GOVERNANCE_RECOMMENDATION_KINDS` has exactly 6 entries (sentinel-pinned).

### 3.5 A3 four-kind / three-state contract — `src/evolution/governance/contracts/decision-contract.ts:32,145`

`GovernanceDecisionKind` = 4 binding kinds (incl. `REQUEST_MORE_EVIDENCE`); `targetState` = `"APPROVED" | "REJECTED" | "UNDER_REVIEW"` (3 states). Sentinel `a9-sentinel.vitest.ts:221-237` re-pins both.

### 3.6 A2.5 → A3 mapping — `src/evolution/governance/decision-engine.ts:58-80`

`RECOMMENDATION_KIND_MAP`: 5 entries behaviorally unchanged (incl. `RISK_GATED_REVIEW: "REQUEST_MORE_EVIDENCE"`), `ESCALATE` intentionally omitted. Pure `recommendationKindToDecisionKind` exporter added. **A3 remains sovereign** — the map is advisory routing, not a binding decision.

### 3.7 A9 bridge — `src/evolution/a9/a9-bridge.ts`

`buildGovernanceRecommendation` produces the A2.5 contract shape, `kind` from locked band mapping (low/medium→MONITOR, high/critical→RISK_GATED_REVIEW), `recommendationId = a9-rec:<forecastId>` (no second A9 identity), deterministic `evidenceId`. Satisfies `validateGovernanceRecommendation` (test :195).

### 3.8 Contract-drift findings

**None.** All A9 contracts match the spec and the lock ruling. The one merge-time drift class found in review (CLI `enrichedProposals: []` dead source) was already fixed post-merge via `createEnrichedProposalsSource` (see §4) and is confirmed live in the CLI seam (`governance.ts:350-370`).

---

## 4. Q8 boundary re-verification

- **Contract level:** `src/capability/measurement/measurement-event-types.ts` contains **no** `proposalId`, `sourceProposalIds`, `forecastId`, or `correlationId` (grep-verified; payload keys are `measurement/capabilityId/version`, `baseline`, `post`, `outcome`). Q8 holds.
- **Runtime level:** `MeasurementEventsAdapter` (`src/evolution/a9/adapters/measurement-events-adapter.ts`) emits only `measurementId, capabilityId, outcome, recordedAt, eventId` — never invents proposal linkage. Sentinel re-pins at both contract and record level (`a9-sentinel.vitest.ts:145-173`).
- **Engine level:** `correlation-engine.ts` reads capability equality but authorizes only through the proposal-side bridge; it never reads `measurement.proposalId` (sentinel line :268).

**Q8 boundary intact — no proposal linkage leaked into the measurement namespace.**

---

## 5. Real-surface drive (compiled production code, on-disk stores)

A one-off verification drive (`/tmp/a9-real-surface-drive.mjs`) seeded a **real** EventLog with a full proposal lifecycle and ran the **actual production** `runForecastCli` handler against an on-disk `.alix/governance`, then drove `CorrelationEngine` programmatically. All assertions passed:

| Step | Result |
|------|--------|
| CLI forecast (`runForecastCli`, json:true) | exitCode 0; 1 forecast; subject `prop-drive-1`; band `high` |
| A3 decision surface | `RISK_GATED_REVIEW → REQUEST_MORE_EVIDENCE → UNDER_REVIEW` ✓ |
| `forecasts.jsonl` persisted on disk | 1 line; forecastId = 64-hex content address; adapter round-trip id matches |
| **Negative correlation** (no measurement yet) | 0 correlations — silent absence (invariant #12) ✓ |
| Measurement lands within horizon | 1 correlation emitted (two-hop bridge authorized: submitted→executed→measured) |
| Correlation resolution | `delta: "under-forecast"` — forecast said `high`, outcome `ineffective`→`critical`, so observed risk exceeded forecast ✓ |
| `correlations.jsonl` persisted | 1 line; content-addressed correlationId |
| **Restart reconstruction** | fresh EventLog + fresh stores reconstruct 3 events / 1 forecast / 1 correlation from disk ✓ |

**The drive also validated the bridge's proposalId source:** an `proposal.executed` event appended WITHOUT `payload.proposalId` (a drive-authoring mistake) produced **no** correlation — the engine correctly refused because `proposalId` was `""`. This is not a bug; it is the canonical producer contract (`ProposalStore` always writes `payload: { proposalId, ... }`) and the bridge enforcing it. After correcting the drive to mirror the real producer, correlation succeeded.

**Gap closed:** the exploration flagged "no test drives a real EventLog + real `.alix/governance` through the actual production path." That drive now exists as evidence here. (It is a scratch verification artifact, not a committed test — the committed `a9-composition-root.vitest.ts` already covers the wiring at unit level; a committed real-store integration test could be a future hardening item, see §7.)

---

## 6. A8 proposalId defect — adjudication

**Confirmed latent defect (pre-existing, NOT A9):** `src/evolution/learning/adapters/proposal-events-adapter.ts:51` reads `event.proposalId ?? ""` — but the canonical producer `ProposalStore.append()` writes `proposalId` **inside the payload** (`proposal-store.ts:175-180`, `payload: { proposalId, ...payload }`), and its read-back helper reads `payload.proposalId` (`proposal-store.ts:198`). A top-level `event.proposalId` is never populated by the canonical producer, so A8's `ProposalGovernanceRecord.proposalId` is **always `""`** on real data.

**A9's adapter does NOT share the defect:** `src/evolution/a9/adapters/proposal-events-adapter.ts:68-71` reads `payload.proposalId` first, `event.proposalId` as fallback. Correct.

**Divergence (A8 vs A9 read the same EventLog from different locations):** documented at both sites. This is a genuine architectural divergence that a future A8 fix must reconcile — A8's adapter should adopt A9's payload-first read.

**Ruling:** A9 is correct. The A8 defect is **re-parked** (pre-existing, out of A9 scope; fixing it is an A8 correction, not an A9 change). It is now recorded with exact file:line and a remediation path. When A8 is next touched, this is a one-line fix (`event.proposalId ?? ""` → payload-first read with the same fallback).

---

## 7. Concerns / decisions for later tasks

1. **[LOW] A8 proposalId defect (confirmed, re-parked).** `src/evolution/learning/adapters/proposal-events-adapter.ts:51`. Fix when A8 is next modified: payload-first read (mirror `a9/adapters/proposal-events-adapter.ts:68-71`). A8's repeated-pattern-failure detector keys on `${error}:${capabilityId}` (not proposalId), so the defect does not currently corrupt detector output — but `ProposalGovernanceRecord.proposalId` is unreliable on real data.
2. **[LOW] Committed real-store integration test.** The real-surface drive is strong evidence but lives in `/tmp` (scratch). A committed `a9-real-store.vitest.ts` (seeded EventLog → `runForecastCli` → inspect `forecasts.jsonl` + programmatic correlation → restart reconstruction) would make the drive a permanent regression net. Optional hardening, not a merge-blocker.
3. **[INFO] Invariant registry is scattered.** Spec §48 (16), plan §37 closeout (10), #546 grilling (10), security `.git/sdd/task-s0-invariants.md` (12) vs `docs/security/architecture.md` (10). This checkpoint verifies the spec §48 set (the authoritative post-implementation contract). The repository-wide invariant audit (the roadmap's next phase) will adjudicate the count discrepancies centrally.
4. **[INFO] Enriched-proposals seam.** `createEnrichedProposalsSource` (lazy P10.8a analyzer) is wired in `platform.ts:207-209` and the CLI seam (`governance.ts:350-370`). The seam comment notes a future increment "MUST revisit" real `EnrichedProposal[]` derivation — currently the P10.8a analyzer output; documented, not a defect.

---

## 8. References

- A9 spec §48 invariants: `docs/superpowers/specs/2026-08-15-a9-forecast-calibration-and-provenance-design.md:2033-2083`
- Merge-time closeout (10 invariants): `.superpowers/sdd/2026-08-15-a9-forecast-calibration-and-provenance/slice-5-closeout.md`
- A9 sentinels: `tests/evolution/a9-sentinel.vitest.ts`
- A9 test suite (14 files): `tests/evolution/a9-{contracts,adapters,detectors,engine,correlation,persistence,governance,identity,risk-band,cli,cli-dispatch,composition-root,engine-end-to-end,sentinel}.vitest.ts`
- A6 contract-verification precedent: `docs/architecture/checkpoints/2026-08-10-a6-contract-verification.md`
- A8 closeout format precedent: `docs/architecture/checkpoints/2026-08-14-a8-organizational-learning-complete.md`
