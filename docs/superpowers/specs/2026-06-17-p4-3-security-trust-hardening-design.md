# P4.3 — Security and Trust Hardening Design

**Date:** 2026-06-17
**Status:** Draft (awaiting user review)
**Baseline:** `p4.2-observability-baseline` (8367775b)
**Tracks:** P4.3a–g — 7 milestones, 2 parallel streams

---

## 1. Architecture Overview

### 1.1 Two Trust Boundaries, One Security Layer

The ALiX security model addresses two independent trust boundaries concurrently:

```
Stream A: Inspector Boundary (P4.3a → P4.3b → P4.3c)
  Protects the HTTP/SSE surface against unauthorized access,
  data leakage, and resource abuse.

Stream B: Integrity Boundary (P4.3d → P4.3e)
  Protects stored audit records and configuration against
  undetected tampering.

Then: Supply chain (P4.3f) → Acceptance gate (P4.3g)
```

Both streams converge in a shared security middleware pipeline in the Inspector server.

### 1.2 Middleware Pipeline

One `src/server/security-middleware.ts` module owns the request lifecycle. All Inspector routes (REST + SSE) pass through the same deterministic pipeline:

```
request size/method validation
→ authentication (token check)
→ authorization (permission check)
→ origin validation
→ rate/connection limiting
→ route handler (with security context)
→ response redaction
→ security audit event
```

The security subsystem (`src/security/`) provides pure policy primitives (auth verification, permission maps, redaction rules, rate limit state, origin policies). The middleware layer wires them into the HTTP lifecycle.

### 1.3 Security Context

Every authenticated request produces a shared context object:

```typescript
type InspectorSecurityContext = {
  requestId: string;
  clientIp?: string;
  origin?: string;
  principal: InspectorPrincipal;
  permissions: InspectorPermission[];
};
```

Routes consume this context to decide what to expose. No route interprets auth independently.

```typescript
type InspectorPrincipal = {
  id: string;
  role: "viewer" | "operator" | "admin";
  authentication: "bearer-token" | "loopback";
};

type InspectorPermission =
  | "health:read"
  | "metrics:read"
  | "events:read"
  | "coordination:read"
  | "approvals:read"
  | "approvals:write"
  | "recovery:read"
  | "recovery:repair"
  | "config:read";
```

#### Role → Permission Mapping

| Role | Permissions |
|------|------------|
| `viewer` | health:read, metrics:read, events:read (redacted) |
| `operator` | viewer + coordination:read, approvals:read, approvals:write |
| `admin` | operator + recovery:repair, config:read |

---

## 2. P4.3a — Redaction Policy and Secret-Safe Telemetry

### 2.1 Service Interface

```typescript
interface SecurityRedactor {
  redactValue(
    value: unknown,
    context: RedactionContext,
  ): RedactionResult;
}
```

Parameters:
- `value` — any serializable value (object, array, string, primitive)
- `context` — classification hints, depth limit, allowlist

Return:

```typescript
type RedactionResult = {
  value: unknown;            // redacted copy (no mutation of source)
  redactedCount: number;
  classifications: RedactionClassification[];
};

type RedactionClassification =
  | "api_key" | "bearer_token" | "private_key"
  | "password" | "cookie" | "authorization_header"
  | "credential_url" | "environment_secret"
  | "high_entropy_string";
```

### 2.2 Two-Layer Architecture

**Ingress redaction** — applied before `TelemetryEnvelope` or audit payload is persisted:
- Runs in the telemetry sink before JSONL append
- Uses the same `SecretScanner` patterns from `src/security/` + schema-aware key-name rules

**Egress redaction** — applied before Inspector responses, SSE events, CLI output, exports:
- Runs as the final middleware step before `res.end()`
- Re-redacts to catch anything the ingress layer missed

### 2.3 Redaction Safeguards

- Depth limit (default 10)
- Object/property count limit (default 1000)
- Cycle protection via `WeakSet`
- Maximum string length checked (default 64KB)
- Key-name redaction (fields matching `key|secret|token|password|auth`, case-insensitive)
- Pattern-based redaction (reuses existing `SecretScanner` regexes)
- Allowlisted safe identifiers (by object path prefix)
- No mutation of the source object — always returns a copy

