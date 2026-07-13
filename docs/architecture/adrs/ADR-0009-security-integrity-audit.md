# ADR-0009: Security, Integrity, and Audit Architecture

**Status:** Accepted (2026-07-13)
**Deciders:** Architecture team
**Scope:** Evidence integrity, audit trail, credential isolation, path security, and trust verification

---

## 1. Context

ALiX's core differentiator is **trusted evolution** — the ability to change itself in a way that can be verified, audited, and reverted. This requires an integrity and audit architecture that spans every subsystem: evidence production, governance decisions, execution tracking, and session persistence.

The trust model must answer:

- **How does ALiX prove that a change happened?** (integrity)
- **How does ALiX prove why it happened?** (audit, lineage)
- **How does ALiX prove who/what authorized it?** (governance chain)
- **How does ALiX contain the blast radius of a compromised component?** (isolation, path security)
- **How does ALiX prevent tampering with its own evidence?** (hash chains, append-only stores)

The architecture emerged across multiple phases (P4, P14, A-series) and subsystems, producing a consistent pattern but no single reference that ties them together.

---

## 2. Decision

ALiX adopts a **multi-layer integrity architecture** with canonical hashing, append-only audit stores, evidence chain verification, and path-level security boundaries.

### 2.1 Architecture Overview

```
                     Trust Boundary
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
    ▼                     ▼                     ▼
 Canonical JSON      Integrity Hashing      Path Security
 (deterministic      (SHA-256 +             (ownership,
  serialization)      domain prefix)          assertion)
    │                     │                     │
    ▼                     ▼                     ▼
 Audit Log            Evidence Chain       Credential Vault
 (append-only         (immutable,          (encrypted at
  JSONL with           hash-verified        rest, isolated
  streaming queries)   lineage)             per session)
    │                     │                     │
    └─────────────────────┼─────────────────────┘
                          │
                          ▼
                 Protected Type Files
                 (structural integrity,
                  snapshot verification)
```

### 2.2 Canonical JSON Serialization

All cryptographic hashing in ALiX uses canonical JSON — a deterministic serialization format where:

- Object keys are sorted alphabetically at every nesting level
- Arrays preserve element order
- Non-finite numbers (`NaN`, `Infinity`) are rejected
- `undefined` values are rejected
- Functions and symbols are rejected
- Negative zero serializes as `0`

```typescript
// Canonical hash formula (used across all subsystems)
canonicalHash(value) = sha256("alix-audit-v1:" + canonicalStringify(value))
```

The canonical serializer lives in `src/security/audit/canonical-json.ts` and is imported by every evidence-producing subsystem (A2, A4, A5, chat recall, patch tracking).

**Rationale:** Standard `JSON.stringify` does not guarantee key ordering, making it unsuitable for cryptographic hashing. Without canonical JSON, the same logical object can produce different hashes across different JS engine versions or platform implementations.

Domain prefix (`"alix-audit-v1:"`) prevents cross-domain hash collisions — an evidence hash cannot be confused with a session hash, even if the serialized content happens to be identical.

### 2.3 Integrity Hashing Across Evidence Producers

Every evidence-producing subsystem follows the same pattern:

```
1. Build evidence object without integrityHash
2. Strip integrityHash defensively (in case present)
3. Serialize to canonical JSON (with undefined-value stripping)
4. Compute SHA-256(domain_prefix + canonicalStringify(evidence))
5. Attach integrityHash to evidence object
```

| Evidence | Domain Prefix | Producer |
|----------|--------------|----------|
| Governance evidence (A2) | `alix-evolution-v2:` | Verification |
| Execution evidence (A4) | `alix-evolution-execution-v1:` | Execution runtime |
| Observation evidence (A5) | `alix-evolution-observed-v1:` | Observation engine |
| Audit records | (natural JSONL line identity) | Audit store |
| Session data | `alix-audit-v1:` | Session persist |

