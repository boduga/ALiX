# ALiX Inspector Threat Model

**Date:** 2026-06-17
**Milestone:** P4.3-S
**Methodology:** STRIDE per trust boundary

---

## Assets

| Asset | Sensitivity | Location |
|---|---|---|
| API bearer tokens | High — grant Inspector access | Auth store (hashed), client memory |
| Browser session cookies | High — grant UI access | Browser storage, server memory |
| Provider API keys | High — grant LLM API access | Credential store (encrypted), environment variables |
| Project configuration | Medium — controls Inspector behavior | `.alix/config.json`, `~/.config/alix/config.json` |
| Audit logs | Medium — operational visibility | `.alix/audit/`, platform state dir |
| Session data / event logs | Medium — contains agent activity | `.alix/sessions/` |
| Observability metrics | Low — operational data | `.alix/observability/` |
| Inspector UI | Medium — admin interface | `dist/src/ui/` |
| SSE streams | Medium — real-time event data | In-memory, server process |

---

## Threat Actors

| Actor | Motivation | Capability |
|---|---|---|
| **Network attacker (same machine)** | Access local Inspector, steal tokens | Can connect to localhost; no auth token |
| **Network attacker (same LAN)** | Access Inspector if bound to non-loopback | Can reach the bound port |
| **Malicious webpage (DNS rebinding)** | Exploit browser to reach localhost | Can make HTTP requests from victim's browser |
| **Compromised dependency / MCP server** | Exfiltrate data, execute code | Runs in same process as Inspector |
| **Insider with filesystem access** | Read secrets, modify configs, delete audit logs | Read/write access to project or state directories |
| **CI/CD attacker** | Inject malicious code into published artifact | Can modify workflow files or dependencies |
| **Physical attacker** | Access running process or filesystem | Direct machine access |

---

## Trust Boundaries

See `docs/security/architecture.md` for the full trust boundary diagram.

| Boundary | Description |
|---|---|
| **B1: External Network to Loopback** | Internet/WAN to localhost |
| **B2: Loopback to Inspector Server** | Localhost network to HTTP server |
| **B3: Inspector Server to File System** | Server process to platform state / project files |
| **B4: Inspector Server to Process Memory** | In-memory state (sessions, tokens, SSE) |
| **B5: Supply Chain to Build Artifact** | Dependencies and CI to published package |

---

## STRIDE Analysis

### B1: External Network to Loopback

| Threat | STRIDE | Description | Mitigation | Residual Risk |
|---|---|---|---|---|
| T1.1 | Spoofing | Attacker spoofs a trusted IP via proxy headers | CIDR-based proxy trust (client-address.ts) | Low |
| T1.2 | Tampering | Attacker modifies request in transit | TLS required for remote access | Low (with TLS) |
| T1.3 | Information Disclosure | Attacker observes traffic on non-loopback bind | Loopback binding by default | Low |
| T1.4 | Denial of Service | Attacker floods server with requests | Rate limiter (pre-auth), connection limiter | Low |

### B2: Loopback to Inspector Server