### 2.4 Redaction Markers

```typescript
"[REDACTED:api_key]"
"[REDACTED:bearer_token]"
"[REDACTED:private_key]"
"[REDACTED:password]"
"[REDACTED:credential_url]"
"[REDACTED:high_entropy_string]"
```

Do not include secret hashes in externally visible output — hashes can become correlation identifiers.

### 2.5 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/redaction/redactor.ts` | CREATE | Core `SecurityRedactor` with safeguards |
| `src/security/redaction/classifications.ts` | CREATE | Classification enum and type |
| `src/security/redaction/redaction-policy.ts` | CREATE | Allowlists, key-name rules, depth config |
| `src/observability/telemetry-envelope.ts` | MODIFY | Wire ingress redaction into `TelemetrySink` |
| `src/server/security-middleware.ts` | CREATE | Wire egress redaction into response pipeline |
| `tests/security/redaction/*.test.ts` | CREATE | Unit and integration tests |
| `tests/observability/telemetry-envelope.test.ts` | MODIFY | Add redaction tests |

---

## 3. P4.3b — Inspector Identity and Permission Enforcement

### 3.1 Token-File Authentication

A token file at `.alix/inspector-token` controls access to the Inspector server.

**Token lifecycle:**

```
alix inspector auth init      → generate token, write file, print token once
alix inspector auth status    → show file perms, hash, creation date
alix inspector auth rotate    → generate new token, keep old valid briefly
alix inspector auth revoke    → delete token file, optional grace period
```

**Token generation requirements:**
- Cryptographically random via `crypto.randomBytes(32)` — 256 bits minimum
- Encoded as base64url (43 characters)
- No log output at any step
- Never exposed through telemetry or Inspector responses

**Token storage:**
- `.alix/inspector-token` — stores the raw token
- Used only for validation at request time
- `0600` permissions on Unix
- Best-effort ACL restriction on Windows

**Token verification:**
- Read token file on each auth check (allows live rotation/revocation)
- Constant-time comparison via `crypto.timingSafeEqual`

**Storage for multi-token rotation:**
- `.alix/inspector-auth.json` — metadata-only, never stores raw tokens

```typescript
type InspectorTokenRecord = {
  version: 1;
  tokenId: string;
  tokenHash: string;       // SHA-256 of raw token
  createdAt: string;
  rotatedAt?: string;
  revokedAt?: string;
};
```

Use `crypto.createHash("sha256")` + `crypto.timingSafeEqual` for verification. Because the token is already high-entropy (256 bits), password-hardening is unnecessary — SHA-256 with constant-time comparison is appropriate.

### 3.2 Network Binding Default

- Loopback (`127.0.0.1` / `::1`) binding: authentication is **mandatory** by default (transition period optional for backward compat)
- Non-loopback binding: authentication is **always mandatory**
- Configurable via `alix config set ui.host 0.0.0.0`

Even loopback defaults to token authentication for sensitive endpoints (approvals:write, recovery:repair, config:read) unless a compatibility transition is explicitly configured.

### 3.3 Authentication + Authorization Flow

1. Extract `Authorization: Bearer <token>` header
2. Read `.alix/inspector-token`, compare via `timingSafeEqual`
3. Read `.alix/inspector-auth.json` to check revocation/rotation status
4. Resolve principal role from token ID → role mapping
5. Resolve permissions from role mapping table
6. Attach `InspectorSecurityContext` to request
7. Route handler checks `context.permissions` before serving data

### 3.4 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/inspector/auth-service.ts` | CREATE | Token generation, verification, rotation, revocation |
| `src/security/inspector/authorization.ts` | CREATE | Role/permission mapping, permission checks |
| `src/security/inspector/security-context.ts` | CREATE | `InspectorSecurityContext`, `InspectorPrincipal`, `InspectorPermission` types |
| `src/server/security-middleware.ts` | CREATE | Middleware pipeline — auth → authz → origin → rate → handler → redaction → audit |
| `src/cli/commands/security.ts` | CREATE | `alix security *` CLI commands (delegates to `auth-service.ts`) |
| `src/server/server.ts` | MODIFY | Wire middleware before all route dispatching |
| `tests/security/inspector/*.test.ts` | CREATE | Unit and integration tests |
| `tests/server/server.test.ts` | MODIFY | Auth integration tests |

