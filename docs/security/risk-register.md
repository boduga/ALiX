# Security Risk Register

**Date:** 2026-06-17
**Milestone:** P4.3-S
**Purpose:** Catalog of identified security risks, their likelihood, impact, mitigation, and residual risk after mitigation.

---

## Risk Assessment Methodology

| Factor | Definition |
|---|---|
| Likelihood | Probability of exploitation: Low (unlikely), Medium (possible), High (likely) |
| Impact | Damage if exploited: Low (inconvenience), Medium (data exposure), High (system compromise), Critical (full compromise / key material exposure) |
| Risk Level | Likelihood x Impact: Low, Medium, High, Critical |

---

## Risk Register

### R-001: Token Theft via File System Access

| Field | Value |
|---|---|
| **ID** | R-001 |
| **Category** | Authentication |
| **Description** | An attacker with filesystem read access to the auth state directory could read the auth-store.json file, which contains SHA-256 hashes of tokens. While raw tokens are never stored, hash analysis could reveal token patterns if tokens are weak. |
| **Likelihood** | Low |
| **Impact** | Medium |
| **Risk Level** | Medium |
| **Mitigation** | Hash-only storage (never raw tokens), 0o600 file permissions, 0o700 directory permissions, atomic writes via temp+rename |
| **Residual Risk** | Low — hashes alone cannot be used for authentication |

---

### R-002: Session Cookie Hijacking

| Field | Value |
|---|---|
| **ID** | R-002 |
| **Category** | Authentication |
| **Description** | Browser session cookies could be stolen via XSS or man-in-the-middle attacks, allowing session hijacking. |
| **Likelihood** | Low |
| **Impact** | High |
| **Risk Level** | Medium |
| **Mitigation** | HttpOnly (no JS access), Secure (HTTPS only), SameSite=Strict cookies. Session store is in-memory (not persisted to disk). |
| **Residual Risk** | Low — XSS remains a potential vector if the Inspector UI has vulnerabilities |

---

### R-003: Rate Limiter Memory Exhaustion

| Field | Value |
|---|---|
| **ID** | R-003 |
| **Category** | Network / DoS |
| **Description** | An attacker could create many unique client addresses to fill rate-limiter buckets, consuming memory. |
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Risk Level** | Medium |
| **Mitigation** | Token-bucket design with periodic cleanup of expired entries. Pre-auth limiter has bounded capacity. |
| **Residual Risk** | Low — buckets auto-expire and cleanup runs periodically |

---

### R-004: Config Tampering (Unsigned)

| Field | Value |
|---|---|
| **ID** | R-004 |
| **Category** | Config Trust |
| **Description** | Without config signing, an attacker with write access to `.alix/config.json` could modify security settings (e.g., disable auth, change allowed hosts). |
| **Likelihood** | Medium |
| **Impact** | Critical |
| **Risk Level** | High |
| **Mitigation** | Config signing with trust evaluation and anti-rollback. Production mode requires signed config (security gate enforcement). |
| **Residual Risk** | Medium — signing key compromise would allow forged signatures |

---

### R-005: Credential Exposure via Environment Variables

| Field | Value |
|---|---|
| **ID** | R-005 |
| **Category** | Credential |
| **Description** | API keys stored in environment variables or plaintext config files can be leaked via process inspection (`/proc/*/environ`), debug output, or config exports. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Level** | High |
| **Mitigation** | Encrypted credential store with migration from legacy storage. `config show` redacts keys by default. |
| **Residual Risk** | Medium — environment variables may still be used as fallback during migration |

---

### R-006: Audit Log Tampering

| Field | Value |
|---|---|
| **ID** | R-006 |
| **Category** | Audit |
| **Description** | An attacker with filesystem write access could modify or delete audit log entries to cover their tracks. |
| **Likelihood** | Low |
| **Impact** | High |
| **Risk Level** | Medium |
| **Mitigation** | Hash-chained JSONL audit with integrity verification, checkpointing, and external anchoring support. |
| **Residual Risk** | Low — chained hashes detect tampering; external anchoring provides independent verification |

---

### R-007: Supply-Chain Dependency Compromise

