# Inspector Security (Auth + Principals)

## Overview
Inspector authentication and operator-identity primitives: hash-only credential storage, the durable operator principal store, the single credential→principal binding, browser sessions, and the request-level security policy layer (route registry, authorization, host/origin/remote-access checks, client-address resolution, rate and connection limits). No secrets are stored here — provider keys live in `../credentials/`.

## Interface
- `AuthStore`, `StoredToken`, `TokenRevocation`, `AuthStoreData`, `MAX_TOKEN_COUNT = 32`, `AUTH_STORE_SCHEMA_VERSION = 1`, `createTokenRecord`, `createRevocation` — hash-only token records backed by `<authStateDir>/auth-store.json` `[auth-store.ts:AuthStore]`
- `PrincipalStore`, `PrincipalRecord`, `PrincipalStatus`, `MAX_PRINCIPAL_COUNT = 128`, `createPrincipalRecord` — durable operator identity/status records in `<authStateDir>/principals.json` `[principal-store.ts:PrincipalStore]`
- `StoreLocks`, `withStoreLocks`, `withStoreLocksResult`, `STORE_LOCK_ORDER`, `storeLockFile` — cross-process store serialization with a canonical lock order `[store-lock.ts:StoreLocks]`
- `readStoreFile`, `writeStoreFileAtomic`, `StoreResult` — shared store read/write primitive `[store-file.ts:writeStoreFileAtomic]`
- `AuthService`, `AuthTokenRole`, `AUTH_TOKEN_ROLES`, `TokenInfo`, `TokenCreationResult`, `TokenRotationResult`, `AuthPrincipal`, `MigrationReport`, `ReconcileReport`, `ServiceResult` — enrollment, rotation, revocation, principal lifecycle, migration, and verification `[auth-service.ts:AuthService]`
- `SecurityContext`, `createSecurityContext` — request-scoped auth/route/principal context `[security-context.ts:SecurityContext]`
- `TOKEN_PREFIX = "alix_i_"`, `TOKEN_ID_LENGTH = 12`, `SECRET_BYTES = 32`, `MAX_TOKEN_LENGTH = 256`, `generateToken`, `parseToken`, `verifyTokenHash`, `sha256` — Inspector token format and constant-time hash verification `[token-format.ts:parseToken]`
- `canonicalWorkspaceId`, `allowsWorkspace` — host-local workspace identity and scope eligibility `[workspace-scope.ts:allowsWorkspace]`
- `BrowserSessionStore`, `SessionPrincipal`, `BrowserSession` — in-memory, non-persisted browser sessions `[browser-session-store.ts:BrowserSessionStore]`
- `RateLimiter`, `RateLimiterConfig`, `Clock`, `monotonicClock`, `normalizeClientAddress`, `buildRateLimitKey`, `buildRateLimitHeaders`, `createPreAuthLimiter`, `createPostAuthLimiter` — token-bucket request limiting `[rate-limiter.ts:RateLimiter]`
- `ConnectionLimiter`, `ConnectionToken`, `ReserveResult`, `ConnectionDiagnostic` — global, per-principal, and per-address connection caps `[connection-limiter.ts:ConnectionLimiter]`
- `RoutePolicyRegistry`, `RouteDescriptor`, `routeRegistry`, `RouteAuth`, `RouteClass`, `RouteMethod`, `PathType`, `RouteRedactionProfile` — canonical route registration and lookup `[route-policy.ts:RoutePolicyRegistry]`
- `authorize`, `AuthorizationResult` — route authorization against a `SecurityContext` `[authorization.ts:authorize]`
- `resolveClientAddress`, `parseForwardedChain`, `parseCidr`, `normalizeAddress`, `proxyTrustDiagnostic` — trusted-proxy client-address resolution `[client-address.ts:resolveClientAddress]`
- `validateHost`, `normalizeHost`, `defaultLoopbackHosts` — Host-header validation and DNS-rebinding defense `[host-policy.ts:validateHost]`
- `validateOrigin`, `validateSecFetchSite`, `validateRequestOrigin`, `buildOrigin`, `isWildcardOrigin`, `ORIGIN_VARY_HEADERS` — Origin and `Sec-Fetch-Site` policy `[origin-policy.ts:validateRequestOrigin]`
- `resolveAccessMode`, `detectConnectionSecurity`, `validateRemoteAccess`, `shouldSetSecureCookie`, `validateRemoteAccessStartup`, `remoteAccessDoctorReport`, `isLoopbackBind`, `isEncrypted`, `checkStartupSafety` — remote-access transport policy `[remote-access-policy.ts:validateRemoteAccess]`
- `AuthAuditStore`, `AuthAuditInput`, `AuthAuditRecord` — fail-closed auth audit event store `[auth-audit-store.ts:AuthAuditStore]`

