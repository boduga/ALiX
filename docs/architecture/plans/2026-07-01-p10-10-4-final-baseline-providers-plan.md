# P10.10.4 — Final Baseline Provider Coverage

> **Derived from:** `docs/architecture/specs/2026-07-01-p10-10-4-final-baseline-providers-design.md`
> **Branch:** `feature/p10-10-4-final-baseline-providers`

---

## Context

P10.10.2 added Governance + Memory. P10.10.3 added Skills + Agents + Workflow. The baseline registry now has 6 providers covering 5/8 production subsystems. P10.10.4 adds the final 3: Security (persistent), Tools (runtime), Adaptation (persistent). After this, every major ALiX subsystem has a standardized observation interface.

## Tasks

### Task 1 — Security Baseline Provider

**Files:**
- `src/baseline/providers/security-provider.ts`
- `tests/baseline/providers/security-provider.vitest.ts`

**Deliverables:**
- `SecurityBaselineProvider` implementing `BaselineProvider`
- subsystem: `"security"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Persistent baseline — cached on first capture, current re-reads
- Pure fs I/O — no Executive imports

**Metrics:**
```json
{
  "policyCount": 3,
  "evidenceRecordCount": 150,
  "invalidEvidenceRecords": 0,
  "credentialFiles": 2,
  "chainIntegrityOk": 1
}
```

**Data sources:**
- `.alix/policies/*.json` — count files for `policyCount`
- `.alix/security/evidence.jsonl` — count JSONL lines for `evidenceRecordCount`; track parse failures as `invalidEvidenceRecords`; verify fingerprint links between consecutive records → `chainIntegrityOk` (1 if all records chain, 0 if break/malformed/empty)
- `.alix/credentials/` — count files for `credentialFiles`
- Each section gracefully degrades — missing dirs/files or malformed JSON never throw; affected metrics return 0
- Invariant: `evidenceRecordCount >= invalidEvidenceRecords`

**Tests (7):**
- 1. subsystem returns "security"
- 2. metadata: version, state, capabilities
- 3. baseline reads fixture files from temp dir
- 4. missing directory returns 0 metrics
- 5. baseline cached, current re-reads
- 6. evidence chain integrity detection
- 7. malformed evidence JSONL: chainIntegrityOk=0, invalidEvidenceRecords incremented, provider succeeds

---

### Task 2 — Tools Runtime Health Provider

**Files:**
- `src/baseline/providers/tools-health-provider.ts`
- `tests/baseline/providers/tools-health-provider.vitest.ts`

**Deliverables:**
- `ToolsRuntimeHealthProvider` implementing `BaselineProvider`
- subsystem: `"tools"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Runtime health — cached baseline, current re-reads live data
- Follows Executive adapter pattern (dynamic `await import`)

**Metrics:**
```json
{
  "registeredTools": 8,
  "healthyTools": 8,
  "failedTools": 0,
  "averageLatency": 0
}
```

**Data source:**
- Dynamic import of Executive adapter (`executive/adapters/tool-health.ts`)
- Dynamic import of `tools/tool-registry.ts` for registered tool count
- `averageLatency` defaults to 0 — **reserved for future runtime instrumentation**; zero signals "no data" rather than "zero latency"
- Graceful degradation on import failure

**Tests (4):**
- 1. subsystem returns "tools"
- 2. metadata correct
- 3. baseline caches
- 4. current returns fresh artifact

---

### Task 3 — Adaptation Baseline Provider

**Files:**
- `src/baseline/providers/adaptation-provider.ts`
- `tests/baseline/providers/adaptation-provider.vitest.ts`

**Deliverables:**
- `AdaptationBaselineProvider` implementing `BaselineProvider`
- subsystem: `"adaptation"`, version: `"1.0.0"`, state: `"ready"`, capabilities: `["capture"]`
- Persistent baseline — cached on first capture, current re-reads
- Pure fs I/O — no Executive imports, no ProposalStore import

**Metrics:**
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

**Data source:**
- `.alix/adaptation/proposals/*.json` — read each proposal file, extract `status` field, count by status
- Graceful degradation if directory doesn't exist or files are malformed
- Invariant: `proposalCount === pendingCount + approvedCount + appliedCount + rejectedCount + failedCount`

**Tests (7):**
- 1. subsystem returns "adaptation"
- 2. metadata correct
- 3. baseline reads fixture proposals from temp dir
- 4. missing directory returns 0 metrics
- 5. baseline cached, current re-reads
- 6. malformed proposal file degrades gracefully
- 7. invariant: proposalCount === sum of all status counts

---

### Task 4 — Registry + Sentinel + CLI Updates

**Files:**
- `src/baseline/baseline-registry.ts` — register all 3 new providers
- `tests/baseline/baseline-sentinels.vitest.ts` — update allowlists
- `tests/baseline/baseline-registry.vitest.ts` — 9-provider assertion
- `tests/cli/commands/baseline-cli.vitest.ts` — 9-provider JSON output

**Deliverables:**
- `createDefaultBaselineRegistry()` registers Security, Tools, Adaptation
- `discover()` returns 9 providers (Demo + 8 production subsystems)
- Registry test asserts exact provider identities: Demo, Governance, Memory, Skills, Agents, Workflow, Security, Tools, Adaptation
- All providers have `state === "ready"`
- Sentinel: ALLOWED_FS gets security-provider, adaptation-provider; ALLOWED_EXECUTIVE gets tools-health-provider
- CLI JSON health output asserts all 9 subsystems

---

## Dependency Graph

```
Security Provider (file-based, no Executive deps)
        │
Tools Health Provider (depends on executive tool-health adapter)
        │
Adaptation Provider (file-based, no Executive deps)
        │
        ▼
Registry Factory  ← now 9 providers
        │
        ▼
Sentinel + CLI Update
```

## Hard Boundaries

- Security provider: only `node:fs` imports (like Governance/Skills)
- Tools provider: only Executive adapter + tool-registry dynamic imports
- Adaptation provider: only `node:fs` imports (like Governance/Skills) — NO ProposalStore or adaptation module imports
- No framework changes (comparator, health-score, types unchanged)
- Security: `chainIntegrityOk` degrades to 0 on malformed evidence (never throws)
- Adaptation: `proposalCount === sum(all status counts)` invariant enforced

## Verification

```bash
npx vitest run tests/baseline/providers/security-provider.vitest.ts
npx vitest run tests/baseline/providers/tools-health-provider.vitest.ts
npx vitest run tests/baseline/providers/adaptation-provider.vitest.ts
npx vitest run tests/baseline/baseline-registry.vitest.ts
npx vitest run tests/baseline/baseline-sentinels.vitest.ts
npx vitest run
npx tsc --noEmit
```
