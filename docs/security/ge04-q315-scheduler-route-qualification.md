# GE-04 Q3.15 — Canonical scheduler route qualification seam

**Status: opt-in qualification, not authenticated authority. GE-04 SECURITY HOLD remains active.**

`qualifyAndClaimSchedulerWorkerRoute` resolves the model tier from scheduler-provided canonical `models.*` via Q3.10, rejects unresolved selection, optionally compares the worker-proposed primary and ordered fallbacks, and passes only the resolved canonical model into the Q3.14 durable claim. The store still checks plan revision inside its per-run lock and persists claim + snapshot as one ledger fact.

The new tests cover canonical route persistence, primary/fallback substitution rejection with no ledger mutation, unresolved selection rejection and stale plan CAS. Q3.13 and Q3.14 store tests remain the regression baseline.

## Unresolved production security requirements

The function's config and tier are supplied by its caller, so it is not an authenticated decision plane. The live scheduler does **not** call this seam. Worker role/style resolution and actual executor routing can diverge from a configured tier; dynamic selection remains unsupported. The worker CLI still loads broad credentials before route resolution. No broker, sender, or credential access paths are changed. Next gate must prove scheduler-owned tier/route selection and executor parity, then durable revocation/retry/owner invalidation before any credential delivery can be enabled.