**Rationale:** A single hashing contract across all evidence types means consumers (A3 governance, audit queries) can verify integrity without knowing which subsystem produced the evidence.

### 2.4 Append-Only Audit Store

Audit records are stored in `.alix/audit/audit.jsonl` as newline-delimited JSON, append-only. Queries stream the file line-by-line rather than loading it entirely into memory.

```
audit.jsonl  (append only)
     │
     ▼
AuditStore.query()
     │
     ├── Streams file with bounded memory (O(limit), not O(file size))
     ├── Returns newest-first results
     ├── Reports corruption (malformed lines) without failing
     └── Filters by action, graphId, approvalId
```

v2 audit records optionally include hash chains for tamper evidence:

```typescript
interface AuditRecordV2 {
  version: 2;
  seq: number;           // Monotonic sequence number
  prevHash: string;      // Hash of previous record
  recordHash: string;    // Hash of this record (seq + prevHash + data)
  action: string;
  timestamp: string;
  details: Record<string, unknown>;
}
```

**Rationale:** Append-only storage is the foundation of tamper evidence. A malicious actor who modifies an audit record cannot rewrite the append-only log without leaving traces (gaps in sequence numbers, broken hash chains). Streaming queries ensure the audit store works with files of any size without configurable limits.

### 2.5 Credential Isolation

Credentials are stored in `src/security/credentials/credential-store.ts` with:

- Per-session credential binding
- Encrypted storage at rest
- Migration support across credential formats
- Reference-based access (credentials are referenced by key, not embedded in code)

**Rationale:** Credentials are the highest-value target in the system. Isolating them in a dedicated store with encryption prevents accidental exposure through log output, error messages, or evidence artifacts.

### 2.6 Path Security

`src/security/path-assert.ts` provides path traversal protection:

```typescript
assertSafePath(userPath: string, allowedPrefix: string): void
```

This is used by all file-access subsystems to prevent path traversal attacks where a crafted relative path (`../../../etc/passwd`) escapes the intended workspace boundary.

### 2.7 Protected Type Files (ADR-0004)

Type definition files under `src/evolution/**/contracts/` and `src/security/**` are structurally protected. The snapshot-equal sentinel pattern detects unauthorized modifications:

- Allowed: adding new types, adding optional fields
- Forbidden: removing required fields, changing field types, removing types
- Requires new ADR: structural changes that alter contract semantics

### 2.8 Redaction and Safe Errors

`src/security/redaction/` provides:

- PII/secret detection in output (`secret-detector.ts`, `classifications.ts`)
- Safe error serialization that strips sensitive context (`safe-error.ts`)
- Configurable redaction policies per output channel (`redaction-policy.ts`)

---

## 3. Evidence Chain Verification

The evidence chain connects all phases of the governed evolution pipeline:

```
A2 Projected Evidence ──── integrityHash ────┐
                                              │
A4 Executed Evidence ───── integrityHash ─────┤──► Verification
                                              │
A5 Observed Evidence ──── integrityHash ─────┘
```

Each evidence artifact is independently verifiable through its `integrityHash`. A tampered evidence artifact fails hash verification before governance can act on it.

Lineage tracking supplements integrity hashing. Every evidence artifact carries a `lineage` array:

```typescript
lineage: [
  { step: "evolution_proposal", sourceId: "prop-123", sourceType: "proposal", timestamp: "..." },
  { step: "governance_decision", sourceId: "govd-456", sourceType: "proposal", timestamp: "..." },
]
```

The lineage is NOT integrity-protected by the containing evidence's hash — it IS part of the canonical JSON payload that feeds the hash. Modifying a lineage entry changes the hash, which fails verification.

---

## 4. Architectural Invariants

