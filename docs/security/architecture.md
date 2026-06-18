# ALiX Inspector Security Architecture

**Date:** 2026-06-17
**Milestone:** P4.3-S

---

## Overview

The ALiX Inspector security architecture provides defense-in-depth for a local-first observability server. It combines authentication, network boundary controls, data redaction, audit integrity, config trust, credential management, and supply-chain hardening into a cohesive security model.

---

## Trust Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│                     External Network                         │
│  (untrusted — blocked by loopback binding by default)        │
├─────────────────────────────────────────────────────────────┤
│              Trusted Proxy (optional, TLS-terminating)       │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│  CIDR-validated via client-address.ts                        │
├─────────────────────────────────────────────────────────────┤
│                   Loopback (127.0.0.1)                       │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│
│              ALiX Inspector HTTP Server                       │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────┐  │
│  │ Security     │ │ Route        │ │ Secure JSON          │  │
│  │ Middleware    │ │ Policy       │ │ Responder            │  │
│  │              │ │ Registry     │ │                      │  │
│  │ host check   │ │ route lookup │ │ secret detection     │  │
│  │ origin check │ │ auth req'd?  │ │ output limiting      │  │
│  │ remote check │ │ permission?  │ │ redaction profile    │  │
│  │ auth check   │ │              │ │                      │  │
│  │ rate limit   │ │              │ │                      │  │
│  └──────┬───────┘ └──────┬───────┘ └──────────┬───────────┘  │
│         │                │                     │              │
│  ┌──────┴───────┐ ┌──────┴───────┐ ┌──────────┴───────────┐  │
│  │ Auth Service │ │ Route        │ │ Secret Detector      │  │
│  │              │ │ Handlers     │ │                      │  │
│  │ bearer token │ │              │ │ regex patterns       │  │
│  │ cookie sess. │ │ data routes  │ │ redaction rules      │  │
│  │ audit logging│ │ SSE streams  │ │                      │  │
│  └──────┬───────┘ └──────────────┘ └──────────────────────┘  │
│         │                                                     │
├─────────┼─────────────────────────────────────────────────────┤
│         │        File System Boundary                          │
│  ┌──────┴───────────────────────────────────────────────────┐ │
│  │  Platform State Directory (~/.local/share/alix/)          │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │ │
│  │  │ Auth Store   │ │ Audit Log    │ │ Credential Store │  │ │
│  │  │ (hash-only)  │ │ (hash-chain) │ │ (encrypted)      │  │ │
│  │  └─────────────┘ └──────────────┘ └──────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Project Directory (.alix/)                                │ │
│  │  ┌─────────────┐ ┌──────────────┐ ┌──────────────────┐  │ │
│  │  │ Config       │ │ Signatures   │ │ Observability    │  │ │
│  │  │ (config.json)│ │ (signed)     │ │ (metrics, audit) │  │ │
│  │  └─────────────┘ └──────────────┘ └──────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Trust Boundaries Summary

| Boundary | Trust Level | Controls |
|---|---|---|
| External Network | Untrusted | Loopback binding by default, host header validation |
| Trusted Proxy | Semi-trusted | CIDR validation, client address resolution |
| Loopback / Localhost | Trusted | Authentication still required for API routes |
| File System (Platform State) | Trusted | Permission controls (0o700 dir, 0o600 files), symlink checks |
| File System (Project) | Trusted | Config signing, anti-rollback, provenance tracking |

---

## Component Interaction

```
Request Flow:

  HTTP Request
       │
       ▼
  ┌──────────────────┐
  │ HTTP Limit Check │  ← http-limits.ts (header/body size)
  └────────┬─────────┘
       │
       ▼
  ┌──────────────────┐
  │ Host Validation  │  ← host-policy.ts (exact-match allowlist)
  └────────┬─────────┘
       │
       ▼
  ┌──────────────────────────┐
  │ Security Middleware       │  ← security-middleware.ts
  │                           │
  │ 1. Generate request ID   │
  │ 2. Resolve client addr   │  ← client-address.ts (proxy-aware)
  │ 3. Look up route desc.   │  ← route-policy.ts (RoutePolicyRegistry)
  │ 4. Validate origin       │  ← origin-policy.ts
  │ 5. Validate remote access│  ← remote-access-policy.ts
  │ 6. Validate auth (bearer │  ← auth-service.ts + auth-store.ts
  │    token or cookie)      │
  │ 7. Apply rate limiting   │  ← rate-limiter.ts (post-auth)
  │ 8. Build SecurityContext │  ← security-context.ts
  └────────┬─────────────────┘
       │
       ▼
  ┌──────────────────┐
  │ Route Handler    │  ← server.ts (dispatched by pathname)
  │                  │
  │ Uses:            │
  │ - SecureResponder│  ← secure-response.ts (redacted JSON)
  │ - SecretDetector │  ← secret-detector.ts
  └────────┬─────────┘
       │
       ▼
  ┌──────────────────┐
  │ Security Headers │  ← security-headers.ts (applied to all responses)
  └──────────────────┘
```

---

## Key Files and Responsibilities

### Server Layer (`src/server/`)