---

## 4. P4.3c — Network Boundary and Resource-Abuse Controls

### 4.1 Origin Validation

- Check `Origin` header against configured allowlist
- Browser clients MUST present a matching Origin
- Non-browser clients (curl, SDK) MAY omit Origin — allowed if authenticated
- No wildcard origins when credentials are accepted
- Configurable via `alix config set inspector.allowedOrigins`

### 4.2 Rate Limiting

In-memory token-bucket rate limiter per `(principalId + clientIp + routeClass)`.

**Route classes:**
| Class | Example Routes | Default Rate |
|-------|---------------|-------------|
| `health` | `/api/observability/health` | 100 req/s burst 200 |
| `metrics` | `/api/observability/metrics` | 50 req/s burst 100 |
| `events` | `/api/coordination/*/events` | 20 req/s burst 40 |
| `expensive` | `/api/graphs/*/projection` | 5 req/s burst 10 |
| `mutating` | approvals:write, recovery:repair | 2 req/s burst 4 |

**Key design decisions:**
- Maximum number of buckets: 10,000 (bounded memory)
- Idle-bucket eviction after 5 minutes with no activity
- Monotonic time source via `performance.now()` or `Date.now()`
- Separate limits for REST and SSE connections
- `Retry-After` header on rate-limited responses
- Standard rate-limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`)
- Configurable burst and refill per route class
- No unbounded IP-key growth — bucket map has a hard cap

**Proxy awareness:**
- `X-Forwarded-For` is NOT trusted by default
- Only honored when `inspector.trustedProxy = true` or a trusted proxy CIDR/list is explicitly configured

### 4.3 SSE-Specific Controls

| Control | Implementation |
|---------|---------------|
| Authentication | Before SSE headers are committed — reject unauthenticated early |
| Allowed origins | Origin validated before SSE response headers |
| Max global connections | Configurable (default 50) |
| Max connections per principal | Configurable (default 5) |
| Max connections per IP | Configurable (default 3) |
| Heartbeat timeout | 30s keepalive, configurable |
| Max connection lifetime | Configurable (default 24h) |
| Bounded write queue | Max 100 buffered events per connection |
| Slow-client disconnection | Abort if write buffer exceeds 10s |
| Listener/timer cleanup | On `close`, `error`, or lifetime expiry |
| `Last-Event-ID` validation | Only accept monotonic sequences |
| Event payload redaction | Egress redactor applied before `res.write()` |

### 4.4 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/inspector/origin-policy.ts` | CREATE | Origin allowlist, validation logic |
| `src/security/inspector/rate-limiter.ts` | CREATE | Token-bucket rate limiter with eviction |
| `src/security/inspector/connection-limiter.ts` | CREATE | Connection tracking, limits, cleanup |
| `src/server/security-middleware.ts` | MODIFY | Add origin check, rate limit, SSE controls |
| `src/server/observability-stream.ts` | MODIFY | Add connection tracking, payload redaction |
| `tests/security/inspector/rate-limiter.test.ts` | CREATE | Token bucket tests |
| `tests/security/inspector/origin-policy.test.ts` | CREATE | Origin validation tests |
| `tests/server/observability-stream.test.ts` | MODIFY | SSE security tests |

---

## 5. P4.3d — Audit Integrity, Verification, and Checkpoints

### 5.1 Hash Chain

Each audit record includes a `prevHash` field referencing the SHA-256 digest of the preceding record.

**Record interface extension:**

```typescript
type AuditIntegrity = {
  algorithm: "sha256";
  sequence: number;
  previousHash: string;   // 64 hex chars, "0" * 64 for genesis
  recordHash: string;      // sha256 of this record's canonical body
};
```

**Canonical serialization:**

```
ALIX_AUDIT_V1\n<canonical-json-body>
```

