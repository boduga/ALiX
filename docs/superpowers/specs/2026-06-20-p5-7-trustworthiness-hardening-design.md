# P5.7 — Trustworthiness Hardening

> **Status:** Spec — awaiting review
> **Milestone:** P5.7 (post-v0.5.0 hardening cycle)
> **Tag target:** `alix-p5.7-complete`
> **Builds on:** v0.5.0 Governed Adaptation Platform (P5.0–P5.6)
> **Blocks:** P6.0 Decision Influence
> **Risk level:** MEDIUM — hardening touches stores, appliers, and CLI paths; all changes must preserve backward compatibility

## Core Framing

**Core question:** Can ALiX prove its governance model is true?

P5.7 is not a feature milestone. It is a **trustworthiness milestone**. Every workstream answers a specific question about the governance model's correctness, explainability, security, scalability, or understandability.

```
P5.7a  Governance Audit           "Can we prove the rules?"
P5.7b  Lineage & Explainability   "Can we explain what happened?"
P5.7c  Security Audit             "Can the rules be bypassed?"
P5.7d  Scale Validation           "Do the rules still work under load?"
P5.7e  Documentation Freeze       "Can humans understand and operate the system?"
```

These five workstreams are independent and can be executed in parallel or sequence.

---

## P5.7a — Governance Invariant Audit + Mutation Path Hardening

**Core question:** Can ALiX prove its governance model is true?

### Verified Invariants

Each invariant must be independently verifiable — by a sentinel test, a structural code check, or a runtime assertion:

| # | Invariant | Verification method |
|---|-----------|-------------------|
| 1 | No auto-approve | Sentinel: grep/regex for status→approved outside `approval-gate.ts` |
| 2 | No auto-apply | Sentinel: grep/regex for status→applied outside `approval-gate.ts` |
| 3 | No auto-revert | Sentinel: `AutomaticProposalGenerator` must not produce `revert_proposal` |
| 4 | No generator imports ApprovalGate | Sentinel: import-graph check on both generators |
| 5 | No applier runs without status check | Sentinel: every applier's `apply()` must guard on `status === "approved"` |
| 6 | No capability mutation outside approved apply path | Sentinel: `selectApplier` routes each `target.kind` correctly |

### Sentinel Test Suite

A new file `tests/adaptation/governance-sentinels.vitest.ts` verifies architectural invariants at the import/code-structure level. These are "can't compile if broken" style tests that run in CI and fail immediately if a governance boundary is crossed.

### Mutation-Path Audit

Walk every code path from CLI command → handler → gate → applier and produce a documented map.

**Known gaps to fix:**

1. **SnapshotStore / EvidenceEventWriter not wired in `selectApplier`** — `AgentCardApplier` and `SkillApplier` are instantiated without `snapshotStore` or `writer`, making snapshotting a silent no-op when invoked through the CLI. Fix: wire both through `selectApplier`.

2. **ProposalStore has no schema validation** — `JSON.parse` is called generically; corrupt files crash `list()`. Fix: add `try`/`catch` per file in `list()` + basic shape validation on `save()` and `update()`.

3. **Evidence recording failures are silent** — `EvidenceEventWriter` catches all errors and returns `null`. Fix: log warnings when evidence recording fails (via injectable `Logger` interface).

### Acceptance Criteria

1. Sentinel tests pass in CI
2. Mutation-path audit report documents every mutation path and its governance checks
3. SnapshotStore + EvidenceEventWriter are wired through `selectApplier`
4. ProposalStore tolerates corrupt files without crashing `list()`
5. Evidence recording failures emit operator-visible warnings
6. Every mutation path has a dedicated regression test
7. Governance bypass attempts fail closed

---

## P5.7b — Proposal Lineage & Explainability

**Core question:** Can ALiX trace any proposal from creation through every lifecycle stage to its current state?

### Architecture

