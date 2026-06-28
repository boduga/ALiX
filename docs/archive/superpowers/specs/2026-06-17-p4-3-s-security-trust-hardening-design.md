# P4.3-S — ALiX Security and Trust Hardening

**Date:** 2026-06-17  
**Status:** Revised architecture and implementation blueprint  
**Repository reviewed:** `boduga/ALiX`  
**Repository head reviewed:** `f0ab074620dba936617702946cbe8a224b0fcc5f`  
**P4.2 baseline:** `8367775b9b3c4be70a858333a1402faa1ad13147` (`p4.2-observability-baseline`)  
**Supersedes:** Draft "P4.3 — Security and Trust Hardening Design"  
**Recommended track name:** `P4.3-S` until the production roadmap is renumbered

---

## 1. Executive Decision

The draft has a sound overall direction—dual trust boundaries, defense-in-depth redaction, Inspector authentication, audit integrity, config trust, supply-chain controls, and adversarial acceptance testing—but it is **not yet implementation-ready against the current ALiX repository**.

The revised design makes the following architectural decisions:

1. **Keep the Inspector read-only in P4.3-S.**  
   The repository's runtime architecture explicitly defines the Inspector as read-only and CLI-first for approvals and recovery. `approvals:write` and `recovery:repair` are removed from this milestone. Any future web mutation surface requires a separate design covering CSRF, replay protection, idempotency, approval binding, and stronger browser-session controls.

2. **Change the Inspector default binding immediately from `0.0.0.0` to loopback.**  
   The current default is remotely reachable while the server has no authentication. This is the highest-priority correction.

3. **Use Bearer tokens for API clients and an HttpOnly session cookie for the browser UI.**  
   Native browser `EventSource` cannot reliably attach an `Authorization` header. A Bearer-only design would break the existing browser SSE architecture or encourage unsafe query-string tokens.

4. **Store Inspector credentials outside the project workspace.**  
   Project-local `.alix/inspector-token` is not an appropriate secret location. Authentication state belongs in a user-scoped state/runtime directory with restrictive permissions and workspace scoping.

5. **Replace ad hoc route dispatch with a default-deny route security registry.**  
   The current server has a monolithic route chain plus separate coordination and observability routers. Authentication and authorization cannot be applied reliably until every API route has an explicit security descriptor.

6. **Use explicit secure response gateways rather than monkey-patching `ServerResponse`.**  
   JSON and SSE payloads must pass through `sendSecureJson()` and `SecureSseConnection.send()` so redaction is deterministic. Generic interception of `res.write()`/`res.end()` is brittle and unsafe for streaming.

7. **Use a shared SSE producer/hub.**  
   The current observability stream recomputes health, alerts, recent metrics, and anomalies every two seconds for every connected client. Connection limits alone do not stop this amplification. One producer must fan out bounded, redacted events to all clients.

8. **Bind audit chain links into the record hash and serialize writers across processes.**  
   A hash of only the record body is insufficient. `sequence` and `previousHash` must be part of the digest. Multi-process appends require an explicit lock/coordinator; sub-4KB append assumptions are not a correctness guarantee.

9. **Centralize all configuration writes before adding signatures and provenance.**  
   The current CLI writes config from multiple code paths. Modifying only `src/config/loader.ts` cannot guarantee provenance or signature invalidation.

10. **Remove plaintext API keys from project configuration through a migration path.**  
    The current schema and CLI permit `apiKeys` in config, including project config. The draft's assertion that API keys are never in config does not match the repository and must become an implemented migration, not an assumption.

11. **Treat the uploaded Python metrics catalog as legacy documentation.**  
    The current repository is TypeScript/Node and uses `MinimalMetrics`, `TelemetryEnvelope`, append-only JSONL `MetricsStore`, health snapshots, trends, alerts, cost attribution, REST, and SSE. Security metrics must extend this system rather than introduce a second Python/SQLite monitoring stack.

12. **Pack once, verify once, publish the exact verified tarball.**  
    The current release gate verifies one `npm pack` artifact and then `npm publish` repacks the working tree. The revised supply-chain flow publishes the exact tarball whose contents, checksum, and SBOM were verified.

---

## 2. Naming and Roadmap Reconciliation

The repository's existing production roadmap already assigns **P4.3** to "CLI, TUI, and Inspector UX." The security draft also calls itself P4.3.

Until the roadmap is formally renumbered, use:

```text
P4.3-S — Security and Trust Hardening
P4.3-UX — CLI, TUI, and Inspector UX
```

Recommended eventual sequence:

```text
P4.2   Observability and operational readiness
P4.3   Security and trust hardening
P4.4   CLI, TUI, and Inspector UX
P4.5   Adoption and reference applications
P4.6   Kernel extraction readiness
```

The security boundary should land before expanding the Inspector UX or adding any remote/operator-grade functionality.

---

## 3. Repository Reality Check

### 3.1 Current implementation relevant to P4.3-S

| Area | Current repository state | Security implication |
|---|---|---|
| Runtime | Node 24+, TypeScript, ESM | The Python metrics document is not the implementation baseline |
| Inspector server | `src/server/server.ts`, raw Node HTTP server | No central middleware or route metadata |
| Default binding | `ui.host: "0.0.0.0"` | Remotely reachable by default |
| Inspector auth | None | All API and SSE routes are unauthenticated |
| Inspector invariant | Read-only, CLI-first mutations | Draft write permissions conflict with architecture |
| Main routing | Long `if` chain in `server.ts` | Permission coverage is easy to miss |
| Coordination routes | `registerCoordinationRoutes()` receives no request/security context | Must be refactored for auth, origin, rate, audit |
| Observability routes | `src/observability/observability-routes.ts` | Draft references the wrong directory |
| Session SSE | Repeated whole-file reads and string splitting | Memory/I/O amplification and no backpressure |
| Observability SSE | Per-client health/alert/metric/anomaly computation every 2s | Client-count multiplies expensive work |
| Telemetry | `TelemetryEnvelope` + interface-only `TelemetrySink` | No concrete sink exists to "wire" redaction into |
| Metrics | JSONL `MetricsStore` and M0.9 `MinimalMetrics` | Security metrics should use current stores |
| Metric vocabulary | Store accepts any non-empty name | Closed metric vocabulary is not enforced |
| Audit | Append-only JSONL, no sequence/hash/lock | Integrity and concurrency work is required |
| Audit reads | Whole-file `readFile()` and silent malformed-line skip | Verification and large-log behavior are inadequate |
| Config | User + project JSON merged; API keys injected into env | Secrets can exist in project config |
| Config writes | Multiple direct `writeFile()` paths in `src/cli.ts` and commands | Signing/provenance cannot be complete without central writer |
| Secret scanning | Regex scanner returns sanitized value but raw matching line as `context` | Scanner output itself can leak a secret |
| CI | Typecheck, tests, soak, doctor, release gate | Good base, but no dedicated security lane |
| Publish | npm provenance enabled | Retain it |
| Artifact verification | Release gate packs and tests a tarball, then deletes it | Published package is not necessarily the verified tarball |
| GitHub Actions | Actions referenced by moving major tags | Workflow dependencies are not immutable |

### 3.2 Immediate contradictions to resolve

#### Contradiction A — Inspector host

The README presents the Inspector as local at `127.0.0.1:4137`, while the default config binds to `0.0.0.0`.

**Resolution:** change the default to `127.0.0.1`; document remote access as an explicit, TLS-protected opt-in.

#### Contradiction B — Inspector mutability

The runtime spine says:

- Inspector is read-only
- CLI-first for approval, audit, and daemon actions

The draft adds:

- `approvals:write`
- `recovery:repair`

**Resolution:** remove web mutations from P4.3-S. Keep only read permissions. Design mutations separately.

#### Contradiction C — API keys

The draft says API keys are never in config. Current code:

- Defines `apiKeys?: Record<string, string>` in `AlixConfig`
- Reads keys from user and project config
- Writes keys to user config
- Can write MCP credentials to project config

**Resolution:** add a credential migration milestone and backwards-compatible deprecation period.

#### Contradiction D — Token rotation

The draft proposes one raw token file plus metadata-only multi-token rotation. Once the raw token is overwritten, the old token cannot remain valid during a grace period unless its verifier is retained.

**Resolution:** store only token hashes and metadata in a multi-record user-scoped auth store. Display raw tokens once.

---

## 4. Gap Analysis

### 4.1 Critical gaps