Canonical JSON enforces:
- Recursive key ordering (alphabetical by Unicode code point)
- No whitespace
- Stable number formatting
- No undefined values

**Hashing procedure:**

1. Serialize the record body (without `integrity` field) to canonical JSON
2. Prepend the domain separator `ALIX_AUDIT_V1\n`
3. Compute `SHA-256` of the full byte sequence → `recordHash`
4. Read the previous record's `recordHash` → `previousHash`
5. Construct `AuditIntegrity` object
6. Append to JSONL

### 5.2 Genesis and Migration

**Genesis record** (first record ever, or first record after chain activation):
- `previousHash = "0".repeat(64)`
- Generated atomically at init time

**Migration boundary** (first record after enabling hash chain on an existing store):

```typescript
{
  action: "audit.integrity.enabled",
  legacyRecordCount: number,   // count of pre-chain records
  legacyTailDigest: string,     // sha256 of last legacy record
}
```

All records before this boundary are reported as an "unverified legacy segment" by verification tools. No attempt is made to retrofit hashes onto old records.

### 5.3 Verification

```
alix audit verify
alix audit verify --json
alix audit checkpoint
```

**Verification algorithm:**
1. Walk records in file order
2. For each record, recompute `recordHash` from canonical body
3. Verify `recordHash` matches stored value
4. Verify `previousHash` matches previous record's `recordHash`
5. Report: verified count, unverified legacy count, failed records, gaps

**Handles:**
- Truncated final lines (incomplete JSONL line)
- Duplicate sequence numbers
- Missing records (gap detection by sequence)
- Reordered records (wrong `previousHash` from reorder attempt)
- Legacy unchained records
- Concurrent append locking (Node.js `appendFile` is atomic for writes under 4KB on most OSes)

### 5.4 Tamper-Evidence Semantics

> A local hash chain is **tamper-evident**, not tamper-proof. An attacker who can rewrite the whole audit log can recompute the chain from scratch. Tamper evidence is only as strong as the integrity of the chain head.

**Stronger optional design (for future):**
- Periodic signed checkpoint records
- Store checkpoint hash outside the active audit log (e.g., in a separate file with restricted permissions)

### 5.5 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/audit/canonical-json.ts` | CREATE | Deterministic JSON serialization |
| `src/security/audit/audit-chain.ts` | CREATE | Hash-chain logic, genesis, migration boundary |
| `src/security/audit/audit-verifier.ts` | CREATE | Walk, verify, report |
| `src/security/audit/audit-checkpoint.ts` | CREATE | Periodic signed checkpoint (optional) |
| `src/audit/audit-store.ts` | MODIFY | Wire hash chain into append, add `AuditIntegrity` |
| `src/audit/audit-types.ts` | MODIFY | Add `AuditIntegrity`, `migrationBoundary` |
| `src/cli/commands/security.ts` | MODIFY | Add `alix audit verify`, `alix audit checkpoint` |
| `tests/security/audit/*.test.ts` | CREATE | Unit and integration tests |

---

## 6. P4.3e — Config Trust, Signing, and Change Provenance

### 6.1 Signed Config Manifests

Config signing covers stable security-sensitive sections. Mutable operational state is excluded.

**Signed sections:**
- `permissions` (protected paths, deny commands, shell whitelist)
- Policy rules
- Workspace boundaries
- Tool configuration
- Provider allowlists
- Approval rules
- Security settings

**Excluded sections:**
- `apiKeys` (never in config; managed separately)
- Runtime caches, daemon PID, daemon state
- Last-used model, ephemeral session values

```typescript
type SignedConfigManifest = {
  schemaVersion: 1;
  configVersion: number;
  signedAt: string;
  signerKeyId: string;
  coveredPaths: string[];          // JSON paths covered (e.g., ["permissions", "policy"])
  contentDigest: string;           // SHA-256 of canonical serialization of covered sections
  signature: string;               // base64-encoded Ed25519 signature
};
```

### 6.2 Key Management