| Field | Value |
|---|---|
| **ID** | R-007 |
| **Category** | Supply Chain |
| **Description** | A compromised npm dependency could introduce malicious code into the ALiX package, potentially exfiltrating credentials or modifying behavior. |
| **Likelihood** | Low |
| **Impact** | Critical |
| **Risk Level** | Medium |
| **Mitigation** | Lifecycle script allowlist, advisory exception tracking, package verification, pinned CI actions, npm provenance, SBOM generation. |
| **Residual Risk** | Low — detection of novel compromises depends on advisory timeliness |

---

### R-008: DNS Rebinding Attack

| Field | Value |
|---|---|
| **ID** | R-008 |
| **Category** | Network |
| **Description** | A malicious webpage could use DNS rebinding to make the browser send requests to the local Inspector, bypassing origin checks. |
| **Likelihood** | Low |
| **Impact** | High |
| **Risk Level** | Medium |
| **Mitigation** | Host header validation rejects requests with unexpected Host headers. Loopback binding by default limits exposure to localhost. |
| **Residual Risk** | Low — requires attacker to control DNS and have a page open in the victim's browser |

---

### R-009: Proxy Header Spoofing

| Field | Value |
|---|---|
| **ID** | R-009 |
| **Category** | Network |
| **Description** | Without proper proxy trust configuration, an attacker could spoof X-Forwarded-For headers to bypass rate limits or impersonate internal addresses. |
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Risk Level** | Medium |
| **Mitigation** | CIDR-based proxy trust resolution. Headers from untrusted proxies are ignored. |
| **Residual Risk** | Low — requires misconfigured proxy CIDRs |

---

### R-010: SSE Connection Starvation

| Field | Value |
|---|---|
| **ID** | R-010 |
| **Category** | Network |
| **Description** | An attacker could exhaust all SSE connection slots, preventing legitimate clients from receiving observability or session streams. |
| **Likelihood** | Medium |
| **Impact** | Medium |
| **Risk Level** | Medium |
| **Mitigation** | Connection limiter with per-principal and per-address caps. SSE connections require authentication. |
| **Residual Risk** | Low — authenticated only, per-principal limits prevent single-account exhaustion |

---

### R-011: Key Rotation / Signing Key Compromise

| Field | Value |
|---|---|
| **ID** | R-011 |
| **Category** | Config Trust |
| **Description** | If the config signing key is compromised, an attacker could sign malicious configs that appear trusted. |
| **Likelihood** | Low |
| **Impact** | Critical |
| **Risk Level** | Medium |
| **Mitigation** | Config signing supports key rotation. Anti-rollback prevents downgrade to previously-signed malicious configs. |
| **Residual Risk** | Low — requires both key compromise and ability to write config files |

---

### R-012: Symlink / TOCTOU on Auth Store

| Field | Value |
|---|---|
| **ID** | R-012 |
| **Category** | Authentication |
| **Description** | An attacker could replace the auth-store.json path with a symlink to a sensitive file, causing data corruption or information disclosure. |
| **Likelihood** | Low |
| **Impact** | High |
| **Risk Level** | Medium |
| **Mitigation** | Symlink safety check (lstat + isSymbolicLink) before every write. Atomic writes via temp file + rename on same filesystem. |
| **Residual Risk** | Low — symlink check prevents path traversal |

---

### R-013: Malicious Project / Plugin / MCP Output

| Field | Value |
|---|---|
| **ID** | R-013 |
| **Category** | Supply Chain |
| **Description** | A malicious MCP server or project plugin could output crafted content designed to exploit the Inspector or Agent. |
| **Likelihood** | Medium |
| **Impact** | High |
| **Risk Level** | High |
| **Mitigation** | Output redaction via SecretDetector, bounded response sizes, secure JSON responder with limit enforcement. |
| **Residual Risk** | Medium — novel attack patterns may bypass current detection rules |

---

## Risk Summary

| Risk Level | Count | IDs |
|---|---|---|
| Critical | 0 | (none after mitigation) |
| High | 3 | R-004, R-005, R-013 |
| Medium | 10 | R-001, R-002, R-003, R-006, R-007, R-008, R-009, R-010, R-011, R-012 |
| Low | 0 | (all risks mitigated to Low residual or above) |

**After mitigation, no Critical residual risks remain. Three High residual risks (config tampering, credential exposure, malicious MCP output) require ongoing monitoring and future hardening.**

---

## Review Cadence

| Activity | Frequency |
|---|---|
| Risk register review | Quarterly |
| Threat model update | After major feature changes |
| Acceptance matrix validation | Every release |
| Security doctor run | Every release |