| File | Responsibility |
|---|---|
| `server.ts` | Main HTTP server: startup, routing, SSE hubs |
| `security-middleware.ts` | Request-scoped middleware builder — auth, origin, rate limits |
| `security-headers.ts` | Baseline security headers on all responses |
| `secure-response.ts` | JSON responder with redaction, output limiting, stable error codes |
| `secure-sse.ts` | SSE connection wrapper with connection limiting |
| `observability-stream-hub.ts` | Shared producer for observability SSE stream |
| `session-stream-hub.ts` | Tailers for per-session SSE streams |
| `http-limits.ts` | Header/body size limits, request validation |
| `cookie-utils.ts` | HttpOnly/Secure/SameSite cookie parsing and creation |
| `auth-routes.ts` | Session exchange and logout route handlers |
| `security-alerts.ts` | Passive health assessment and security status |

### Security Layer (`src/security/`)

| File | Responsibility |
|---|---|
| `inspector/route-policy.ts` | Route registry — every route must be registered |
| `inspector/security-context.ts` | Per-request security context with permissions |
| `inspector/authorization.ts` | Permission-based route authorization |
| `inspector/auth-store.ts` | Hash-only token storage with atomic writes |
| `inspector/auth-service.ts` | Token CRUD, validation, doctor, rotation |
| `inspector/browser-session-store.ts` | In-memory browser session management |
| `inspector/host-policy.ts` | Host header validation against allowlist |
| `inspector/origin-policy.ts` | Origin/Fetch Metadata validation |
| `inspector/client-address.ts` | Proxy-aware client address resolution |
| `inspector/remote-access-policy.ts` | Remote access validation and TLS enforcement |
| `inspector/rate-limiter.ts` | Pre-auth and post-auth token bucket rate limiters |
| `inspector/connection-limiter.ts` | Per-principal and per-address connection caps |
| `redaction/secret-detector.ts` | Regex-based secret detection in JSON responses |
| `credentials/credential-store.ts` | Encrypted credential storage |
| `credentials/credential-reference.ts` | Stable credential references |
| `credentials/credential-migration.ts` | Legacy env-var/config migration |
| `supply-chain/dependency-policy.ts` | Lifecycle script and advisory management |
| `supply-chain/security-exceptions.ts` | Time-bounded exception tracking |
| `supply-chain/package-verifier.ts` | Artifact integrity verification |

### Config Layer (`src/config/`)

| File | Responsibility |
|---|---|
| `mutation.ts` | Atomic config mutation with provenance |
| `signing.ts` | Config signing, trust evaluation, anti-rollback |

### Platform Layer (`src/security/platform/`)

| File | Responsibility |
|---|---|
| `user-state-paths.ts` | XDG-compliant platform state directory resolution |

---

## Data Flow Diagrams

### Authentication Flow

```
Client                    Middleware                  AuthService           AuthStore
  │                           │                           │                     │
  │  GET /api/graphs          │                           │                     │
  │  Authorization: Bearer X  │                           │                     │
  │──────────────────────────>│                           │                     │
  │                           │                           │                     │
  │                           │  validateToken(hash(X))   │                     │
  │                           │──────────────────────────>│                     │
  │                           │                           │  get(hash(X))       │
  │                           │                           │────────────────────>│
  │                           │                           │<────────────────────│
  │                           │                           │  StoredToken        │
  │                           │                           │                     │
  │                           │  {ok, token, permissions} │                     │
  │                           │<──────────────────────────│                     │
  │                           │                           │                     │
  │                           │  SecurityContext built     │                     │
  │                           │  POST /api/auth/session   │                     │
  │<──────────────────────────│                           │                     │
  │  Set-Cookie: session=...  │                           │                     │
```

### Security Status Flow

```
Client                    Middleware                  Server              Health Assessment
  │                           │                         │                       │
  │  GET /api/security/status │                         │                       │
  │  Authorization: Bearer X  │                         │                       │
  │──────────────────────────>│                         │                       │
  │                           │                         │                       │
  │                           │  auth OK → ctx           │                       │
  │                           │────────────────────────>│                       │
  │                           │                         │                       │
  │                           │                         │  assessSecurityHealth │
  │                           │                         │──────────────────────>│
  │                           │                         │<──────────────────────│
  │                           │                         │  SecurityHealthSnapshot│
  │                           │                         │                       │
  │  {"overall":"ok",         │                         │                       │
  │   "subsystems":[...]}     │                         │                       │
  │<──────────────────────────│                         │                       │
```

---

## Security Invariants

1. **All API routes require authentication.** No unauthenticated access to `/api/*` (except auth session exchange).
2. **Hash-only token storage.** Raw tokens are never persisted to disk.
3. **All JSON responses pass through the SecretDetector.** No raw secrets leak in API output.
4. **Config is signed in production.** Unsigned configs fail the security gate.
5. **Audit is append-only with hash chaining.** Tampering is detectable via verification.
6. **Rate limiting is always active.** Both pre-auth and post-auth limits are enforced.
7. **Connection limiting is always active.** SSE connection slots are capped.
8. **Loopback by default.** Remote access requires explicit configuration with TLS.
9. **Health endpoints are passive.** They never trigger verification, audits, or tests.
10. **All security output is redacted.** No credentials, hashes, tokens, or addresses in responses.