- Ed25519 via `crypto.generateKeyPairSync("ed25519")` + `crypto.sign` / `crypto.verify`
- Private key: never in repository, restrictive `0400` permissions, stored at `.alix/security/ed25519-private.pem`
- Public key: checked into repo as `alix-public-key.pem` with a stable key ID
- Optional later: environment variable or OS keychain source

**CLI commands:**
```
alix security keys generate     → create key pair
alix config sign               → sign current config → write manifest
alix config verify             → verify manifest + signature
alix config provenance         → show change history
```

### 6.3 Provenance Records

A valid signature proves who signed a given state; provenance explains how the state changed.

```typescript
type ConfigProvenanceRecord = {
  version: 1;
  timestamp: string;
  actor: string;
  command?: string;               // e.g., "alix config set permissions.denyCommands +rm -rf /"
  previousDigest?: string;        // SHA-256 of prior signed state
  newDigest: string;              // SHA-256 of new signed state
  changedPaths: string[];         // ["permissions.denyCommands"]
  reason?: string;
  signature?: string;             // optional Ed25519 signature
};
```

Every `alix config set`, profile application, and policy mutation writes a provenance record to `.alix/security/config-provenance.jsonl`.

### 6.4 Trust State

```typescript
type ConfigTrustState =
  | "verified"          // signature valid, matched key
  | "unsigned"          // no manifest present
  | "invalid"           // signature doesn't match
  | "unknown-key"       // key ID not recognized
  | "stale-signature";  // config changed after signing
```

**Execution behavior:**

| Mode | Unsigned | Invalid |
|------|----------|---------|
| `development` (default) | Warn | Error |
| `production` | Warn or reject (configurable) | Reject |

### 6.5 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/config/config-digest.ts` | CREATE | Canonical serialization + SHA-256 of config sections |
| `src/security/config/config-signing.ts` | CREATE | Ed25519 sign/verify, manifest creation, key management |
| `src/security/config/config-provenance.ts` | CREATE | Provenance record creation, listing, verification |
| `src/security/config/trust-policy.ts` | CREATE | Trust state evaluation, mode behavior |
| `src/config/loader.ts` | MODIFY | Wire signature verification, provenance on mutation |
| `src/cli/commands/security.ts` | MODIFY | Add `alix security keys`, `alix config sign/verify/provenance` |
| `tests/security/config/*.test.ts` | CREATE | Unit and integration tests |

---

## 7. P4.3f — Supply-Chain Policy, SBOM, and Artifact Verification

### 7.1 Current State (already complete)

- ✅ `.npmrc` with `save-exact=true` and `min-release-age=2`
- ✅ All direct dependencies pinned to exact versions
- ✅ `verify-deps.mjs` script (included in `npm run check`)
- ✅ `package-lock.json` as source of truth

### 7.2 Remaining Gaps to Fill

| Gap | Action |
|-----|--------|
| `npm audit` in CI (with policy) | Add audit step, classify by severity + production reachability |
| Lockfile freshness in CI | Fail if `package-lock.json` is out of sync with `package.json` |
| `--ignore-scripts` in CI | Add to `npm ci` in CI workflow |
| Package allowlist | Verify sensitive files are not in published artifact |
| SBOM generation | `npm sbom` or `cyclonedx-npm` |
| Artifact checksums | SHA-256 of `npm pack` output |
| Published CLI shrinkwrap | `npm-shrinkwrap.json` for `npm pack` |
| Security exceptions | Track accepted findings with owner, rationale, expiry |

### 7.3 npm audit Policy

| Severity | Production Reachable | Development Only |
|----------|---------------------|-----------------|
| Critical | Block | Report |
| High | Block (unless allowlisted with expiry) | Report |
| Medium | Report | Report (no blocking) |
| Low | Report | Report (no blocking) |

Known accepted findings require: owner, rationale, expiration date.

### 7.4 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/supply-chain/dependency-policy.ts` | CREATE | Policy types, severity classification |
| `src/security/supply-chain/package-verifier.ts` | CREATE | `npm pack` verification, allowlist checks |
| `src/security/supply-chain/security-exceptions.ts` | CREATE | Accepted-finding registry with expiry |
| `scripts/check-supply-chain.sh` | CREATE | Full CI supply-chain check script |
| `.github/workflows/publish.yml` | MODIFY or CREATE | Add audit, lockfile check, shrinkwrap |
| `tests/security/supply-chain/*.test.ts` | CREATE | Unit tests |

