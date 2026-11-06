# GE-04 Q3.17 — Durable executor route contract qualification

**Status: opt-in, read-side qualification only. GE-04 SECURITY HOLD remains active.**

`qualifyDurableExecutorRouteContract` re-reads the authoritative `CoordinationStore` run, requires the claimed worker to be running under the expected attempt and execution owner, requires a persisted route snapshot, resolves scheduler canonical `models.*`, and validates snapshot/route parity. It returns a frozen non-secret contract with the primary and ordered fallbacks. `assertExecutorRouteContractMatches` checks a supplied actual executor route against that contract.

The contract is **not an authenticated authorization**, a bearer token, or proof that a child used the asserted provider. The function's config, tier, identity and proposed executor route are caller-supplied; a compromised same-UID worker may still access broad credentials through existing configuration, store or environment paths. The Q3.16-discovered child CLI fallback-loss gap is not fixed. There is no production scheduler/executor integration or credential-delivery change.

Tests cover no-claim fail-closed behavior, fresh-store replay, canonical primary/fallback preservation, missing fallback/substituted primary rejection, wrong owner/attempt, revoked snapshot and unresolved selection. Additional future gates must verify plan changes, retry, ownership transfer, durable revocation and broker authorization under real concurrent transitions.

Next: integrate a scheduler-owned route with actual child provider construction, ensure it is enforced before credential loading, and introduce independently authenticated broker-side grant validation with OS isolation. Do not lift the security hold based on route contract equality alone.