1. **Every evidence artifact has an integrity hash.** No evidence is emitted without verification capability.
2. **Integrity hashing uses canonical JSON.** Standard `JSON.stringify` is never used for hashing.
3. **Audit records are append-only.** Prior records are never modified, reordered, or deleted.
4. **Evidence is immutable once emitted.** No subsystem modifies evidence produced by another subsystem.
5. **Path traversal is structurally prevented.** Every file-access path goes through `assertSafePath()` or equivalent.
6. **Credentials are encrypted at rest.** No subsystem accesses plaintext credentials outside the credential store.
7. **Audit queries are streaming.** No audit query loads the entire file into memory.
8. **Corruption is detectable, not silent.** Malformed audit lines are reported, not silently skipped.

---

## 5. Consequences

### 5.1 Positive

- **Tamper-evident evidence:** Any modification to an evidence artifact is detectable through hash verification.
- **Cross-subsystem audit:** The append-only audit log provides a unified record of actions across evolution, governance, and execution.
- **Deterministic hashing:** Canonical JSON ensures the same evidence produces the same hash regardless of platform, JS engine version, or serialization order.
- **Bounded memory queries:** Streaming audit queries work on files of any size without OOM risk.
- **Blast radius containment:** Path security, credential isolation, and protected type files each limit the impact of a compromised component.

### 5.2 Negative

- **No cross-system hash chaining:** Each evidence artifact is independently hashed. There is no Merkle-tree-style structure linking A2, A4, and A5 evidence into a single chain. Cross-artifact verification requires checking each hash independently.
- **No proofs or zero-knowledge:** The integrity model is cryptographic-hashing-based, not cryptographic-proof-based. It detects tampering but cannot prove authenticity to a third party without access to the original data.
- **Audit corruption is reported, not repaired.** The audit store detects malformed lines but cannot fix them. Recovery requires external tooling.
- **Redaction is content-blind.** The redaction system uses pattern matching, not semantic understanding. It may miss context-dependent secrets or over-redact legitimate content.

---

## 6. Alternatives Considered

| Decision | Adopted | Rejected Alternative | Reason |
|----------|---------|---------------------|--------|
| Hash format | SHA-256 | SHA-512, BLAKE3 | SHA-256 is well-supported in Node.js crypto, produces reasonably sized hashes (64 hex chars), and is sufficient for tamper detection |
| Serialization | Canonical JSON | CBOR, Protocol Buffers | Canonical JSON is debuggable with standard tools, CBOR/Protobuf add binary complexity without benefit for local-first CLI |
| Hashing domain prefix | `alix-audit-v1:` | No prefix | Prefix prevents cross-domain hash collisions, enables domain-aware verification |
| Audit storage | Append-only JSONL | SQLite, PostgreSQL | JSONL is zero-dependency, trivially debuggable, works with standard Unix tools (grep, tail, jq) |
| Hash chain type | Per-record linked (v2) | Merkle tree | Per-record hashing is simpler and sufficient for an append-only log; Merkle trees add complexity for batch verification that the CLI use case doesn't require |
| Credential storage | File-based encrypted | OS keychain | OS keychain APIs vary across platforms and require native bindings; file-based encryption is portable with acceptable security for a local-first tool |
| Path security | Assertion function | Sandbox/chroot | Assertions are lightweight, testable, and composable; OS-level sandboxing is platform-specific and high-overhead |

---

## 7. Key References

- `src/security/audit/canonical-json.ts` — Canonical JSON serializer
- `src/audit/audit-types.ts` — Audit event type definitions (v1 + v2 hash-chained)
- `src/audit/audit-store.ts` — Append-only JSONL audit store with streaming queries
- `src/security/credentials/credential-store.ts` — Encrypted credential storage
- `src/security/path-assert.ts` — Path traversal protection
- `src/security/redaction/` — PII redaction, secret detection, safe errors
- `src/security/evidence/` — Evidence types and trust verification
- `src/security/supply-chain/` — Dependency verification
- `docs/architecture/adrs/ADR-0004-protected-type-files.md` — Structural type file protection
- `docs/architecture/adrs/ADR-0006-a-series-governed-evolution-pipeline.md` — Evidence producers in the evolution pipeline