## Invariants
- Stored tokens are hash-only; the raw token is returned exactly once at creation and never persisted `[auth-store.ts:StoredToken]` `[token-format.ts:generateToken]`
- `StoredToken.principalId` is the single authority for the credential→principal binding; membership is derived by scanning tokens, with no reverse list `[auth-store.ts:StoredToken]`
- Revocation preserves `principalId` for attribution; the revocation record is what denies access `[auth-store.ts:TokenRevocation]`
- A genuinely unbound legacy credential keeps ordinary access; a bound credential whose principal is active passes; a bound credential whose principal is disabled, missing, or unreadable denies all authentication, as does any revoked or expired credential `[auth-service.ts:checkBoundPrincipal]`
- `verifyPrincipalStatus` re-reads status on every cookie request so an out-of-process disable or revocation takes effect immediately `[auth-service.ts:verifyPrincipalStatus]`
- Workspace scope: `undefined` preserves legacy access, `[]` denies, and a non-empty list requires the target workspace to be included `[workspace-scope.ts:allowsWorkspace]`
- Record revisions use compare-and-set; every read-modify-write re-reads authoritative state after acquiring the lock `[auth-store.ts:StoredToken]` `[principal-store.ts:PrincipalRecord]`
- Lock order is canonical `principals` → `auth-store`; a held or stale lock fails closed with no write `[store-lock.ts:STORE_LOCK_ORDER]`
- Auth mutations are write-ahead audited; a failed audit append persists nothing and is never reported as success `[auth-audit-store.ts:AuthAuditStore]`
- Missing store files read as `ok: null`; malformed files return `corrupt_store_file`; other read failures return `store_read_failed` `[store-file.ts:readStoreFile]`
- `register` rejects duplicate route descriptor ids, and `get` prefers exact matches over prefix/pattern matches sorted by specificity `[route-policy.ts:RoutePolicyRegistry]`
- `authorize` denies unauthenticated protected/SSE routes with 401, missing permissions with 403, and fails closed on unknown auth modes or internal errors `[authorization.ts:authorize]`
- Host validation rejects missing hosts, userinfo, path/fragment/query separators, control characters, and hosts outside the allowlist `[host-policy.ts:validateHost]`
- A wildcard origin is rejected when credentials are present, and cookie-authenticated requests must be same-origin `[origin-policy.ts:validateOrigin]`
- Browser sessions are never persisted, are capped (default 256), and expire on absolute TTL (24h) or idle TTL (1h) `[browser-session-store.ts:BrowserSessionStore]`
- Rate-limit keys are bounded to 128 characters, idle buckets are swept after 5 minutes, and total tracked entries default to 10,000 `[rate-limiter.ts:buildRateLimitKey]`
- Connection limits default to 100 global, 10 per principal, and 20 per address; `release` is idempotent `[connection-limiter.ts:ConnectionLimiter]`
- Forwarded chains longer than 4 proxy hops or containing malformed addresses are rejected and fall back to the peer address `[client-address.ts:parseForwardedChain]`
- Remote mode rejects cleartext bearer auth (unless the peer is loopback) and cleartext cookie auth when TLS is required `[remote-access-policy.ts:validateRemoteAccess]`

## Side Effects
- Reads and writes `auth-store.json` and `principals.json` under the auth-state directory with temp-file + rename, `0o700` directory and `0o600` file modes, rejecting symlinks `[store-file.ts:writeStoreFileAtomic]`
- Acquires cross-process lock files for the `principals` and `auth-store` stores around every mutation `[store-lock.ts:withStoreLocks]`
- Appends auth audit records to `<authStateDir>/audit.jsonl` and awaits the write before acknowledging the mutation `[auth-audit-store.ts:AuthAuditStore]`
- Creates principals before credentials during enrollment so the only reachable partial state is an inert orphan principal `[auth-service.ts:createToken]`
- Emits security metrics for verification outcomes on the injected metrics sink `[auth-service.ts:AuthService]`
- Holds browser sessions and rate/connection counters in process memory only; a restart clears them `[browser-session-store.ts:BrowserSessionStore]` `[rate-limiter.ts:RateLimiter]`
- Reports remote-access and proxy-trust diagnostics for `alix doctor` without mutating configuration `[remote-access-policy.ts:remoteAccessDoctorReport]` `[client-address.ts:proxyTrustDiagnostic]`

## Verification
- Run: `pnpm test`