```
EvidenceStore, ProposalStore, EffectivenessStore, IntelligenceStore
    ↓
LineageBuilder ← ingests all stores, cross-links by fingerprint
    ↓
LineageGraph { rootId, completeness, nodes[], edges[], warnings[] }
    ↓
 ┌──────────────────────┬──────────────────────┐
 │ CLI Renderer         │ JSON Exporter        │
 │ (terminal tree)      │ (structured document)│
 └──────────────────────┴──────────────────────┘
 │
 └── Explainability API (explainProposal(id) → summary string)
```

### LineageGraph Model

```typescript
type LineageCompleteness = "partial" | "complete" | "broken";

interface LineageWarning {
  type:
    | "missing_evidence_fingerprint"   // proposal references evidence that doesn't exist
    | "orphan_effectiveness"           // effectiveness report exists, proposal missing
    | "missing_revert_snapshot"        // revert proposal references unknown source
    | "orphan_intelligence"            // intelligence report references unknown proposal
    | "stalled_cycle"                  // proposal stalled at a non-terminal state for too long
    | "integrity_mismatch";            // snapshot content hash verification failed
  message: string;
  sourceId: string;
  targetId?: string;
}

interface LineageNode {
  id: string;
  type:
    | "proposal" | "approval" | "application" | "effectiveness"
    | "revert" | "intelligence" | "priority" | "capability_evolution";
  label: string;           // human-readable: "effectiveness: KEEP, prop-123"
  timestamp: string;       // ISO 8601
  status?: string;         // lifecycle status at that node
  detail?: Record<string, unknown>;
}

interface LineageEdge {
  sourceId: string;
  targetId: string;
  relation:
    | "generated_from"    // proposal → evidence/intelligence that generated it
    | "approved_as"       // proposal → approval event
    | "applied_as"        // proposal → application event
    | "measured_as"       // proposal → effectiveness assessment
    | "reverted_by"       // proposal → revert proposal
    | "analyzed_in"       // proposal → intelligence report
    | "prioritized_in";   // proposal → priority ranking
}

interface LineageGraph {
  rootId: string;
  completeness: LineageCompleteness;
  nodes: LineageNode[];
  edges: LineageEdge[];
  warnings: LineageWarning[];
}
```

### LineageBuilder

- **Input:** a `rootId` (proposal ID) and optional `maxDepth`
- **Store ingestion:** walks ProposalStore, EvidenceStore, EffectivenessStore, IntelligenceStore to find all lifecycle events
- **Cross-linking:** uses `evidenceFingerprints[]` on proposals, `fingerprint` on evidence records, `sourceRecommendationType`/`sourceProposalId` on proposals
- **Output:** `LineageGraph` — a DAG rooted at the source proposal
- **No new storage needed** — the builder walks existing stores

### CLI Renderer

```bash
alix adaptation lineage prop-101
alix adaptation lineage prop-101 --depth 3
```

Output:
```
prop-101 — Investigate declining capability "code-review"
├─ 📄 proposal (pending → approved)
│  ├─ 👤 approved @ 2026-06-20T10:00:00Z
│  ├─ 🔧 applied @ 2026-06-20T10:01:00Z
│  ├─ 📊 effectiveness: KEEP (score 0.83)
│  ├─ 🧠 intelligence report 2026-06-20
│  └─ 📈 priority score: 0.83
Completeness: partial — proposal has not been reverted
```

### JSON Exporter

```bash
alix adaptation lineage prop-101 --json
alix adaptation lineage prop-101 --export lineage-prop-101.json
```

Output: a structured `LineageGraph` JSON document consumable by the Inspector UI, audit tools, or P6 subsystems.

### Explainability API

```typescript
function explainProposal(id: string): Promise<string>
```

Returns a human-readable summary of a proposal's current state:

```
Created from: capability evolution finding (gap, signal strength 3)
Approved by: human
Applied: yes
Effectiveness: keep (score 0.83)
Referenced by: 2 intelligence reports
Priority score contribution: 0.83
```

Implemented as a lightweight formatter over `LineageGraph`, not a separate pipeline.

