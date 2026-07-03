# P10.10.4 — Security, Tools, Adaptation Baseline Providers

> **Status:** Proposed
> **Phase:** P10.10.4
> **Goal:** Complete subsystem coverage — add Security (persistent), Tools (runtime health), and Adaptation (persistent) baseline providers.

---

## 1. Problem

P10.10.2 added Governance and MemoryHealth. P10.10.3 added Skills, Agents, and Workflow. That leaves 3 production subsystems unobserved: Security, Tools, and Adaptation. Adding them brings coverage to all 8 production subsystems, completing the baseline intelligence layer.

---

## 2. Providers

| Provider | Subsystem | Type | Data source |
|----------|-----------|------|-------------|
| Security | `security` | Persistent | `.alix/policies/*.json`, `.alix/security/evidence.jsonl`, `.alix/credentials/` |
| Tools | `tools` | Runtime | Executive adapter (`buildToolHealth`) + `tool-registry` |
| Adaptation | `adaptation` | Persistent | `.alix/proposals/*.json` |

Security and Adaptation follow the Governance/Skills pattern (file-based persistent). Tools follows the Memory/Agent/Workflow pattern (adapter-based runtime health).

---

## 3. Security Provider

### Data source

Reads three locations under `.alix/`:
- `.alix/policies/` — policy definition files (JSON)
- `.alix/security/evidence.jsonl` — append-only evidence store (JSONL)
- `.alix/credentials/` — credential configuration files

All sections degrade gracefully. Missing directories, missing files, or malformed JSON never cause the provider to throw — affected metrics return 0.

### Metrics

```json
{
  "policyCount": 3,
  "evidenceRecordCount": 150,
  "invalidEvidenceRecords": 0,
  "credentialFiles": 2,
  "chainIntegrityOk": 1
}
```

`policyCount` is the number of `.json` files in `.alix/policies/`. `evidenceRecordCount` counts non-blank lines in the JSONL evidence file. `credentialFiles` counts files in `.alix/credentials/`. `chainIntegrityOk` is a boolean (0/1): reads consecutive evidence records and verifies that each record's `fingerprint` field chains to the next record's signature — 1 if all records chain, 0 if a break is found, the file is empty, or the file contains malformed JSON. `invalidEvidenceRecords` counts JSONL lines that failed to parse, distinguishing chain corruption from malformed data.

The provider never throws on malformed evidence — `chainIntegrityOk` becomes 0, `invalidEvidenceRecords` increments, and the remaining metrics are still collected.

### Baseline vs Current

- **Baseline**: First capture, cached
- **Current**: Re-reads files on each call
- **Comparison**: NumericComparator detects policy additions/removals, evidence volume drift, credential changes, and chain integrity degradation

---

## 4. Tools Runtime Health Provider

Named `ToolsRuntimeHealthProvider` to distinguish runtime health from a future configuration-based `ToolsBaselineProvider`.

### Data source

Dynamically imports the Executive adapter `buildToolHealth()` and reads tool registration data from `tool-registry`.

The existing `buildToolHealth()` performs secret scanning across data directories. The provider wraps it for the health score and supplements with tool count from the registry.

### Metrics

```json
{
  "registeredTools": 8,
  "healthyTools": 8,
  "failedTools": 0,
  "averageLatency": 0
}
```

`registeredTools` is the count from `ToolRegistry`. `healthyTools` defaults to the same count (no runtime failure tracking). `failedTools` defaults to 0 (failure tracking is in-memory only, not persisted). `averageLatency` is **reserved for future runtime instrumentation** — always 0 today because per-tool latency is not yet tracked. The zero signals "no data" rather than "zero latency."

### Availability vs Configuration

This provider answers "are the tools available and working?" — it reports runtime registration state. A future `ToolsBaselineProvider` could answer "which tools exist and what capabilities do they declare?" from configuration.

---

## 5. Adaptation Baseline Provider

### Data source

Reads `.alix/adaptation/proposals/*.json` files — one file per proposal, each containing the proposal status.

### Metrics

```json
{
  "proposalCount": 42,
  "pendingCount": 3,
  "approvedCount": 5,
  "appliedCount": 30,
  "rejectedCount": 2,
  "failedCount": 2
}
```

Each proposal file is read and its `status` field extracted. Counts are accumulated per status value. The six metrics sum the full lifecycle: pending (proposed), approved, applied (successfully executed), rejected (by human gate), failed (during apply). `proposalCount` is the total across all statuses.

### Baseline vs Current

- **Baseline**: First capture, cached
- **Current**: Re-reads directory on each call
- **Comparison**: NumericComparator detects proposal volume drift, lifecycle distribution changes

---

## 6. File Map

```
src/baseline/providers/
  security-provider.ts       — SecurityBaselineProvider (reads .alix/policies/, evidence, credentials)
  tools-health-provider.ts   — ToolsRuntimeHealthProvider (adapter-based)
  adaptation-provider.ts     — AdaptationBaselineProvider (reads .alix/adaptation/proposals/)

src/baseline/
  baseline-registry.ts       — factory updated: register Security, Tools, Adaptation

tests/baseline/providers/
  security-provider.vitest.ts
  tools-health-provider.vitest.ts
  adaptation-provider.vitest.ts

tests/baseline/
  baseline-sentinels.vitest.ts   — allowlist updated
  baseline-registry.vitest.ts    — 9-provider assertion
```

---

## 7. Hard Boundaries

- Security provider: no Executive imports (file-based like Governance/Skills) — fs+path only
- Adaptation provider: no Executive imports, no ProposalStore imports (pure fs I/O like Governance/Skills)
- Tools provider: may import Executive adapter and tool-registry only
- No framework changes (comparator, health-score, types, CLI dispatcher untouched)
- Security provider must track `chainIntegrityOk` metric separately from `evidenceRecordCount`
- Adaptation provider must track each of the 6 status counts independently
- Adaptation provider must maintain the invariant `proposalCount === pendingCount + approvedCount + appliedCount + rejectedCount + failedCount`

---

## 8. Test Strategy

| Provider | Tests | Method |
|----------|-------|--------|
| Security | 7 | Temp dir with fixture files, missing dir, baseline cache, current re-reads, evidence chain integrity, credentials dir, malformed evidence JSONL (chainIntegrityOk=0, provider still succeeds) |
| Tools | 4 | Metadata, baseline caching, current returns fresh data, fallback on import failure |
| Adaptation | 7 | Temp dir with fixture proposals (one per status), missing dir, baseline cache, current re-reads, malformed file graceful, proposalCount invariant (total === sum of status counts), all statuses covered |
| Registry | 1 | Asserts 9 providers with exact identities: Demo, Governance, Memory, Skills, Agents, Workflow, Security, Tools, Adaptation |