| Threat | STRIDE | Description | Mitigation | Residual Risk |
|---|---|---|---|---|
| T2.1 | Spoofing | Attacker on same machine connects without auth | Authentication required for all /api/* routes | Low |
| T2.2 | Spoofing | DNS rebinding from malicious webpage | Host header validation (host-policy.ts) | Low |
| T2.3 | Elevation of Privilege | Attacker bypasses auth on a misconfigured route | RoutePolicyRegistry — every route must be registered | Low |
| T2.4 | Information Disclosure | API responses leak secrets | SecretDetector on all JSON responses | Low |
| T2.5 | Information Disclosure | Error messages leak internal details | Stable error codes, not exception messages | Low |
| T2.6 | Denial of Service | SSE connection exhaustion | Connection limiter per principal/address | Low |
| T2.7 | Denial of Service | Oversized requests crash server | HTTP header/body size limits (http-limits.ts) | Low |
| T2.8 | Denial of Service | Rate-limit bucket exhaustion | Bounded token buckets with cleanup | Low |

### B3: Inspector Server to File System

| Threat | STRIDE | Description | Mitigation | Residual Risk |
|---|---|---|---|---|
| T3.1 | Tampering | Attacker modifies auth store to add tokens | 0o600 permissions, symlink safety checks | Low |
| T3.2 | Tampering | Attacker modifies or deletes audit logs | Hash-chained audit with verification | Low |
| T3.3 | Tampering | Attacker modifies config to disable security | Config signing, trust evaluation, anti-rollback | Medium — signing key compromise risk |
| T3.4 | Information Disclosure | Attacker reads auth store hashes | 0o600 permissions, hash-only storage | Low |
| T3.5 | Information Disclosure | Attacker reads credential store | Encrypted credential store | Low |
| T3.6 | Information Disclosure | Attacker reads raw config with API keys | Credential migration to encrypted store | Medium — migration in progress |

### B4: Inspector Server to Process Memory

| Threat | STRIDE | Description | Mitigation | Residual Risk |
|---|---|---|---|---|
| T4.1 | Information Disclosure | Memory dump exposes bearer tokens | Tokens only in memory during validation; not cached | Low |
| T4.2 | Information Disclosure | Core dump or debug output leaks data | No core dump policy, no debug logging in production | Low |
| T4.3 | Denial of Service | Memory leak from unbounded state | Periodic cleanup of expired rate-limit buckets, session expiry | Low |
| T4.4 | Elevation of Privilege | Malicious MCP server output exploits Inspector | Output redaction, bounded response sizes | Medium — novel patterns possible |

### B5: Supply Chain to Build Artifact

| Threat | STRIDE | Description | Mitigation | Residual Risk |
|---|---|---|---|---|
| T5.1 | Tampering | Malicious dependency injected via npm | Lifecycle script allowlist, advisory tracking | Low |
| T5.2 | Tampering | CI action compromised to inject code | Pinned action SHAs, restricted GITHUB_TOKEN | Low |
| T5.3 | Tampering | Published artifact substituted | npm provenance, pack-once flow | Low |
| T5.4 | Repudiation | Unauthorized publish without audit | npm provenance attestation | Low |
| T5.5 | Elevation of Privilege | Lifecycle script executes malicious code | Allowlist enforcement, pre-install verification | Low |

---

## Abuse Cases

### AC-1: Brute-Force Token Guessing
- **Scenario:** Attacker on same machine tries many bearer tokens
- **Control:** Pre-auth rate limiter per client address
- **Test:** `tests/security/inspector/rate-limiter.test.ts`

### AC-2: Session Replay After Logout
- **Scenario:** Attacker captures session cookie and replays after logout
- **Control:** In-memory session store, logout removes session immediately
- **Test:** `tests/security/inspector/browser-session.test.ts`

### AC-3: Config Rollback to Unsafe Settings
- **Scenario:** Attacker replaces signed config with older signed version that has weaker security
- **Control:** Anti-rollback — signed configs carry a monotonic revision number
- **Test:** `tests/config/signing.test.ts`

### AC-4: Audit Log Truncation
- **Scenario:** Attacker deletes the last N lines of the audit log
- **Control:** Hash-chained audit with integrity verification
- **Test:** `tests/audit/`

### AC-5: Credential Harvesting via Config Export
- **Scenario:** Attacker runs `alix config show --reveal-secrets`
- **Control:** `--reveal-secrets` is explicit opt-in, not default; credential store is encrypted
- **Test:** Manual review

---

## Security Controls Inventory

| Control | Type | Implementation |
|---|---|---|
| Bearer token authentication | Preventive | auth-service.ts, auth-store.ts |
| Cookie session authentication | Preventive | browser-session-store.ts, cookie-utils.ts |
| Host header validation | Preventive | host-policy.ts |
| Origin policy | Preventive | origin-policy.ts |
| Remote access policy | Preventive | remote-access-policy.ts |
| Rate limiting | Detective/Preventive | rate-limiter.ts |
| Connection limiting | Preventive | connection-limiter.ts |
| Secret detection/redaction | Detective/Corrective | secret-detector.ts, secure-response.ts |
| HTTP limits | Preventive | http-limits.ts |
| Route policy registry | Preventive | route-policy.ts |
| Config signing | Detective | config/signing.ts |
| Config mutation service | Detective | config/mutation.ts |
| Anti-rollback | Preventive | config/signing.ts |
| Audit hash chaining | Detective | audit/ |
| Credential encryption | Preventive | credentials/credential-store.ts |
| Supply-chain allowlist | Preventive | supply-chain/dependency-policy.ts |
| Lifecycle verification | Detective | scripts/verify-lifecycle-scripts.mjs |
| Package verification | Detective | supply-chain/package-verifier.ts |
| Security health (passive) | Detective | server/security-alerts.ts |
| Security doctor | Detective | cli/commands/security.ts |
| Security gate | Preventive | cli/commands/security.ts |

---

## Residual Risks

| Risk | Severity | Rationale |
|---|---|---|
| Signing key compromise | Medium | If the config signing private key is stolen, forged configs appear trusted |
| Novel MCP output exploits | Medium | Current redaction patterns may not catch future attack patterns |
| Environment variable leakage during migration | Medium | Legacy API keys may still be in env vars before full migration |
| Memory-based attacks (cold boot, DMA) | Low | Out of scope — requires physical access |
| Kernel-level compromise | Low | Defense-in-depth stops at the user-space boundary |

---

## Limits

1. **Not tamper-proof — tamper-evident.** The audit chain detects tampering but cannot prevent it at the filesystem level.
2. **Not a WAF.** Rate limiting and connection limiting provide basic DoS protection, not full web application firewall capabilities.
3. **Not a substitute for OS security.** File permissions and process isolation rely on the underlying operating system.
4. **Health is passive.** Security health endpoints report status without performing active verification.
5. **Local-first design.** Remote access is supported but requires explicit configuration; the default is loopback-only.