| ID | Gap | Why it matters | Required correction |
|---|---|---|---|
| C-01 | Unauthenticated server binds to `0.0.0.0` by default | Any reachable host can read sessions, audit, daemon tasks, policy, metrics, and coordination data | Loopback default in P4.3-S0 |
| C-02 | Bearer-only browser auth is incompatible with native SSE | Browser UI cannot attach a custom auth header to native `EventSource` | Token-to-session exchange and HttpOnly cookie |
| C-03 | Project-local raw Inspector token | Workspace may be shared, committed, copied, or symlinked | User-scoped hashed auth store |
| C-04 | Permission vocabulary does not cover current routes | Unmapped routes can bypass intent of RBAC | Complete route-to-permission registry, default deny |
| C-05 | Draft introduces web mutations against read-only invariant | Expands threat surface without CSRF/idempotency design | Defer all state-changing Inspector endpoints |
| C-06 | Current SSE performs expensive work per client | Small connection floods multiply disk scans and anomaly analysis | Shared stream hub and bounded fan-out |
| C-07 | Audit writers are not serialized | Concurrent CLI/daemon processes can fork or corrupt the chain | Cross-process append coordinator |
| C-08 | API keys may be stored in project config | Secrets can be committed or exposed through config/Inspector | Credential store + migration + config redaction |
| C-09 | Config writes are decentralized | Provenance and signature state can be bypassed | `ConfigMutationService` for every write path |
| C-10 | Pack verification and publication use different artifacts | A different package can be published than the one tested | Publish exact verified tarball |

### 4.2 High gaps

| ID | Gap | Correction |
|---|---|---|
| H-01 | `recordHash` does not bind `sequence` and `previousHash` | Include both in the hash preimage |
| H-02 | "append under 4KB is atomic" is not a portable guarantee | Remove assumption; lock and verify every append |
| H-03 | `coveredPaths` can become an attacker-controlled omission mechanism | Define required signed paths in code; reject incomplete coverage |
| H-04 | Signature verification can suffer TOCTOU if config is reread | Verify and use the same parsed bytes/projection |
| H-05 | Valid old signed config can be replayed | Add monotonic config version and last-accepted version tracking |
| H-06 | Origin validation does not prevent DNS rebinding | Validate `Host`, bind address, scheme, and allowed origins |
| H-07 | Boolean `trustedProxy=true` is too broad | Require explicit trusted proxy CIDRs |
| H-08 | Non-loopback Bearer auth over HTTP leaks tokens | Require TLS or a trusted TLS-terminating proxy |
| H-09 | Current secret scanner exposes raw matching line in `context` | Add span/classification API with no raw context |
| H-10 | Redaction scope ignores dimensions, labels, errors, URLs, headers, and config | Redact complete response/event structures |
| H-11 | Middleware-only response interception is unsafe for SSE | Explicit secure JSON and SSE responder APIs |
| H-12 | Error handlers return internal error messages to clients | Stable external error codes; detailed logs remain local |
| H-13 | Metric labels have a key-count limit but not bounded value vocabularies | Closed registry and label-value policy |
| H-14 | GitHub Actions use mutable major tags | Pin action commits and automate updates |

### 4.3 Medium gaps

| ID | Gap | Correction |
|---|---|---|
| M-01 | `/healthz` policy is unspecified | Keep public but return only `OK`; no runtime details |
| M-02 | Route limits are only post-auth | Add pre-auth IP limits and post-auth principal limits |
| M-03 | `Last-Event-ID` validation is vague | Define numeric/range/epoch rules and bounded replay |
| M-04 | Security audit can recurse into itself | Add non-recursive security event writer policy |
| M-05 | Signed checkpoint beside the log is not a true external anchor | Describe it honestly; support explicit exported anchor |
| M-06 | `npm audit` "production reachability" is underspecified | Use production dependency audit separately from full audit |
| M-07 | Blanket `npm ci --ignore-scripts` may break native packages | Inventory and allowlist lifecycle scripts |
| M-08 | Security gate includes an "active-check endpoint" | Use internal registry/doctor, not a public endpoint |
| M-09 | Threat model omits malicious projects, plugins, MCP output, symlinks, and localhost attacks | Expand threat model |
| M-10 | Existing metrics document describes unsupported components | Archive as legacy and publish current metrics catalog |

---

## 5. Revised Trust Model

### 5.1 Trust boundaries

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Boundary 1 — Inspector HTTP/browser boundary                        │
│                                                                     │
│ Browser / curl / SDK                                                │
│   → Host + scheme validation                                        │
│   → pre-auth rate/connection limit                                  │
│   → authentication                                                  │
│   → authorization                                                   │
│   → route-specific limit                                            │
│   → read-only handler                                               │
│   → explicit redacting response gateway                             │
│   → security audit + bounded security metrics                       │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Boundary 2 — Durable integrity boundary                             │
│                                                                     │
│ Config mutation → provenance → canonical digest → signature/trust   │
│ Audit append → lock → canonical hash chain → head → checkpoint      │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Boundary 3 — Build and publish boundary                             │
│                                                                     │
│ Locked deps → lifecycle policy → tests → pack once → inspect → SBOM │
│ → checksum → publish same tarball with npm provenance               │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 Threat actors

- Remote unauthenticated client
- Authenticated viewer attempting privilege escalation
- Malicious webpage targeting a localhost Inspector
- DNS rebinding attacker
- Untrusted reverse proxy headers
- Malicious or compromised project workspace
- Malicious tool/MCP/plugin output entering telemetry or UI
- Concurrent local ALiX processes
- Dependency or CI workflow compromise
- Local non-privileged user on a shared host
- Accidental operator/configuration error

### 5.3 Explicit limits

P4.3-S does **not** claim protection against:

- A root/administrator attacker controlling the OS
- A user who can replace the ALiX binary and all trust keys
- Full confidentiality of canonical raw session logs
- A fully compromised npm/GitHub identity after all trusted signing credentials are stolen

It provides:

- Access control
- Secret-safe external observability
- Bounded resource use
- Tamper evidence
- Change provenance
- Supply-chain verification
- Actionable detection and release gating

---

## 6. Revised Inspector Security Architecture

### 6.1 Route security registry

Every server route must have a descriptor before it can run.

```typescript
type InspectorAuthMode = "public" | "required";

type InspectorPermission =
  | "ui:read"
  | "health:read"
  | "metrics:read"
  | "graphs:read"
  | "registry:read"
  | "sessions:read"
  | "events:read"
  | "coordination:read"
  | "approvals:read"
  | "audit:read"
  | "policy:read"
  | "daemon:read"
  | "recovery:read"
  | "config:read"
  | "security:read";

type RouteClass =
  | "public-health"
  | "auth"
  | "standard-read"
  | "events-read"
  | "expensive-read"
  | "sse";

type RedactionProfile =
  | "none"
  | "public"
  | "operational"
  | "administrative";

type RouteSecurityDescriptor = {
  id: string;
  method: "GET" | "POST";
  pattern: RegExp;
  auth: InspectorAuthMode;
  permission?: InspectorPermission;
  routeClass: RouteClass;
  redaction: RedactionProfile;
  streaming?: boolean;
};
```

Rules:

- Unknown `/api/*` routes are denied by default.
- Public routes are explicitly enumerated.
- Static UI assets may be public because they contain no workspace data.
- `/healthz` remains public and returns only `OK`.
- Authentication endpoints are public but strictly rate-limited and same-origin.
- All data-bearing API and SSE routes require authentication.
- No P4.3-S route mutates ALiX runtime state.

### 6.2 Role mapping

```typescript
type InspectorRole = "viewer" | "operator" | "admin";
```

| Role | Permissions |
|---|---|
| `viewer` | ui:read, health:read, metrics:read, graphs:read, registry:read |
| `operator` | viewer + sessions:read, events:read, coordination:read, approvals:read, audit:read, daemon:read, recovery:read |
| `admin` | operator + policy:read, config:read, security:read |

No role receives unredacted secrets.

### 6.3 Current route mapping