### Acceptance Criteria

1. `alix adaptation lineage <id>` works for all proposal types
2. `--json` outputs valid `LineageGraph` JSON
3. `--export <file>` writes to file
4. LineageBuilder correctly cross-links proposal ↔ approval ↔ apply ↔ effectiveness ↔ revert ↔ intelligence
5. LineageGraph correctly reports `completeness` and surfaces integrity `warnings`
6. Explainability API returns a coherent summary for any proposal with ≥1 lifecycle event
7. All existing tests pass

---

## P5.7c — Security Boundary Audit

**Core question:** Can ALiX prove that its mutation, snapshot, and evidence paths cannot be exploited to bypass governance?

### Surface 1 — SnapshotStore Integrity

| Issue | Severity | Fix |
|-------|----------|-----|
| `load()` doesn't verify fingerprint | Medium | Add `loadVerified(id)` that calls `verify()` before returning; `RevertApplier` must use `loadVerified()` |
| No cross-process lock | Low | Add optional `AuditLock` reuse (aligned with EvidenceStore pattern) |

Design decision: keep `load()` as-is for callers that want raw access, add `loadVerified()` for callers that need integrity guarantees. The trust level is explicit in the method name.

### Surface 2 — ProposalStore Input Validation

| Issue | Severity | Fix |
|-------|----------|-----|
| `list()` crashes on corrupt files | High | Wrap each file parse in `try`/`catch`, log and skip corrupt entries |
| `save()` accepts structurally invalid proposals | Medium | Validate required fields, `ProposalStatus`, and `ProposalAction` on save |
| `update()` spreads arbitrary patches | Medium | Validate resulting proposal shape after patch |

Architectural boundary: **ProposalStore validates shape; ApprovalGate validates lifecycle transitions.** The store ensures structural integrity; the gate enforces policy.

### Surface 3 — Evidence Chain Integrity

| Issue | Severity | Fix |
|-------|----------|-----|
| Evidence writer swallows errors silently | Medium | Log warnings through injectable `Logger` interface instead of silent catch |
| No operator command to verify evidence integrity | Low | Add or strengthen `alix evidence verify` command |

Design for the evidence verify command:
- If `alix evidence verify` already exists: add malformed-line reporting to output, format for operators
- If missing: add it, wrapping `EvidenceStore.verify()` with formatted report

### Surface 4 — File System Boundaries

