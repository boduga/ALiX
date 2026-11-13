# Filesystem Effect Boundary (GE-04)

## Overview
The GE-04 governed-filesystem-authority seam. All four modules are deliberately **inert and deny-only**: a JavaScript process cannot establish independently administered approval, lease, release, and kernel-effect authority, so no module here authorizes filesystem I/O, and none is wired into the production file or patch routers ([final-effect-guard.ts:assessFinalEffect] module doc, [scoped-mutation.ts:createScopedMutationService] module doc).

## Interface
- `FinalEffectAssessment` / `assessFinalEffect(claim, observation, exactRequestBytes, nowMs)` — schema-and-evidence comparison returning only `disposition: "DENY"` ([final-effect-guard.ts:assessFinalEffect])
- `FINAL_EFFECT_DENIED` (`GE04_FINAL_EFFECT_UNQUALIFIED`) and `FINAL_EFFECT_PROTOCOL` (`ALIX_GE04_FINAL_EFFECT_V1`) ([final-effect-guard.ts:FINAL_EFFECT_DENIED])
- `ClaimedMutation`, `StoreObservation` — exact-key evidence shapes ([final-effect-guard.ts:ClaimedMutation])
- `requestDigest(bytes)` — SHA-256 of exact request bytes, rejecting non-`Uint8Array` input ([final-effect-guard.ts:requestDigest])
- `ScopedMutationOperation` (`create` | `replace` | `delete`), `ScopedMutationAuthority`, `ScopedMutationOutcome` ([scoped-mutation.ts:ScopedMutationOperation])
- `ScopedMutationService.mutate(authority, operation)` and `UnavailableScopedMutationService` ([scoped-mutation.ts:UnavailableScopedMutationService])
- `createScopedMutationService(platform)` — always returns the unavailable service ([scoped-mutation.ts:createScopedMutationService])
- `SupervisorEffectRequest` / `SupervisorEffectDenial` and `executeSupervisorEffect(request)` ([supervisor-effect-executor.ts:executeSupervisorEffect])
- `SUPERVISOR_EFFECT_HOLD` (`GE04_SUPERVISOR_EFFECT_UNQUALIFIED`) ([supervisor-effect-executor.ts:SUPERVISOR_EFFECT_HOLD])
- `RecoveryEvent`, `EvidenceCheckpoint`, `RecoveryDecision`, `examineRecovery(journal, expectedAnchor, replayAttemptId)` ([recovery-evidence.ts:examineRecovery])
- `fixtureAppend(previous, event)` / `fixtureCheckpoint(events)` — deterministic offline fixtures ([recovery-evidence.ts:fixtureAppend])
- `SUPERVISOR_RECOVERY_PROTOCOL`, `SUPERVISOR_RECOVERY_DENIAL`, `GENESIS_HASH` ([recovery-evidence.ts:SUPERVISOR_RECOVERY_PROTOCOL])

## Invariants
- `assessFinalEffect` can never return a permit: the disposition is pinned to `"DENY"` with code `GE04_FINAL_EFFECT_UNQUALIFIED`, and `checksMatched` records only that every comparison passed ([final-effect-guard.ts:assessFinalEffect]).
- The assessment result type carries no capability token, permit, unlock, or apply function ([final-effect-guard.ts:FinalEffectAssessment]).
- Claim and observation must match the exact key set; any extra or missing key yields a schema reason and short-circuits evidence checks ([final-effect-guard.ts:assessFinalEffect]).
- Exact request bytes are bounded to 1 MiB and must be a `Uint8Array`; digests are compared with `timingSafeEqual` ([final-effect-guard.ts:assessFinalEffect]).
- Approval must be `approved` and not yet consumed, lease must be `active`, policy must allow, and both expiry clocks must be in the future and equal ([final-effect-guard.ts:assessFinalEffect]).
- `ScopedMutationOutcome` separates `identical`/`changed: false` from `unverified`, and `unverified` is explicitly not a success claim ([scoped-mutation.ts:ScopedMutationOutcome]).
- `approvalId` is optional in the authority shape so callers are not forced to invent one, but the trusted verifier must require a non-empty value and fail closed ([scoped-mutation.ts:ScopedMutationAuthority]).
- `createScopedMutationService` returns the unavailable service on every platform, Linux included, until a native backend is implemented and reviewed ([scoped-mutation.ts:createScopedMutationService]).
- `executeSupervisorEffect` takes no injectable perform/apply/open/verify callback and returns `effectStarted: false`, `effectsPerformed: 0` for any input ([supervisor-effect-executor.ts:executeSupervisorEffect]).
- Recovery journals are bounded at 4096 events and validates an exact field set, hash chain, monotonically increasing sequence, and per-attempt phase order (`prepared` → `effect_entered` → `receipt_reported`) with a stable identity tuple ([recovery-evidence.ts:examineRecovery]).
- `examineRecovery` always appends `independent_effect_provenance_not_demonstrated`; a self-hashed transcript is never treated as proof of a kernel effect ([recovery-evidence.ts:examineRecovery]).
- A journal must be non-empty and its checkpoint count plus head hash must match, otherwise the decision is `UNVERIFIED` or `QUARANTINED` ([recovery-evidence.ts:examineRecovery]).
- A replayed attempt id yields status `QUARANTINED`; absence yields `UNVERIFIED` ([recovery-evidence.ts:examineRecovery]).
- `fixtureAppend` recomputes sequence and previous hash from the chain, rejects an oversize journal, and freezes its output ([recovery-evidence.ts:fixtureAppend]).

## Side Effects
- ["None"] — no module opens a path, writes disk, consumes a token, transitions a journal, or performs network I/O; hash generation is pure ([scoped-mutation.ts:UnavailableScopedMutationService], [supervisor-effect-executor.ts:executeSupervisorEffect], [recovery-evidence.ts:fixtureAppend]).

## Verification
- Run: `pnpm test`