| Route | Permission | Class | Notes |
|---|---|---|---|
| `/healthz` | public | public-health | Text `OK` only |
| `/`, `/app.js`, `/projection.js`, `/styles.css` | public | standard-read | Security headers; no data |
| `/api/auth/session` | public | auth | Bearer-token exchange, POST |
| `/api/auth/logout` | authenticated | auth | Ends browser session only |
| `/api/graphs` | graphs:read | standard-read | Summary redaction |
| `/api/graphs/:id/projection` | graphs:read | expensive-read | Validate ID and output |
| `/api/registry/agents` | registry:read | standard-read | Redact config/credentials |
| `/api/registry/tools` | registry:read | standard-read | Redact headers/env |
| `/api/policy/rules` | policy:read | standard-read | Admin only |
| `/api/policy/eval` | policy:read | standard-read | Query validation |
| `/api/daemon/status` | daemon:read | standard-read | No environment leakage |
| `/api/daemon/tasks` | daemon:read | standard-read | Redact task content |
| `/api/approvals` | approvals:read | standard-read | Read-only |
| `/api/runtime/events` | events:read | events-read | Redacted and bounded |
| `/api/audit` | audit:read | events-read | Redacted, integrity metadata allowed |
| `/api/sessions/compare` | sessions:read | expensive-read | Bounded input and output |
| `/api/sessions/:id/snapshot` | sessions:read | expensive-read | Redacted |
| `/api/sessions/:id/events` | events:read | sse | Shared/bounded session stream |
| `/api/observability/health` | health:read | standard-read | Side-effect-free |
| `/api/observability/metrics` | metrics:read | events-read | Bounded query |
| `/api/observability/alerts` | metrics:read | standard-read | Side-effect-free |
| `/api/observability/stream` | metrics:read | sse | Shared observability hub |
| `/api/coordination/**` | coordination:read | standard/expensive | Refactored async route context |
| `/api/security/status` | security:read | standard-read | Passive status only |

### 6.4 Security context

```typescript
type InspectorPrincipal = {
  id: string;                    // opaque token/session principal ID
  role: InspectorRole;
  authentication: "bearer-token" | "browser-session";
  workspaceId: string;
};

type InspectorSecurityContext = {
  requestId: string;
  clientAddress?: string;
  origin?: string;
  principal?: InspectorPrincipal;
  permissions: ReadonlySet<InspectorPermission>;
  route: RouteSecurityDescriptor;
  startedAtMs: number;
};
```

Route handlers receive a single context object:

```typescript
type InspectorRouteContext = {
  root: string;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  security: InspectorSecurityContext;
  json: SecureJsonResponder;
  stream?: SecureSseConnection;
};
```

No route reads tokens, roles, proxy headers, or origins independently.

### 6.5 Request pipeline

```text
1. Resolve route descriptor; reject unknown API route
2. Assign request ID; apply response security headers
3. Validate method, URL length, Host, scheme, and basic headers
4. Apply pre-auth IP/connection limit
5. Validate Origin / Fetch Metadata where applicable
6. Authenticate Bearer token or browser session
7. Resolve role and enforce route permission
8. Apply post-auth principal + route-class limit
9. Execute read-only handler
10. Serialize through secure JSON or secure SSE responder
11. Emit non-recursive security audit event and bounded metrics
12. Normalize client-facing errors
```

The original order is changed deliberately:

- Host/origin and pre-auth abuse controls happen before expensive token work.
- Redaction is not a generic `res.end()` interception.
- Audit/metrics run from a `finally` path and never include raw credentials.

---

## 7. Authentication and Browser Sessions

### 7.1 Token format

```text
alix_i_<token-id>_<32-byte-base64url-secret>
```

Properties:

- 256-bit random secret from `crypto.randomBytes(32)`
- Opaque, non-sequential token ID
- Raw token displayed once
- SHA-256 verifier stored; raw token is never persisted
- Constant-time comparison of fixed-length digests
- Optional expiration
- Workspace scope
- Role attached to token record

### 7.2 User-scoped auth store

Do not store Inspector secrets under the project `.alix/` directory.

Recommended paths:

```text
Linux:
  ${XDG_STATE_HOME:-~/.local/state}/alix/inspector/auth.json

macOS:
  ~/Library/Application Support/ALiX/inspector/auth.json

Windows:
  %LOCALAPPDATA%\ALiX\inspector\auth.json
```

Directory permissions:

- Unix directory: `0700`
- Unix auth file: `0600`
- Atomic temp-write + rename
- Windows ACL restriction: best effort, verified by `alix security doctor`

```typescript
type InspectorTokenRecord = {
  schemaVersion: 1;
  tokenId: string;
  name: string;
  tokenHash: string;
  role: InspectorRole;
  workspaceIds: string[];
  createdAt: string;
  expiresAt?: string;
  rotatedFrom?: string;
  graceUntil?: string;
  revokedAt?: string;
};
```

### 7.3 Rotation

Rotation creates a new token record and retains the old hash until `graceUntil`.

```text
alix inspector auth create --name laptop --role admin
alix inspector auth list
alix inspector auth rotate <token-id> --grace 10m
alix inspector auth revoke <token-id>
alix inspector auth doctor
```

`list` and `doctor` show token IDs and metadata, never raw tokens or token hashes.

### 7.4 Browser login

Native `EventSource` uses cookies automatically but does not support a custom Bearer header in the standard API.

Flow:

```text
1. User opens Inspector.
2. UI presents local login form.
3. POST /api/auth/session with Inspector token.
4. Server validates token and creates an in-memory opaque session.
5. Server sets:
   HttpOnly
   SameSite=Strict
   Path=/
   Secure when HTTPS
   short configurable lifetime
6. REST and SSE use the session cookie.
7. Server restart invalidates browser sessions; user token remains valid.
```

Bearer auth remains available for curl and SDK clients.

Do not place tokens in:

- Query strings
- URL fragments that are later logged
- Local storage
- Session storage
- SSE event data
- Telemetry
- Audit details

### 7.5 Remote access policy

Default:

```json
{
  "ui": {
    "host": "127.0.0.1",
    "port": 4137,
    "transport": "sse",
    "security": {
      "authentication": "required",
      "remoteAccess": false,
      "allowedOrigins": [],
      "trustedProxyCidrs": []
    }
  }
}
```

Non-loopback binding requires:

- `remoteAccess: true`
- TLS provided natively or by a trusted reverse proxy
- Explicit allowed origins
- Explicit Host allowlist
- Explicit trusted proxy CIDRs
- Secure cookies
- Rejection of cleartext remote Bearer authentication

A boolean "trust all proxies" switch is not supported.

---

## 8. Host, Origin, CORS, and Browser Hardening

### 8.1 Host validation

Validate `Host` before routing.

Allowed by default:

- `localhost:<configured-port>`
- `127.0.0.1:<configured-port>`
- `[::1]:<configured-port>`

Remote deployments add exact hostnames.

This mitigates DNS rebinding and accidental proxy exposure.

### 8.2 Origin policy

- Same-origin browser requests are accepted.
- Configured exact origins may be accepted for deliberate deployments.
- Wildcard origins are forbidden with credentials.
- Bearer API clients may omit `Origin`.
- Cookie-authenticated browser requests must pass same-origin checks.
- `Origin` is never used as identity.

### 8.3 Response headers

Apply where compatible:

```text
Content-Security-Policy
  default-src 'self';
  connect-src 'self';
  img-src 'self' data:;
  style-src 'self';
  script-src 'self';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none'

X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
Cross-Origin-Resource-Policy: same-origin
Cache-Control: no-store                 # API responses
```

If the current UI uses inline script/style, remove it or use a nonce. Do not weaken CSP globally with `unsafe-inline`.

### 8.4 Server timeouts and parser bounds

Configure Node HTTP server limits:

- Maximum header size
- Header timeout
- Request timeout
- Keep-alive timeout
- Maximum requests per socket
- Maximum URL length
- Maximum request body for auth exchange
- Reject bodies on GET routes

---

## 9. Rate and Connection Limiting

### 9.1 Two-stage limiting

**Stage 1 — pre-auth**

Key:

```text
normalized-client-address + route-class
```

Purpose:

- Protect token verification and session endpoints
- Limit unauthenticated connection floods
- Bound unknown key growth

**Stage 2 — post-auth**

Key:

```text
principal-id + normalized-client-address + route-class
```

Purpose:

- Fair use across authenticated principals
- Route-specific abuse control

### 9.2 Bounded token buckets

Requirements:

- `performance.now()` monotonic refill clock
- Hard bucket cap
- Idle eviction
- LRU/oldest-idle eviction when cap reached
- Bounded key length
- Normalized IPv4/IPv6 addresses
- No untrusted `X-Forwarded-For`
- `Retry-After` on 429
- Rate-limit response headers
- Fake-clock tests

Suggested local-first defaults:

| Class | Refill | Burst |
|---|---:|---:|
| public-health | 10/s | 20 |
| auth | 5/min | 10 |
| standard-read | 20/s | 40 |
| events-read | 5/s | 10 |
| expensive-read | 2/s | 4 |
| SSE connect | 6/min | 6 |

### 9.3 SSE connection limits

Suggested defaults:

