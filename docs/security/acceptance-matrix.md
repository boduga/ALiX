# Security Acceptance Matrix

**Date:** 2026-06-17
**Milestone:** P4.3-Sg
**Purpose:** Maps each defined attack vector against the defensive control that mitigates it and the test that validates the mitigation.

---

## Acceptance Matrix

| # | Attack Vector | Category | Defensive Control | Implementation | Validation Test | Status |
|---|---|---|---|---|---|---|
| 1 | Unauthenticated API access | Auth | Bearer token + cookie session validation | `security-middleware.ts`, `auth-service.ts` | `tests/security/inspector/auth-service.test.ts` | Implemented |
| 2 | Token brute-force / replay | Auth | Rate-limited pre-auth, SHA-256 hashing | `rate-limiter.ts`, `auth-store.ts` | `tests/security/inspector/rate-limiter.test.ts` | Implemented |
| 3 | Token theft from store file | Auth | Hash-only storage (never store raw tokens) | `auth-store.ts` | `tests/security/inspector/auth-store.test.ts` | Implemented |
| 4 | Session hijacking via cookie theft | Auth | HttpOnly, Secure, SameSite=Strict cookies | `cookie-utils.ts`, `browser-session-store.ts` | `tests/security/inspector/browser-session.test.ts` | Implemented |
| 5 | Symlink attack on auth store | Auth | Symlink safety check before every write | `auth-store.ts` (writeAll) | `tests/security/inspector/auth-store.test.ts` | Implemented |
| 6 | Host header injection / rebinding | Network | Host policy: exact-match allowlist | `host-policy.ts` | `tests/security/inspector/host-policy.test.ts` | Implemented |
| 7 | DNS rebinding to localhost | Network | Validate host against allowed list, reject on mismatch | `host-policy.ts`, `security-middleware.ts` | `tests/security/inspector/host-policy.test.ts` | Implemented |
| 8 | Cross-origin request forgery | Network | Origin policy with configurable allowlist | `origin-policy.ts` | `tests/security/inspector/origin-policy.test.ts` | Implemented |
| 9 | Trusted proxy header spoofing (X-Forwarded-For) | Network | CIDR-based proxy trust resolution | `client-address.ts` | `tests/security/inspector/client-address.test.ts` | Implemented |
| 10 | Remote access without TLS | Network | requireTlsForRemote enforcement, loopback default | `remote-access-policy.ts` | `tests/security/inspector/remote-access-policy.test.ts` | Implemented |
| 11 | Oversized request / request smuggling | Network | HTTP header and body size limits | `http-limits.ts` | `tests/security/inspector/connection-limiter.test.ts` | Implemented |
| 12 | Rate-limit exhaustion (DoS) | Network | Pre-auth and post-auth token-bucket rate limiters | `rate-limiter.ts` | `tests/security/inspector/rate-limiter.test.ts` | Implemented |
| 13 | SSE connection exhaustion | Network | Connection limiter per principal and per address | `connection-limiter.ts` | `tests/security/inspector/connection-limiter.test.ts` | Implemented |
| 14 | Secret leakage in API responses | Data | Secret detection + redaction in JSON responses | `secret-detector.ts`, `secure-response.ts` | `tests/security/redaction/` | Implemented |
| 15 | Audit log tampering | Audit | Hash-chained JSONL audit with integrity verification | `audit/` module | `tests/audit/` | Implemented |
| 16 | Config tampering / unauthorized mutation | Config | Config signing, trust evaluation, anti-rollback | `config/signing.ts`, `config/mutation.ts` | `tests/config/signing.test.ts`, `tests/config/mutation.test.ts` | Implemented |
| 17 | Credential exposure in config files | Credential | Credential store with encryption, migration from legacy | `credentials/credential-store.ts`, `credentials/credential-migration.ts` | `tests/security/credentials/` | Implemented |
| 18 | Supply-chain / dependency compromise | Supply-chain | Lifecycle allowlist, advisory exceptions, package verification | `supply-chain/` | `tests/security/supply-chain/` | Implemented |
| 19 | Unpinned CI actions | Supply-chain | Pinned action SHAs, restricted GITHUB_TOKEN permissions | `.github/workflows/ci.yml` | CI workflow validation | Implemented |
| 20 | Artifact substitution in publish | Supply-chain | Pack-once flow, npm provenance | `scripts/release-gate.sh`, `.github/workflows/publish.yml` | Release gate validation | Implemented |
| 21 | Route auth bypass (unregistered route) | Auth | RoutePolicyRegistry coverage — all routes must register | `route-policy.ts` | `tests/security/inspector/route-policy.test.ts` | Implemented |
| 22 | Concurrent auth-store corruption | Auth | Atomic write (temp file + rename on same filesystem) | `auth-store.ts` | `tests/security/inspector/auth-store.test.ts` | Implemented |
| 23 | Stale/expired token exploitation | Auth | Token expiry check in AuthService | `auth-service.ts` | `tests/security/inspector/auth-service.test.ts` | Implemented |
| 24 | Excessive token creation | Auth | Token count cap (MAX_TOKEN_COUNT = 32) | `auth-store.ts` | `tests/security/inspector/auth-store.test.ts` | Implemented |
| 25 | Malformed audit JSONL data loss | Audit | Silent skip of malformed lines with structured error | `audit/audit-store.ts` | `tests/audit/` | Implemented |

---

## Risk Classification

| Severity | Count | Description |
|---|---|---|
| Critical | 6 | Unauthenticated access, secret leakage, audit tampering, config tampering, remote without TLS, supply-chain compromise |
| High | 9 | Token theft, session hijacking, host injection, DNS rebinding, origin forgery, proxy spoofing, connection exhaustion, route bypass, credential exposure |
| Medium | 7 | Rate-limit DoS, request smuggling, symlink attack, stale token, expired exceptions, unpinned CI, concurrent corruption |
| Low | 3 | Artifact substitution (provenance-mitigated), excessive tokens (capped), malformed JSONL (non-fatal) |

---

## Coverage Summary

| Control Domain | Attacks Mitigated | Tests |
|---|---|---|
| Authentication | 6 | 4 test files |
| Network | 7 | 7 test files |
| Data / Redaction | 1 | 1 test file |
| Audit | 2 | 1 test file |
| Config Trust | 1 | 2 test files |
| Credential | 1 | 1 test file |
| Supply Chain | 3 | 1 test file |

**Total: 25 attack vectors mitigated, 17 test files validating them.**
