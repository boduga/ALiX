# GE-04 Q3.9 — Durable model-route authority (design + synthetic contract)

Status: synthetic route-evidence prototype only. GE-04 SECURITY HOLD remains active.

## Existing gaps

The coordination store persists an atomic worker claim, including incremented attempt, running state and execution owner, but not a concrete, authorized primary/fallback model route. `buildFallbackChain` supplies ordered runtime routing candidates; `planWorkerCredentialGrant` derives provider names from a resolved model. Neither proves that the model was selected by trusted scheduler policy. A hash computed from caller-supplied data cannot establish provenance.

## Prototype

`src/agents/worker-route-authority.ts` creates a frozen projection of ordered concrete route candidates and SHA-256 digest bound to run ID, worker ID, attempt, owner ID and plan revision. It requires Q3.8 post-claim record qualification. Its comparison rejects changed primary/fallback candidates, stale attempts, owners and revisions. Tests are pure synthetic fixtures; no credentials, storage or scheduler behavior are changed.

## Required durable contract before production

1. Establish the scheduler-owned authoritative model resolver, including dynamic model selection, explicit fallbacks and provider-specific runtime constraints. Resolve before grant issuance; do not trust worker-selected routes.
2. Persist or atomically associate a canonical, versioned route snapshot with the successfully claimed worker attempt, owner and plan revision. Define how restarts, retries, replans and owner handoffs invalidate it.
3. Ensure the grant broker verifies the record and authorized route at the final issuance/consumption boundary under appropriate locking or transactional semantics. A separate read and later issue is subject to TOCTOU.
4. Protect authority with process/UID isolation and authenticated IPC. Hashes are not signatures, and worker access to the record or factory must not confer registration authority.
5. Enforce the authorized route in actual model adapter selection, including fallback execution, not merely in a credential provider list. Keep alternative `loadConfig`/credential-store/environment access closed to workers.
6. Require crash/replay, competing-owner, stale-revision, route-switch, and fail-closed end-to-end tests before lifting HOLD.

## Non-goals

No production FD-3 changes, secret materialization, credential delivery, security HOLD release or policy bypass in Q3.9.