| Limit | Default |
|---|---:|
| Global connections | 25 |
| Per principal | 3 |
| Per address | 3 |
| Buffered events | 100 |
| Buffered bytes | 1 MiB |
| Backpressure timeout | 10 s |
| Heartbeat | 30 s |
| Maximum lifetime | 24 h |
| Replay ring | 256 events |

---

## 10. SSE Refactor

### 10.1 Current problem

The current observability stream creates, per client:

- A new health snapshot service
- A new alert engine
- A new metrics scan
- A new trend analyzer/anomaly scan
- A two-second timer

This is an amplification path.

The session event stream also rereads the whole event file to determine size and new content.

### 10.2 Shared observability hub

```typescript
class ObservabilityStreamHub {
  start(): void;
  stop(): Promise<void>;
  subscribe(client: SecureSseConnection): Unsubscribe;
  publish(event: RedactedSseEvent): void;
}
```

Properties:

- One producer loop per Inspector instance
- One health/alert/metric/anomaly computation cycle
- Redact once before entering replay ring
- Fan out immutable redacted events
- Bounded replay ring
- Monotonic stream event IDs
- No client-specific expensive computation
- Reference-counted lifecycle or explicit server lifecycle
- Cleanup verified during server close

### 10.3 Shared session stream

Replace whole-file polling with:

- Bounded incremental reads from last byte offset
- `createReadStream({ start })` or controlled file-handle reads
- Partial-line carry buffer with maximum size
- One watcher/tailer per session, shared among subscribers
- Session ID validation before path construction
- Redaction before broadcast
- File rotation/truncation detection
- Backpressure-aware writes

### 10.4 Backpressure

`res.write()` returning `false` means the client is slow.

Policy:

1. Stop sending additional events to that client.
2. Wait for `drain`.
3. Disconnect if not drained within the configured timeout.
4. Record only bounded reason/category metrics.
5. Remove every timer/listener in one idempotent cleanup function.

### 10.5 `Last-Event-ID`

For observability stream:

```text
<server-epoch>:<sequence>
```

- Unknown epoch: reconnect without replay.
- Sequence below replay floor: send `replay.reset`.
- Sequence above current head: reject as invalid.
- Malformed/empty ID: treat as no cursor.

For session streams, validate a non-negative integer and cap it at the current known sequence.

---

## 11. Redaction Architecture

### 11.1 Scope

Redaction applies to:

- Inspector JSON responses
- Inspector SSE events
- Audit details before persistence and hashing
- Security telemetry payloads
- Metric labels/dimensions
- Config display
- Observability export
- Support bundles
- Client-facing errors
- URLs, headers, cookies, MCP config, and environment-like structures

Canonical raw session event logs are not rewritten in P4.3-S because replay fidelity is an existing invariant. They must be:

- Stored under restrictive directory/file permissions
- Never exposed through Inspector without egress redaction
- Classified as sensitive local artifacts

Encryption or secret-elision for canonical event logs is a separate milestone.

### 11.2 Detector and redactor separation

The existing `SecretScanner` should not be reused unchanged because its findings include the raw source line in `context`.

Introduce:

```typescript
interface SecretDetector {
  classifyString(
    value: string,
    context: DetectionContext,
  ): SecretSpan[];
}

type SecretSpan = {
  start: number;
  end: number;
  classification: RedactionClassification;
  confidence: "high" | "medium" | "low";
};
```

No raw matching context is returned.

```typescript
interface SecurityRedactor {
  redactValue(
    value: unknown,
    context: RedactionContext,
  ): RedactionResult;
}
```

### 11.3 Classifications

```typescript
type RedactionClassification =
  | "api_key"
  | "bearer_token"
  | "basic_auth"
  | "private_key"
  | "password"
  | "cookie"
  | "authorization_header"
  | "credential_url"
  | "environment_secret"
  | "jwt"
  | "limit";
```

High-entropy detection is **not enabled by default**. It produces too many false positives. It may be enabled only in strict export/support-bundle profiles with tests and allowlists.

### 11.4 Safeguards

- No mutation of source objects
- Cycle protection with `WeakSet`
- Maximum depth
- Maximum property count
- Maximum array length
- Maximum string scan length
- Maximum total output bytes
- Exact normalized sensitive key names, not a broad substring such as `key`
- Explicit patterns always override allowlists
- Getter/proxy exceptions caught
- Symbols/functions represented safely
- No secret hash emitted to users
- Stable redaction markers
- Redaction itself cannot throw through an HTTP response path

### 11.5 Key-name policy

Prefer normalized exact/suffix sets:

```text
authorization
proxy-authorization
cookie
set-cookie
password
passwd
api_key
apikey
access_token
refresh_token
client_secret
private_key
secret_access_key
```

Do not redact arbitrary keys containing `key`, which would match benign names such as `keyboardLayout` or `monkeyPatch`.

### 11.6 Redaction gateways

```typescript
sendSecureJson(ctx, value, profile)
secureSse.send(eventName, value, profile)
redactingAuditStore.append(record)
redactingTelemetrySink.append(envelope)
sanitizeConfigForDisplay(config)
```

Do not rely on a single final middleware hook for all output types.

---

## 12. Audit Integrity

### 12.1 Record schema

```typescript
type AuditIntegrity = {
  algorithm: "sha256";
  sequence: number;
  previousHash: string;
  recordHash: string;
};

type AuditRecordV2 = {
  version: 2;
  id: string;
  action: AuditAction;
  timestamp: string;
  actor?: string;
  details: AuditDetails;
  integrity: AuditIntegrity;
};
```

### 12.2 Hash construction

```text
recordHash =
  SHA256(
    "ALIX_AUDIT_V2\0" +
    decimal(sequence) + "\0" +
    previousHash + "\0" +
    canonicalJson(recordBodyWithoutIntegrity)
  )
```

This binds:

- Record body
- Sequence
- Previous link
- Domain/version

Genesis:

```text
sequence = 1
previousHash = 64 zeroes
```

### 12.3 Canonical JSON

Implement one documented ALiX canonical format with test vectors:

- Recursive deterministic key ordering
- UTF-8 encoding
- No whitespace
- Reject `undefined`, functions, symbols, non-finite numbers
- Arrays retain order
- Defined string escaping
- Stable number formatting
- No locale-dependent behavior

Do not state that ordinary `JSON.stringify()` is canonical.

### 12.4 Multi-process append coordinator

```typescript
class AuditChainWriter {
  append(input: AuditAppendInput): Promise<AuditRecordV2>;
}
```

Append transaction:

1. Acquire exclusive audit lock with bounded retry.
2. Validate or recover the cached head against the log tail.
3. Assign sequence and previous hash.
4. Redact audit details.
5. Canonicalize and hash.
6. Append one complete line through a file handle.
7. Flush according to durability policy.
8. Atomically update `head.json`.
9. Release lock in `finally`.

Lock file contains PID, host, created time, and nonce. Stale lock recovery is explicit and audited.

`head.json` is an optimization, not the trust anchor.

### 12.5 Legacy activation boundary

The first v2 record on an existing log contains:

```typescript
type AuditIntegrityEnabledDetails = {
  legacyRecordCount: number;
  legacyByteLength: number;
  legacySegmentDigest: string; // digest of exact legacy bytes
};
```

All legacy records remain reported as an unverified legacy segment.

### 12.6 Verification

```text
alix audit verify
alix audit verify --json
alix audit checkpoint --output <path>
```

Verifier requirements:

- Streaming reads
- Exact line numbers and byte offsets
- Strict JSON parsing
- Record-hash verification
- Previous-link verification
- Sequence continuity
- Duplicate/gap/reorder detection
- Tail truncation distinguished from interior corruption
- Legacy segment report
- Head-sidecar consistency report
- Non-zero exit on integrity failure

Do not silently skip malformed lines in verification mode.

### 12.7 Checkpoints

Checkpoint payload:

```typescript
type AuditCheckpoint = {
  schemaVersion: 1;
  workspaceId: string;
  sequence: number;
  recordHash: string;
  createdAt: string;
  signerKeyId: string;
  signature: string;
};
```

A checkpoint stored beside the log is still same-host evidence. Stronger anchoring requires explicit export to another trust domain, for example:

- A separate protected location
- A Git commit/tag
- A remote transparency service
- Operator-managed offline storage

The product must call the chain **tamper-evident**, never tamper-proof.

---

## 13. Config Trust and Credential Migration

### 13.1 Central mutation service

Create:

```typescript
class ConfigMutationService {
  set(path: string, value: unknown, options: MutationOptions): Promise<MutationResult>;
  applyProfile(profile: unknown, options: MutationOptions): Promise<MutationResult>;
  remove(path: string, options: MutationOptions): Promise<MutationResult>;
}
```

Every config writer must use it:

- `config set-default-model`
- `config set-tier`
- MCP add/remove/discover
- Model profile apply/install
- Init/onboarding
- Future policy/security settings
- Any direct config write found by repository search

The loader remains read-only.

### 13.2 Credential store

New user-scoped file:

```text
~/.config/alix/credentials.json
```

or platform equivalent.

Requirements:

- `0600` Unix permissions
- Atomic write
- Never project-scoped
- Never returned through Inspector
- Never included in signed config projection
- Never included in support bundles
- Environment variables remain supported

Migration:

```text
alix security credentials migrate
alix security credentials doctor
```

Transition behavior:

1. Read legacy `apiKeys` for compatibility.
2. Warn once with exact migration command.
3. Refuse project-config API keys in production mode.
4. Migrate keys to credential store.
5. Remove keys from config only after successful credential write.
6. Write provenance entry containing changed paths, never values.
7. Deprecate `apiKeys` in config schema in the next major config version.

MCP headers/env fields require the same secret-reference treatment:

```json
{
  "headers": {
    "Authorization": "${credential:mcp.github.authorization}"
  }
}
```

### 13.3 Signed config manifest

```typescript
type SignedConfigManifest = {
  schemaVersion: 1;
  configVersion: number;
  signedAt: string;
  signerKeyId: string;
  requiredPolicyVersion: 1;
  coveredPaths: string[];
  contentDigest: string;
  signature: string;
};
```

Required signed paths are defined by code, not chosen freely by the manifest.

Suggested project paths:

```text
permissions
runtime
mcpServers (secret references only)
mcpServerPaths
ownership
toolConfig
subagents.roles
ui.security
policy references
workspace boundaries
approval policy
```

Excluded:

- Raw credentials
- Daemon/runtime state
- Cache state
- Last-used ephemeral values
- PID/socket paths
- Browser sessions

### 13.4 Trust evaluation

```typescript
type ConfigTrustState =
  | "verified"
  | "unsigned"
  | "invalid"
  | "unknown-key"
  | "stale-signature"
  | "incomplete-coverage"
  | "rollback-detected"
  | "legacy-secrets-present";
```

Production behavior:

| State | Development | Production |
|---|---|---|
| verified | allow | allow |
| unsigned | warn | configurable warn/reject |
| stale-signature | warn | reject |
| invalid | reject | reject |
| unknown-key | reject | reject |
| incomplete-coverage | reject | reject |
| rollback-detected | reject | reject |
| legacy-secrets-present | warn | reject |

### 13.5 Verification and TOCTOU

`loadConfigWithTrust()` must:

1. Read each config layer once.
2. Parse the exact bytes read.
3. Build the signed projection from that parsed object.
4. Verify the manifest.
5. Merge the same parsed objects.
6. Return both effective config and trust report.

Do not verify one read and execute another.

### 13.6 Anti-rollback

A valid older signature is still valid cryptographically.

Add:

- Monotonic `configVersion`
- Last accepted version per workspace in user-scoped state
- Explicit `--allow-rollback` administrative recovery path
- Audit event for override

This detects ordinary replay/rollback but is not proof against a fully privileged local attacker.

### 13.7 Provenance

```typescript
type ConfigProvenanceRecord = {
  schemaVersion: 1;
  sequence: number;
  timestamp: string;
  actor: string;
  command?: string;
  previousDigest?: string;
  newDigest: string;
  changedPaths: string[];
  reason?: string;
  previousHash: string;
  recordHash: string;
  signature?: string;
};
```

Provenance records are themselves hash-chained. Values are not recorded.

---

## 14. Supply-Chain Hardening

### 14.1 Preserve what already exists

Retain:

- Exact direct dependency versions
- Lockfile
- Dependency pin verification
- Release gate
- Packed-artifact smoke test
- npm provenance

### 14.2 Lifecycle script policy

Do not blindly use `npm ci --ignore-scripts` for every CI lane. The repository includes native packages that may require install/rebuild scripts.

Revised flow:

1. Install with scripts disabled for the dependency-policy inspection lane.
2. Inspect lockfile packages that declare lifecycle scripts.
3. Compare against a reviewed allowlist with package name, version/range, reason, and expiry.
4. Run only the approved rebuild/install steps needed by test lanes.
5. Fail on any new lifecycle-script package.

Files:

```text
security/lifecycle-script-allowlist.json
scripts/verify-lifecycle-scripts.mjs
```

### 14.3 Audit policy

Run separately:

```text
npm audit --omit=dev --json     # production dependency exposure
npm audit --json                # complete report
```

Exceptions require:

```typescript
type SecurityException = {
  advisoryId: string;
  package: string;
  scope: "production" | "development";
  severity: string;
  owner: string;
  rationale: string;
  createdAt: string;
  expiresAt: string;
};
```

Expired exceptions fail the gate.

Do not claim full code-path reachability from `npm audit` alone.

### 14.4 Immutable CI dependencies

Pin GitHub Actions to full commit SHAs and use Dependabot/Renovate to propose updates.

Set least-privilege workflow permissions explicitly.

### 14.5 Pack once and publish exact artifact

Revised publish flow:

```text
npm ci / approved rebuild
→ build and test
→ npm pack --json
→ inspect tarball allowlist/denylist
→ install and smoke-test that tarball
→ generate SBOM for that artifact/dependency graph
→ compute SHA-256
→ upload tarball + SBOM + checksum as workflow artifacts
→ publish that exact tarball with npm provenance
→ attach same files to GitHub release
```

Do not delete the verified tarball and run `npm publish` against the source tree.

### 14.6 Package content verification

Fail if tarball contains:

- `.env*`
- credentials/token/auth files
- `.alix/` runtime state
- private keys
- audit/session logs
- test fixtures containing real-looking secrets
- editor/CI credentials
- unexpected source maps containing sensitive absolute paths
- files outside the declared package allowlist

### 14.7 Lockfile freshness

Use a deterministic check that fails if dependency metadata would modify the lockfile, then verify `git diff --exit-code`.

---

## 15. Metrics System Reconciliation

### 15.1 Authoritative system

The current authoritative observability stack is:

```text
M0.9 MinimalMetrics
  → session metric events

P4.2 TelemetryEnvelope
  → normalized event representation

P4.2 MetricsStore
  → .alix/observability/metrics/YYYY-MM-DD.jsonl

HealthProjectionCollector / ObservabilitySnapshotService
AlertEngine
TrendAnalyzer
CostAttribution
Observability REST + SSE
TUI health/cost panels
```

The older Python catalog describing `psutil`, `alix/monitoring/*.py`, SQLite at `~/.alix/monitoring/metrics.db`, WebSocket `/monitoring/stream`, and WASM metrics is not the current implementation.

Recommended documentation action:

```text
Move/rename:
  ALiX_METRICS_COMPREHENSIVE.md
to:
  docs/archive/legacy-python-metrics-catalog.md

Create:
  docs/observability/metrics-catalog.md
```

### 15.2 P4.2 debt to fix before adding security metrics

1. Add a closed metric registry.
2. Validate allowed label keys per metric.
3. Validate bounded label values/enums.
4. Add `security` to `TelemetryCategory`.
5. Support metric filtering inside the store query rather than after the limit.
6. Define newest/oldest ordering explicitly.
7. Ensure security health reads cached verification results and never triggers active verification.
8. Do not use request IDs, IPs, token IDs, run IDs, worker IDs, paths, or raw routes as metric labels.

### 15.3 Security metric registry

| Metric | Type | Allowed labels |
|---|---|---|
| `security_http_requests_total` | counter_delta | route_class, status_class, auth_method |
| `security_http_request_duration_ms` | histogram_sample | route_class, status_class |
| `security_auth_attempts_total` | counter_delta | result, auth_method |
| `security_authz_denials_total` | counter_delta | permission, route_class |
| `security_host_rejections_total` | counter_delta | reason |
| `security_origin_rejections_total` | counter_delta | reason |
| `security_rate_limit_rejections_total` | counter_delta | route_class, scope |
| `security_sse_connections_active` | gauge | stream |
| `security_sse_connections_rejected_total` | counter_delta | stream, reason |
| `security_sse_disconnects_total` | counter_delta | stream, reason |
| `security_redactions_total` | counter_delta | classification, sink |
| `security_redaction_failures_total` | counter_delta | sink |
| `security_audit_appends_total` | counter_delta | result |
| `security_audit_verification_failures_total` | counter_delta | reason |
| `security_config_verifications_total` | counter_delta | state |
| `security_supply_chain_findings_total` | gauge | severity, scope |
| `security_gate_runs_total` | counter_delta | result |
| `security_gate_duration_ms` | histogram_sample | result |