| Issue | Severity | Fix |
|-------|----------|-----|
| Path traversal possible through `target.id` in all appliers and stores | High | Add `assertSafePathComponent(input: string): void` — validates no `..`, `/`, `\`, `\0`, empty string, or absolute paths |

Design decision: `assertSafePathComponent` rejects rather than sanitizing. Sanitizers that rewrite (`../foo` → `foo`) can cause collisions. For governance/security, fail closed.

### Logger Interface

```typescript
interface Logger {
  warn(message: string, meta?: Record<string, unknown>): void;
}
```

Default implementation uses `console.warn`. Tests assert warnings via a spy/mock without patching global `console`. Used by:
- `EvidenceEventWriter` for failed evidence recording
- `ProposalStore` for skipped corrupt files
- `SnapshotStore` for integrity warnings

### Acceptance Criteria

1. `SnapshotStore.loadVerified()` exposed; `RevertApplier` uses it
2. `ProposalStore.list()` skips corrupt files; `save()`/`update()` validate shape
3. `ApprovalGate` remains the sole owner of lifecycle transition policy
4. Evidence writer failures emit operator-visible warnings through injectable `Logger`
5. `alix evidence verify` added or strengthened, not duplicated
6. Path components rejected via `assertSafePathComponent()`, never rewritten
7. All stores/appliers using IDs in file paths call the path assertion
8. Each fix has regression coverage

---

## P5.7d — Scale / Soak Validation

**Core question:** At what load do ALiX's governance and adaptation systems degrade, and are those limits acceptable?

### Modes

| Mode | Workload | Purpose |
|------|----------|---------|
| **CI mode** (`ALIX_SOAK_LEVEL=ci`) | 100 proposals, 1,000 evidence events, 10 intelligence reports | Regression detection in CI |
| **Benchmark mode** (`ALIX_SOAK_LEVEL=bench`) | 1,000 proposals, 10,000 evidence events, 100 intelligence reports | Full measurement, bottleneck discovery |

### Soak Scenarios

**Scenario 1: Proposal Store Under Load**
```
- Generate N proposals sequentially
- Measure: write latency per proposal, total time
- Run list() with and without status filter
- Run update() batch (approve all, apply all)
- Report: write latency curve, list latency increases, update throughput
```

**Scenario 2: Evidence Store Under Load**
```
- Append N adaptation-type evidence events
- Measure: append latency, total store size
- Query by type, time range, fingerprint
- Run verify() on full store
- Report: verify() time, query latency at each N
```

**Scenario 3: Lifecycle Throughput**
```
- Full propose → approve → apply cycle for N proposals
- Concurrent vs serial flows
- Report: throughput ceiling, bottleneck stage
```

### Measurements

Each scenario reports:
- **p50 latency** — typical performance
- **p95 latency** — tail performance
- **max latency** — worst case
- **throughput/sec** — sustained rate
- **heapUsed before/after** — memory growth
- **rss before/after** — process memory
- **store file size** — disk footprint

### Deliverable

A `docs/operations/adaptation-scaling.md` document with:

- **Known acceptable development scale:** tested thresholds for each store
- **Known bottlenecks:** structural O(n) operations (`list()` scan, `verify()` full scan, `query()` linear JSONL scan)
- **CI regression thresholds:** when to alert (e.g., write latency doubles from baseline)
- **Recommendations for P6:** which bottlenecks matter most before P6 depends on these stores

### Acceptance Criteria

1. Adaptation-specific soak tests exist in CI and benchmark modes
2. Each test reports p50, p95, max, throughput, memory, and disk measurements
3. CI mode runs in CI without making tests slow or flaky
4. `docs/operations/adaptation-scaling.md` documents known limits and bottlenecks
5. No pre-existing tests break

---

## P5.7e — Documentation Freeze

**Core question:** Does ALiX have enough structured documentation that an operator, auditor, or new contributor can understand the governance model without reading source code?

### Documents

| Document | File | Audience | Content |
|----------|------|----------|---------|
| Governance Model | `docs/governance/governance-model.md` | Operators, auditors, contributors | Governance invariants, mutation path map, trust boundary diagram, evidence chain |
| Adaptation Lifecycle | `docs/governance/adaptation-lifecycle.md` | Operators, integrators | Proposal status flow, approve→apply gate, revert path, effectiveness, intelligence |
| Capability Evolution Lifecycle | `docs/governance/capability-evolution-lifecycle.md` | Operators, integrators | Health analysis, gap/overlap/drift detection, proposal generation |
| Operational Runbook | `docs/operations/operational-runbook.md` | Operators | Normal operations, recovery playbooks, backup/restore, scaling |
| Governance Infrastructure | `docs/architecture/governance-infrastructure.md` | Contributors, architects | Code map, data flow, class hierarchy, test strategy |
| Decision Records Index | `docs/architecture/decision-records.md` | Contributors, architects | Catalog of key governance decisions with links to originating specs |
| Adaptation Scaling | `docs/operations/adaptation-scaling.md` | Operators | Scale limits, bottlenecks, CI thresholds (from P5.7d) |

### Document Format

Each document follows a consistent template:
- **Purpose** — one paragraph
- **Audience** — who should read this
- **Core model** — key concepts and structure
- **Lifecycle/flow** — step-by-step walkthrough
- **CLI reference** (if applicable)
- **Troubleshooting / recovery** (if applicable)
- **Related documents**

### Trust Boundary Diagram (Governance Model)

```
Generators (AutomaticProposalGenerator, CapabilityEvolutionProposalGenerator)
  ↓  status: "pending"