---

## 8. P4.3g — Threat Model, Adversarial Tests, and Security Release Gate

### 8.1 Threat Model Scope

A lightweight, actionable threat model covering the two trust boundaries:

- **Inspector boundary:** Unauthenticated access, privilege escalation, data leakage via telemetry, resource exhaustion via SSE, arbitrary origin access
- **Integrity boundary:** Undetected audit log tampering, unsigned config modification, provenance forgery
- **Supply chain:** Malicious dependency injection, untracked lockfile changes, accidental publish of sensitive files

### 8.2 Adversarial Negative Tests

Each security feature must have negative tests that actively attempt abuse:

**Authentication/Authorization:**
- Request without `Authorization` header
- Invalid token format
- Revoked token
- Expired/rotated token
- Wrong role for endpoint
- Malformed `Bearer` prefix

**Origin/SSE:**
- Disallowed `Origin` header
- Missing `Origin` on browser-like request
- Connection flood (50+ simultaneous connections)
- Rate-limit bypass attempt (rapid bursts)
- Slow SSE client (write buffer fills)
- Empty `Last-Event-ID`

**Redaction:**
- Secret in telemetry `payload` at top level
- Secret nested 5 levels deep
- Secret in array elements
- High-entropy string that is not a secret (false positive test)
- Object with cycle reference

**Audit chain:**
- Deleted audit record (gap)
- Reordered records (wrong `previousHash`)
- Modified record body (mismatched `recordHash`)
- Truncated final line
- Legacy record in mixed chain
- Duplicate sequence numbers

**Config signing:**
- Modified config after signing
- Unknown signing key
- Expired signature
- Corrupted manifest
- Unsigned config in production mode

### 8.3 Security Release Gate

```
npm run test:security   → runs all security unit + integration + adversarial tests
alix security doctor    → checks all P4.3 subsystems are operational
alix security gate      → exit 0/1 summary for CI
```

The gate:
1. Checks all security middleware is active in the Inspector
2. Verifies rate limiter is initialized
3. Confirms audit hash chain is operational
4. Verifies config signing status (warn/error per mode)
5. Runs supply-chain verification
6. Runs adversarial test suite
7. Emits machine-readable JSON report
8. Fails closed on internal checker errors (checker crash → gate fail)

### 8.4 Files

| File | Action | Purpose |
|------|--------|---------|
| `src/security/acceptance/security-gate.ts` | CREATE | Gate orchestrator, check registry |
| `src/security/acceptance/security-report.ts` | CREATE | Machine-readable report format |
| `tests/security/acceptance/adversarial-auth.test.ts` | CREATE | Auth abuse tests |
| `tests/security/acceptance/adversarial-redaction.test.ts` | CREATE | Redaction edge cases |
| `tests/security/acceptance/adversarial-audit.test.ts` | CREATE | Audit chain integrity tests |
| `tests/security/acceptance/adversarial-rate-limit.test.ts` | CREATE | Rate-limit abuse tests |
| `tests/security/acceptance/security-gate.test.ts` | CREATE | Gate self-test |
| `scripts/release-gate.sh` | MODIFY | Add security gate step |
| `src/server/security-middleware.ts` | MODIFY | Add active-check endpoint |

---

## 9. Module Layout