Bounded enums only.

### 15.4 Security health projection

Extend `RuntimeHealthSnapshot`:

```typescript
type SecurityHealth = {
  inspectorAuth: "healthy" | "degraded" | "unhealthy" | "unknown";
  auditIntegrity: "healthy" | "degraded" | "unhealthy" | "unknown";
  configTrust: ConfigTrustState | "unknown";
  supplyChain: "healthy" | "degraded" | "unhealthy" | "unknown";
  lastSecurityGateAt?: string;
  lastSecurityGatePassed?: boolean;
};
```

The health collector reads passive status artifacts only. It does not:

- Rotate tokens
- Verify the entire audit log
- Run npm audit
- Sign config
- Run tests

### 15.5 Security alerts

Add bounded rules:

- Inspector auth disabled outside approved development mode
- Non-loopback bind without TLS/trusted proxy
- Authentication rejection spike
- Rate-limit rejection spike
- SSE connection saturation
- Redaction failure
- Audit verification failure
- Invalid/stale/rollback config trust in production
- Expired supply-chain exception
- Failed security release gate

---

## 16. Security Audit Events

Extend the audit vocabulary with explicit actions:

```text
security.auth.succeeded
security.auth.failed
security.authorization.denied
security.host.rejected
security.origin.rejected
security.rate_limit.exceeded
security.sse.connection_rejected
security.token.created
security.token.rotated
security.token.revoked
security.audit.integrity_enabled
security.audit.verification_failed
security.audit.checkpoint_created
security.config.verified
security.config.rejected
security.config.changed
security.config.rollback_override
security.credentials.migrated
security.supply_chain.failed
security.gate.completed
```

Rules:

- Never log a raw token, hash, cookie, Authorization header, credential value, or full IP by default.
- Token/principal IDs may be opaque audit correlation fields but never metrics labels.
- Client address retention must be configurable; default to masked or omitted.
- Authentication successes may be sampled; failures and security decisions are retained.
- Audit append failures emit local stderr/diagnostic output and a bounded metric without recursively calling the failing audit writer.

---

## 17. Milestone Plan

## P4.3-S0 — Immediate Boundary Correction

**Goal:** remove the current highest-risk exposure before broader refactoring.

Changes:

- Change `DEFAULT_CONFIG.ui.host` from `0.0.0.0` to `127.0.0.1`
- Update README and configuration docs
- Warn/fail when old default-equivalent remote binding is used without explicit remote security config
- Add Host validation for loopback
- Add basic security headers
- Add regression tests

Files:

| File | Action |
|---|---|
| `src/config/defaults.ts` | MODIFY |
| `src/config/schema.ts` | MODIFY |
| `src/config/validator.ts` | MODIFY |
| `src/server/server.ts` | MODIFY |
| `README.md` | MODIFY |
| `docs/configuration.md` | MODIFY |
| `tests/server/server.test.ts` | MODIFY |
| `tests/config-loader.test.ts` | MODIFY |

Acceptance:

- Fresh install listens only on loopback.
- Existing explicit remote config produces a security warning or fails closed per mode.
- `/healthz` remains minimal.
- No project API route is remotely exposed by default.

---

## P4.3-Sa — Redaction Foundation and Metrics Contract

**Goal:** create safe, reusable secret detection/redaction and the closed security metric vocabulary.

Changes:

- Add detector without raw context leakage
- Add structural redactor
- Add redaction profiles
- Add secure config display
- Add `security` telemetry category
- Add metric registry and security metrics adapter
- Redact audit inputs and Inspector responses in subsequent milestones

Files:

| File | Action |
|---|---|
| `src/security/redaction/classifications.ts` | CREATE |
| `src/security/redaction/secret-detector.ts` | CREATE |
| `src/security/redaction/redaction-policy.ts` | CREATE |
| `src/security/redaction/redactor.ts` | CREATE |
| `src/security/secret-scanner.ts` | MODIFY |
| `src/observability/metric-registry.ts` | CREATE |
| `src/observability/security-telemetry.ts` | CREATE |
| `src/observability/telemetry-envelope.ts` | MODIFY |
| `src/observability/metrics-store.ts` | MODIFY |
| `src/cli.ts` or config display helper | MODIFY |
| `tests/security/redaction/` | CREATE |
| `tests/observability/metric-registry.test.ts` | CREATE |

Acceptance:

- No detector result includes raw secret context.
- Cycles, depth, size, arrays, URLs, headers, and false positives are tested.
- Metric names and labels are closed and bounded.
- `config show` uses the same redactor.
- Redaction failure cannot leak the original value.

---

## P4.3-Sb — Route Registry, Identity, and Authorization

**Goal:** make every Inspector API route explicitly authenticated and authorized.

Changes:

- Add route security registry
- Refactor server routing into context-aware async handlers
- Add user-scoped multi-token auth store
- Add browser session exchange
- Add complete permission map
- Keep all workspace operations read-only
- Add secure JSON responder
- Normalize client errors

Files:

| File | Action |
|---|---|
| `src/security/inspector/route-policy.ts` | CREATE |
| `src/security/inspector/auth-store.ts` | CREATE |
| `src/security/inspector/auth-service.ts` | CREATE |
| `src/security/inspector/browser-session-store.ts` | CREATE |
| `src/security/inspector/authorization.ts` | CREATE |
| `src/security/inspector/security-context.ts` | CREATE |
| `src/server/security-middleware.ts` | CREATE |
| `src/server/secure-response.ts` | CREATE |
| `src/server/server.ts` | MODIFY |
| `src/server/coordination-routes.ts` | MODIFY |
| `src/observability/observability-routes.ts` | MODIFY |
| `src/ui/app.js` | MODIFY |
| `src/ui/index.html` | MODIFY |
| `src/cli/commands/security.ts` | CREATE |
| `src/cli.ts` | MODIFY |
| `tests/security/inspector/` | CREATE |
| `tests/server/server.test.ts` | MODIFY |

Acceptance:

- Every data-bearing API route is in the registry.
- Unknown API routes fail closed.
- Native browser SSE works through an HttpOnly session cookie.
- Curl/SDK Bearer authentication works.
- Role tests cover every route.
- No web endpoint approves, denies, repairs, executes, or changes config.

---

## P4.3-Sc — Network Boundary, Rate Limits, and SSE Hub

**Goal:** stop browser/network abuse and bound stream resource use.

Changes:

- Host validation
- Exact origin policy
- Trusted proxy CIDRs
- TLS/remote-access enforcement
- Pre/post-auth token buckets
- Connection limiter
- Shared observability stream hub
- Shared session event tailer
- Backpressure and lifetime controls
- HTTP timeout/header/request bounds
- Security headers and CSP

Files:

| File | Action |
|---|---|
| `src/security/inspector/host-policy.ts` | CREATE |
| `src/security/inspector/origin-policy.ts` | CREATE |
| `src/security/inspector/client-address.ts` | CREATE |
| `src/security/inspector/rate-limiter.ts` | CREATE |
| `src/security/inspector/connection-limiter.ts` | CREATE |
| `src/security/inspector/remote-access-policy.ts` | CREATE |
| `src/server/secure-sse.ts` | CREATE |
| `src/server/observability-stream-hub.ts` | CREATE |
| `src/server/session-stream-hub.ts` | CREATE |
| `src/server/observability-stream.ts` | REFACTOR |
| `src/server/server.ts` | MODIFY |
| `src/config/schema.ts` | MODIFY |
| `src/config/defaults.ts` | MODIFY |
| `src/config/validator.ts` | MODIFY |
| `tests/security/inspector/` | EXPAND |
| `tests/server/observability-stream.test.ts` | MODIFY |
| `tests/inspector-stream.test.ts` | MODIFY |
| `tests/stress/inspector-abuse.test.ts` | CREATE |

Acceptance:

- One observability producer serves all clients.
- CPU/disk work does not scale linearly with client count.
- Slow clients are disconnected and cleaned up.
- No unbounded buckets, queues, listeners, timers, or replay buffers.
- Non-loopback cleartext auth fails closed.
- Host and origin adversarial tests pass.

---

## P4.3-Sd — Audit Chain, Verification, and Checkpoints

**Goal:** make audit corruption and reordering detectable under concurrent ALiX processes.

Changes:

- Canonical JSON
- v2 hash chain
- Cross-process append lock
- Head sidecar
- Legacy boundary
- Streaming verifier
- Signed checkpoints
- Audit query streaming refactor
- Security audit vocabulary

Files:

| File | Action |
|---|---|
| `src/security/audit/canonical-json.ts` | CREATE |
| `src/security/audit/audit-lock.ts` | CREATE |
| `src/security/audit/audit-chain-writer.ts` | CREATE |
| `src/security/audit/audit-verifier.ts` | CREATE |
| `src/security/audit/audit-checkpoint.ts` | CREATE |
| `src/audit/audit-store.ts` | REFACTOR |
| `src/audit/audit-types.ts` | MODIFY |
| `src/cli/commands/security.ts` | MODIFY |
| `src/cli.ts` | MODIFY |
| `tests/security/audit/` | CREATE |
| `tests/stress/audit-concurrency.test.ts` | CREATE |

Acceptance:

- Concurrent writers produce one contiguous chain.
- Body, link, sequence, delete, insert, reorder, duplicate, and truncation tampering are detected.
- Legacy segment is explicit.
- Verification streams large logs.
- No malformed line is silently ignored in verification mode.
- Checkpoint semantics are documented honestly.

---

## P4.3-Se — Credential Migration, Config Signing, and Provenance

**Goal:** remove secret-bearing config and make security-sensitive config changes attributable and verifiable.

Changes:

- User-scoped credential store
- Legacy credential migration
- Secret references for MCP config
- Central mutation service
- Signed required-path projection
- Trust state and production enforcement
- Anti-rollback state
- Hash-chained provenance
- Key generation/trust management
- Same-read verification and execution

Files:

| File | Action |
|---|---|
| `src/security/credentials/credential-store.ts` | CREATE |
| `src/security/credentials/credential-migration.ts` | CREATE |
| `src/security/config/config-projection.ts` | CREATE |
| `src/security/config/config-signing.ts` | CREATE |
| `src/security/config/config-provenance.ts` | CREATE |
| `src/security/config/config-version-store.ts` | CREATE |
| `src/security/config/trust-policy.ts` | CREATE |
| `src/config/config-mutation-service.ts` | CREATE |
| `src/config/loader.ts` | MODIFY |
| `src/config/schema.ts` | MODIFY |
| `src/config/validator.ts` | MODIFY |
| `src/cli.ts` | REFACTOR config writes |
| `src/cli/commands/init.ts` | MODIFY |
| model/profile and MCP config writers | MODIFY |
| `tests/security/config/` | CREATE |
| `tests/security/credentials/` | CREATE |

Acceptance:

- Production mode rejects project-config secrets.
- Every supported config mutation creates provenance.
- A changed signed field yields stale/invalid trust before execution.
- Missing required path coverage is rejected.
- Old signed config replay is detected.
- No private key or credential is stored in the repository.

---

## P4.3-Sf — Supply-Chain Policy and Verified Publication

**Goal:** make dependency and publication state reproducible and inspectable.

Changes:

- Lifecycle-script allowlist
- Production/full npm audit lanes
- Expiring security exceptions
- Lockfile freshness check
- Action SHA pinning
- SBOM
- Tarball content policy
- Checksum
- Pack once/publish exact tarball
- Attach verified artifacts to release

Files:

| File | Action |
|---|---|
| `src/security/supply-chain/dependency-policy.ts` | CREATE |
| `src/security/supply-chain/security-exceptions.ts` | CREATE |
| `src/security/supply-chain/package-verifier.ts` | CREATE |
| `security/lifecycle-script-allowlist.json` | CREATE |
| `security/audit-exceptions.json` | CREATE |
| `scripts/verify-lifecycle-scripts.mjs` | CREATE |
| `scripts/check-supply-chain.sh` | CREATE |
| `scripts/release-gate.sh` | MODIFY |
| `.github/workflows/ci.yml` | MODIFY |
| `.github/workflows/publish.yml` | MODIFY |
| `.github/dependabot.yml` | CREATE/MODIFY |
| `tests/security/supply-chain/` | CREATE |

Acceptance:

- New lifecycle scripts fail CI unless reviewed.
- Expired advisory exceptions fail CI.
- The exact smoke-tested tarball is published.
- Tarball checksum and SBOM are retained.
- Workflow actions are immutable by SHA.
- npm provenance remains enabled.

---

## P4.3-Sg — Threat Model, Adversarial Tests, and Security Gate

**Goal:** turn all security claims into executable acceptance criteria.

Changes:

- Repository-specific threat model
- Adversarial test matrix
- Security doctor
- Security gate
- Machine-readable report
- Cross-platform permission/ACL tests
- Security metrics/health/alert integration
- Documentation and migration notes

Commands:

```text
npm run test:security
alix security doctor
alix security doctor --json
alix security gate --json
```

Files:

| File | Action |
|---|---|
| `docs/security/threat-model.md` | CREATE |
| `docs/security/inspector-security.md` | CREATE |
| `docs/security/audit-integrity.md` | CREATE |
| `docs/security/config-trust.md` | CREATE |
| `docs/observability/metrics-catalog.md` | CREATE |
| `src/security/acceptance/security-check-registry.ts` | CREATE |
| `src/security/acceptance/security-doctor.ts` | CREATE |
| `src/security/acceptance/security-report.ts` | CREATE |
| `src/cli/commands/security.ts` | MODIFY |
| `package.json` | MODIFY |
| `scripts/release-gate.sh` | MODIFY |
| `tests/security/acceptance/` | CREATE |
| `tests/stress/inspector-abuse.test.ts` | EXPAND |

The gate fails closed when a checker crashes.

Do not expose a public "middleware active" endpoint. Inspect registered route policy and server construction internally.

---

## 18. Adversarial Test Matrix

### Authentication and session

- Missing Bearer token
- Malformed token
- Wrong token ID
- Correct ID/wrong secret
- Revoked token
- Expired token
- Rotated token inside/outside grace
- Token scoped to another workspace
- Role below required permission
- Session fixation attempt
- Reused expired browser session
- Cookie without same-origin request
- Token in query string rejected
- Auth-store permission failure
- Auth-store atomic-write interruption

### Host, origin, proxy, and transport

- DNS-rebinding Host
- Alternate Host header
- Disallowed Origin
- Wildcard origin with credentials
- Forged `X-Forwarded-For` from untrusted peer
- Trusted proxy outside configured CIDR
- Remote HTTP Bearer attempt
- Oversized headers
- Overlong URL
- Request body on GET
- Auth body above limit
- Slow header delivery

### Authorization

- Every route tested against viewer/operator/admin
- Unknown route default deny
- Route added without descriptor fails test
- Static route cannot read workspace data
- Public health returns no details
- Admin response still redacts secrets

### Redaction

- API keys in nested object/array
- Authorization header
- Cookie and Set-Cookie
- Credential URL
- PEM private key
- JWT
- Secret in error message
- Secret in metric labels/dimensions
- Secret in audit details
- Cyclic object
- Throwing getter/proxy
- Depth/property/string/output limits
- Benign key names and high-entropy identifiers
- Explicit secret pattern under allowlisted path
- Redactor internal failure

### Rate and SSE

- Pre-auth flood
- Many invalid token IDs
- Principal burst
- Bucket-cap exhaustion with random addresses
- IPv4/IPv6 normalization
- Global/per-principal/per-IP connection limits
- Slow client
- Client that never drains
- Replay cursor below ring floor
- Cursor from old epoch
- Malformed cursor
- Connection lifetime expiry
- Server shutdown cleanup
- Repeated connect/disconnect leak test
- 25-client resource profile proves shared producer

### Audit

- Concurrent append from multiple processes
- Record-body modification
- Previous-hash modification
- Sequence modification
- Deleted record
- Inserted record
- Reordered records
- Duplicate sequence
- Interior malformed line
- Truncated tail
- Stale/corrupt head sidecar
- Stale lock recovery
- Legacy boundary alteration
- Checkpoint signature alteration
- Wrong workspace checkpoint

### Config and credentials

- Config changed after signing
- Missing required covered path
- Unknown key
- Corrupt manifest
- Replayed old valid config
- Environment override reported in trust result
- Legacy API key in project config
- Failed credential migration leaves original intact
- Direct config writer bypass test
- Provenance deletion/reorder/modification
- Private-key permission failure
- Symlinked credential/config target
- Production trust enforcement

### Supply chain