ProposalStore
  ↓
ApprovalGate  ←── Human Gate ──→ approve / reject
  ↓  status: "approved"
Appliers (AgentCardApplier, SkillApplier, RevertApplier)
  ↓
Snapshots (SnapshotStore)
  ↓
Evidence (EvidenceStore)
  ↓
Effectiveness (EffectivenessReporter)
  ↓
Intelligence (IntelligenceReporter)
```

Every mutation boundary is marked: **Human Required.**

### Recovery Playbooks (Operational Runbook)

Each failure mode has a structured recovery procedure:

| Failure | Detection | Recovery |
|---------|-----------|----------|
| Corrupt proposal file | `alix adaptation status` fails, line errors in `list()` | Quarantine corrupt file, run `proposal verify`, rebuild index, re-run status |
| Missing evidence | `alix evidence verify` reports orphan fingerprints | Trace proposal lineage, re-record evidence from snapshots if available |
| Failed apply | `alix adaptation show <id>` shows `status: "failed"` | Read error field, fix root cause, create new proposal |
| Failed revert | `alix adaptation revert-failed` evidence recorded | Check snapshot integrity, verify target file still exists |
| Snapshot integrity mismatch | `alix adaptation lineage <id>` shows `integrity_mismatch` warning | Content hash changed; snapshot corrupted or file mutated externally. Manual restore decision required |
| Lineage break | Lineage graph shows `completeness: "broken"` with `missing_evidence_fingerprint` | Evidence store may have been compacted; partial lineage is the intended state |

### Documentation Coverage Matrix

```
Subsystem                          Document

EvidenceStore                      governance-model.md
ProposalStore                      adaptation-lifecycle.md
ApprovalGate                       governance-model.md
RevertApplier                      adaptation-lifecycle.md
Capability Evolution               capability-evolution-lifecycle.md
Operational Recovery               operational-runbook.md
Mutation Path Audit                governance-model.md
Lineage Graph                      governance-model.md + governance-infrastructure.md
SnapshotStore                      governance-model.md + operational-runbook.md
IntelligenceStore                  adaptation-lifecycle.md
Proposal Prioritization            adaptation-lifecycle.md
```

### Relationship to Existing Docs

```
docs/user-manual.md              →  user-facing feature reference (existing)
docs/governance/*.md             →  governance model and invariant specification (new)
docs/architecture/*.md           →  internal architecture and data flow (extend existing)
docs/operations/*.md             →  operator procedures and incident response (new)
docs/superpowers/specs/*.md      →  design specs for each phase (existing)
docs/superpowers/plans/*.md      →  implementation plans (existing)
```

### Acceptance Criteria

1. All seven documents exist, pass markdown linting
2. Each document has a concrete example, not just abstract description
3. `docs/governance/governance-model.md` includes the full mutation path audit map (from P5.7a)
4. `docs/operations/operational-runbook.md` includes recovery playbooks for all known failure modes
5. No pre-existing documentation is contradicted; documents cross-link appropriately
6. Every governance-critical subsystem (ApprovalGate, ProposalStore, EvidenceStore, RevertApplier, CapabilityEvolutionReporter, LineageBuilder) is documented in at least one freeze document

---

## Release Boundary

P5.7 does not produce a new minor release. The version stays at `v0.5.0`. The milestone tag is:

```
git tag alix-p5.7-complete
```

After P5.7, the next development cycle is **P6.0 — Decision Influence**.

## Explicitly Out of Scope

| Topic | Reason |
|-------|--------|
| P6.0 Decision Influence | Separate milestone; P5.7 hardens the foundation P6 will build on |
| Performance optimization | P5.7d measures and documents; it does not optimize |
| New evidence types | P5.7 uses existing evidence types only |
| New proposal actions | No new `ProposalAction` values |
| Storage schema migrations | No breaking changes to existing stores |
| Automated recovery | Recovery procedures are operator-driven; automation deferred to P6 |