```
src/security/
  redaction/
    redactor.ts               ← SecurityRedactor with safeguards
    classifications.ts        ← Classifications enum
    redaction-policy.ts       ← Allowlists, key-name rules, depth config

  inspector/
    auth-service.ts           ← Token generation, verification, rotation, revocation
    authorization.ts           ← Role/permission mapping
    origin-policy.ts          ← Origin allowlist, validation
    rate-limiter.ts           ← Token-bucket rate limiter with eviction
    connection-limiter.ts     ← Connection tracking, limits, cleanup
    security-context.ts       ← InspectorSecurityContext types

  audit/
    canonical-json.ts         ← Deterministic JSON serialization
    audit-chain.ts            ← Hash-chain logic, genesis, migration boundary
    audit-verifier.ts         ← Walk, verify, report
    audit-checkpoint.ts       ← Periodic signed checkpoint (optional)

  config/
    config-digest.ts          ← Canonical serialization + SHA-256 of config sections
    config-signing.ts         ← Ed25519 sign/verify, manifest creation, key management
    config-provenance.ts      ← Provenance record creation, listing, verification
    trust-policy.ts           ← Trust state evaluation, mode behavior

  supply-chain/
    dependency-policy.ts      ← Policy types, severity classification
    package-verifier.ts       ← npm pack verification, allowlist checks
    security-exceptions.ts    ← Accepted-finding registry with expiry

  acceptance/
    security-gate.ts          ← Gate orchestrator, check registry
    security-report.ts        ← Machine-readable report format

src/server/
  security-middleware.ts      ← Middleware pipeline integration

src/cli/commands/
  security.ts                ← alix security * CLI commands

src/audit/
  audit-store.ts             ← MODIFY: wire hash chain
  audit-types.ts             ← MODIFY: add integrity types

src/config/
  loader.ts                  ← MODIFY: wire signature verification, provenance

src/observability/
  telemetry-envelope.ts      ← MODIFY: wire ingress redaction
  observability-routes.ts    ← MODIFY: add security audit events

src/server/
  server.ts                  ← MODIFY: wire middleware pipeline
  observability-stream.ts    ← MODIFY: add connection controls, payload redaction
  coordination-routes.ts     ← MODIFY: add security audit events
```

---

## 10. Execution Plan

### Stream A — Inspector Boundary
```
P4.3a → P4.3b → P4.3c
```

### Stream B — Integrity Boundary (parallel)
```
P4.3d → P4.3e
```

### Final (after A + B)
```
P4.3f → P4.3g
```

### Milestone Sequence Summary

| # | Milestone | Stream | Approx. Modules | New Tests |
|---|-----------|--------|-----------------|-----------|
| P4.3a | Redaction | A | 4 create, 2 modify | 3+ test files |
| P4.3b | Authentication & Authorization | A | 3 create, 2 modify | 3+ test files |
| P4.3c | Origin, Rate, SSE Controls | A | 4 create, 3 modify | 3+ test files |
| P4.3d | Audit Integrity | B | 4 create, 2 modify | 3+ test files |
| P4.3e | Config Signing & Provenance | B | 4 create, 2 modify | 3+ test files |
| P4.3f | Supply Chain | Final | 3 create, 1 modify | 2+ test files |
| P4.3g | Security Gate & Adversarial Tests | Final | 2 create, 1 modify | 5+ test files |

Total: ~24 new modules, ~13 modified files, ~22+ test files.

---

## 11. Key Design Rules (from Architecture Review)

1. **Authentication is not authorization.** Token validation proves identity; role/permission mapping proves authorization. These are separate concerns.
2. **Origin is not authentication.** `Origin` headers can be spoofed. Only trust `Origin` for CORS decisions, never for identity.
3. **Redaction occurs at both ingress and egress.** Before persistence and before exposure — never just one.
4. **Audit chains use canonical serialization.** `JSON.stringify()` is not deterministic across engines. Use recursive key-sorted canonical JSON.
5. **Hash chains are described as tamper-evident, not tamper-proof.** A local attacker who can rewrite the log can recompute the chain. Checkpoints anchored outside the log strengthen this.
6. **Config signatures cover stable security-sensitive sections.** Runtime state (API keys, daemon PID) is excluded.
7. **Legacy data gets an explicit trust boundary.** Old unchained audit records are reported as "unverified legacy segment" — never retrofitted.
8. **Rate-limit state is bounded.** Maximum 10,000 buckets with idle eviction. No unbounded IP-key growth.
9. **SSE has connection and slow-client controls.** Max connections, bounded write queue, lifetime limit, slow-client disconnect.
10. **Security gates include adversarial negative tests.** Not just "does auth exist" but "what happens with a revoked token".