- New unapproved lifecycle script
- Expired advisory exception
- Lockfile drift
- Unexpected tarball file
- Secret-like fixture in tarball
- Tarball checksum mismatch
- SBOM generation failure
- Published input differs from verified tarball
- Workflow action uses moving tag
- Gate checker crash

---

## 19. File Layout

```text
src/security/
  redaction/
    classifications.ts
    secret-detector.ts
    redaction-policy.ts
    redactor.ts

  inspector/
    route-policy.ts
    auth-store.ts
    auth-service.ts
    browser-session-store.ts
    authorization.ts
    security-context.ts
    host-policy.ts
    origin-policy.ts
    client-address.ts
    rate-limiter.ts
    connection-limiter.ts
    remote-access-policy.ts

  audit/
    canonical-json.ts
    audit-lock.ts
    audit-chain-writer.ts
    audit-verifier.ts
    audit-checkpoint.ts

  credentials/
    credential-store.ts
    credential-migration.ts

  config/
    config-projection.ts
    config-signing.ts
    config-provenance.ts
    config-version-store.ts
    trust-policy.ts

  supply-chain/
    dependency-policy.ts
    package-verifier.ts
    security-exceptions.ts

  acceptance/
    security-check-registry.ts
    security-doctor.ts
    security-report.ts

src/server/
  security-middleware.ts
  secure-response.ts
  secure-sse.ts
  observability-stream-hub.ts
  session-stream-hub.ts

src/observability/
  metric-registry.ts
  security-telemetry.ts

src/config/
  config-mutation-service.ts
```

---

## 20. Storage Layout

```text
Project workspace:
  .alix/
    config.json
    audit/
      audit.jsonl
      head.json
      audit.lock
      checkpoints/
    observability/
      metrics/
      rollups/
    security/
      config-manifest.json
      config-provenance.jsonl
      config-provenance-head.json

User-scoped state:
  .../alix/
    credentials.json
    inspector/
      auth.json
    keys/
      config-signing-private.pem
      config-signing-public.pem
      audit-checkpoint-private.pem
      audit-checkpoint-public.pem
    trust/
      workspace-state.json
```

Private keys and raw credentials never live in the project workspace.

---

## 21. Pull Request Sequence

Recommended small, reviewable PRs:

```text
PR 1  P4.3-S0 loopback default, Host policy, docs
PR 2  Redaction detector/redactor + config display
PR 3  Closed metric registry + security telemetry
PR 4  Route security registry + secure JSON responder
PR 5  Token auth store + CLI + Bearer auth
PR 6  Browser session exchange + UI login + SSE cookie auth
PR 7  Origin/proxy/TLS policy + two-stage rate limiting
PR 8  Shared observability and session SSE hubs
PR 9  Audit canonicalization + chain writer + concurrency lock
PR 10 Audit verifier + migration boundary + checkpoints
PR 11 Credential store + migration
PR 12 Config mutation service + provenance
PR 13 Config signing + anti-rollback enforcement
PR 14 Supply-chain checks + exact-artifact publication
PR 15 Threat model + adversarial tests + security gate
PR 16 Documentation reconciliation and roadmap renumbering
```

Do not combine authentication, audit-chain migration, config migration, and publishing changes in one PR.

---

## 22. Cross-Platform Requirements

### Linux/macOS

- Verify mode bits after writes
- Reject group/world-readable auth and private-key files in production
- Atomic rename within same filesystem
- Symlink checks using `lstat`/realpath containment
- Lock stale-owner handling

### Windows

- Best-effort user-only ACL
- No reliance on Unix mode bits
- Atomic replace semantics tested
- Named path and drive-letter normalization
- IPv6 and loopback binding tests
- Security doctor reports ACL uncertainty explicitly

No platform is reported "secure" merely because a permission operation did not throw.

---

## 23. Configuration Compatibility

### New config fields

Retain `ui` for backward compatibility:

```typescript
type UiSecurityConfig = {
  authentication: "required" | "disabled-loopback-development";
  remoteAccess: boolean;
  allowedHosts: string[];
  allowedOrigins: string[];
  trustedProxyCidrs: string[];
  sessionTtlMs: number;
  tokenGraceMs: number;
  requireTlsForRemote: boolean;
  rateLimits: Record<RouteClass, RateLimitConfig>;
  sse: SseLimitConfig;
};

type UiConfig = {
  enabled: boolean;
  host: string;
  port: number;
  transport: "sse";
  security: UiSecurityConfig;
};
```

`websocket` remains unsupported unless a bidirectional use case is approved.

### Legacy behavior

- Existing explicit `ui.host: "0.0.0.0"` is not silently changed.
- Development mode emits a high-visibility warning and requires explicit remote opt-in.
- Production mode rejects it without secure remote configuration.
- Existing API keys continue to load temporarily with migration warnings.
- Existing audit records remain readable as a legacy unverified segment.

---

## 24. Security Gate Report

```typescript
type SecurityGateReport = {
  schemaVersion: 1;
  generatedAt: string;
  repositoryRevision?: string;
  result: "pass" | "fail";
  checks: Array<{
    id: string;
    category:
      | "inspector"
      | "redaction"
      | "audit"
      | "config"
      | "credentials"
      | "supply-chain"
      | "tests";
    result: "pass" | "warn" | "fail" | "error";
    summary: string;
    evidence?: Record<string, string | number | boolean>;
    remediation?: string;
  }>;
};
```

Sensitive evidence is never embedded.

Exit codes:

```text
0 pass
1 security check failed
2 checker/internal error
3 invalid invocation/configuration
```

---

## 25. Definition of Done

P4.3-S is complete only when all are true:

- Fresh Inspector binds to loopback.
- Every data route is authenticated.
- Every authenticated route has an explicit permission.
- Browser REST and SSE work without URL/local-storage tokens.
- Inspector remains read-only.
- Remote HTTP credentials are rejected.
- Host/origin/proxy policies pass adversarial tests.
- Rate/connection state is bounded.
- SSE work is shared, backpressure-aware, and leak-tested.
- Inspector, audit, config display, export, and support outputs are redacted.
- Audit appends are serialized and chain verification detects all defined tampering.
- Config writes are centralized and provenance-complete.
- Project config no longer stores active raw credentials in production.
- Config signatures enforce required coverage and detect rollback.
- Security metrics use the current P4.2 stack with bounded labels.
- Security health is passive and side-effect-free.
- CI verifies lifecycle scripts, advisories, lockfile, tarball contents, SBOM, and checksum.
- The exact verified tarball is published with npm provenance.
- Threat model and operator documentation match implementation.
- `npm run test:security` and the release security gate pass on supported platforms.

---

## 26. Decisions That Supersede the Draft

| Draft decision | Revised decision |
|---|---|
| `.alix/inspector-token` stores raw token | User-scoped auth store contains token hashes only |
| One token file plus metadata-only rotation | Multi-token hashed records with explicit grace |
| Bearer header for all clients | Bearer for API clients; HttpOnly session for browser/SSE |
| Loopback auth optional | Authentication required by default, including loopback |
| Inspector write permissions | Inspector stays read-only in P4.3-S |
| Partial permission list | Complete route registry and default deny |
| Middleware intercepts all responses | Explicit secure JSON/SSE responders |
| Origin after authorization | Host/origin and pre-auth limits before expensive auth |
| Per-client SSE computation | Shared producer/hub with bounded fan-out |
| `recordHash` hashes body only | Hash binds body, sequence, and previous hash |
| Rely on small append atomicity | Cross-process append coordinator |
| Last legacy record digest | Digest exact entire legacy byte segment |
| `coveredPaths` supplied by manifest | Required coverage defined and enforced by code |
| Modify loader for provenance | Centralize every config mutation |
| API keys are assumed absent from config | Implement credential migration and schema deprecation |
| Blanket `npm ci --ignore-scripts` | Reviewed lifecycle-script allowlist |
| Verify one tarball, publish from source tree | Publish exact verified tarball |
| Public active-check endpoint | Internal doctor/check registry |
| Python metrics catalog is current | Archive it as legacy; extend TypeScript P4.2 metrics |

---

## 27. Final Architecture Verdict

**Approve the security initiative, but do not implement the original draft unchanged.**

The revised P4.3-S architecture is compatible with the repository's actual TypeScript runtime, preserves the read-only Inspector invariant, resolves browser SSE authentication, prevents project-local credential leakage, bounds stream amplification, gives the audit chain correct concurrency and linkage semantics, makes config trust enforceable through centralized mutation, and integrates security signals into the observability system that ALiX actually runs.

The first implementation action should be **P4.3-S0: change the default Inspector host to `127.0.0.1` and add regression tests**. Everything else builds on that corrected boundary.
