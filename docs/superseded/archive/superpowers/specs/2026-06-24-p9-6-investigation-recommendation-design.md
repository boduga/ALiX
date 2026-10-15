# P9.6 — InvestigationRecommendation Design

> **Status:** SDS — approved for planning
> **Builds on:** P9.4c (2 kinds deferred), P10.1 (priority context), P9.1/P9.5 (existing governance infrastructure)
> **Risk level:** LOW — additive only, new store, no mutation/apply path, no schema changes to existing types. P9.6 may append investigation lifecycle records to InvestigationStore but has no GovernanceChangeApplier path.

## Core distinction

| Layer | Purpose | Store | Apply path |
|-------|---------|-------|------------|
| `GovernanceRecommendation` (P9.1) | Mutation-capable advisory | `GovernanceStore` / `recommendations.jsonl` | `GovernanceChangeApplier` (P9.4) |
| `InvestigationRecommendation` (P9.6) | Operator investigation workflow | `InvestigationStore` / `investigations.jsonl` | None — operator resolves manually |

**P9.4 asked:** Can this governance recommendation safely mutate config?
**P9.6 asks:** If it cannot mutate config, how should an operator investigate it?

## Supported kinds

| Kind | Source | What it means | Mutation-capable invariant | Belongs in |
|------|--------|---------------|---------------------------|------------|
| `chain_restoration` | Drift / Integrity health | Chain coverage below threshold; operator diagnoses why proposals bypass provenance | ❌ No target file, no deterministic write, no drift guard, no revertable state | P9.6 InvestigationRecommendation |
| `governance_integrity` | Drift / Integrity health | Review pipeline metrics below threshold; operator investigates the pipeline | ❌ Same four failures | P9.6 InvestigationRecommendation |

3 mutation-capable kinds (`confidence_calibration`, `lens_adjustment`, `policy_coverage`) remain unchanged in `GovernanceRecommendation` / `GovernanceChangeApplier`.

## Data model

### InvestigationRecommendation

```typescript
export type InvestigationKind =
  | "chain_restoration"
  | "governance_integrity";

export type InvestigationStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "dismissed";

export type InvestigationSource =
  | "drift"
  | "integrity"
  | "health";

export interface InvestigationRecommendation {
  id: string;
  kind: InvestigationKind;
  status: InvestigationStatus;
  severity: "low" | "medium" | "high" | "critical";

  source: InvestigationSource;
  sourceArtifactId: string;
  evidenceRefs: string[];

  title: string;
  description: string;
  operatorGuidance: string;

  createdAt: string;
  updatedAt?: string;
  assignedTo?: string;
  resolvedAt?: string;
  resolution?: string;

  /** Set only for records read from GovernanceStore via compatibility adapter. */
  legacySource?: {
    store: "governance";
    recommendationId: string;
    parentReportId: string;
  };
}
```

Key differences from `GovernanceRecommendation.Recommendation`:
- No `confidence` — investigations are operator tasks, not scored recommendations
- No `expectedBenefit` / `risks[]` — those are mutation concepts
- `kind` instead of `category` — mirrors existing `GovernanceChangePayload` naming
- `operatorGuidance` is the actionable directive (what to investigate and how)
- Lifecycle fields: `createdAt`, `updatedAt`, `assignedTo`, `resolvedAt`, `resolution`

### Priority is a computed overlay

`priorityScore` is **not persisted** in `investigations.jsonl`. Priority is derived from P10.1's `ExecutivePriorityReport` at render/queue time and can change between runs. The dashboard or operator queue reads `listCompatibleInvestigations()` then joins with `ExecutivePriorityReport` to sort/filter.

## Store: InvestigationStore

File location: `.alix/governance/investigations.jsonl`

```typescript
class InvestigationStore {
  save(investigation: InvestigationRecommendation): Promise<void>;
  get(id: string): Promise<InvestigationRecommendation | null>;
  list(filter?: InvestigationFilter): Promise<InvestigationRecommendation[]>;
  updateStatus(id: string, status: InvestigationStatus, opts?: StatusUpdateOpts): Promise<void>;
}
```

**Append-only invariant:** `investigations.jsonl` is append-only JSONL (same pattern as `GovernanceStore.recommendations.jsonl`). `save()` appends a new record. `updateStatus()` appends a new version/event for the investigation — it does not rewrite in place. `list()` and `get()` resolve the latest version by `id` (last-wins within the same `id`).

## Compatibility adapter: `listCompatibleInvestigations`

```typescript
async function listCompatibleInvestigations(
  governanceStore: GovernanceStore,
  investigationStore: InvestigationStore,
  filter?: InvestigationFilter,
): Promise<InvestigationRecommendation[]> {
  const native = await investigationStore.list(filter);
  const legacyRecords = governanceStore.listRecommendations({
    categories: ["chain_restoration", "governance_integrity"],
  });

  const legacy = legacyRecords.map(toInvestigationRecommendation);

  // Dedupe: native IDs are UUIDs; legacy IDs are deterministic prefix
  // No collision possible
  return [...native, ...legacy].sort(byCreatedAtDesc);
}
```

**Legacy mapping rules:**

```
Recommendation.category === "chain_restoration"
  → InvestigationRecommendation.kind = "chain_restoration"

Recommendation.category === "governance_integrity"
  → InvestigationRecommendation.kind = "governance_integrity"
```

**Legacy ID:** `legacy-investigation-${recommendation.id}` — deterministic, no collision with native UUIDs.

**Legacy provenance:**
```typescript
legacySource: {
  store: "governance";
  recommendationId: recommendation.id;
  parentReportId: recommendation.sourceArtifactId;
}
```

**Invariants:**
- Read-only. No GovernanceStore mutation. No writes to investigations.jsonl.
- Old GovernanceStore records stay in place forever.
- No duplicate writes into investigations.jsonl.
- The compatibility adapter is the only bridge — `InvestigationGenerator` writes directly to `InvestigationStore`.

**Severity mapping for legacy records:**
- `chain_restoration` from drift findings: carry through drift finding's existing severity (`"high"` | `"critical"`)
- `chain_restoration` from integrity metrics: `currentRate < 30%` → `"high"`, else `"medium"`
- `governance_integrity` from drift: same as drift severity
- `governance_integrity` from integrity metrics: same rate-based mapping

## InvestigationGenerator

New producer in `src/governance/` (parallel to `governance-recommendation-generator.ts`), called by the governance recommendation generation pipeline.

- Creates `InvestigationRecommendation` directly
- Writes to `InvestigationStore`
- Does NOT write to `GovernanceStore`

### Generator coexistence rule

If both the legacy generator and the new `InvestigationGenerator` ran in the same pipeline, the compatibility adapter would show duplicates: one from `InvestigationStore` (native) and one from `GovernanceStore` (legacy wrapper).

**Rule:** During P9.6, the `InvestigationGenerator` is invoked only from the new investigation command/pipeline — not alongside legacy recommendation generation in the same run. The legacy generator continues to emit `chain_restoration` / `governance_integrity` `Recommendation` records into `GovernanceStore` as before, but the compatibility adapter dedupes against native records by matching on `sourceArtifactId`.

```typescript
// Dedupe rule: skip legacy record if a native InvestigationRecommendation
// already exists with the same sourceArtifactId and kind
function isDuplicate(legacy: LegacyRecord, native: InvestigationRecommendation[]): boolean {
  return native.some(
    (n) => n.sourceArtifactId === legacy.sourceArtifactId && n.kind === mapCategoryToKind(legacy.category),
  );
}
```

After all consumers have migrated to `InvestigationStore`, the legacy generator paths can be removed and the dedupe logic retired.

### Existing producers that will be migrated

The existing `governance-recommendation-generator.ts` has two paths that produce `chain_restoration` and `governance_integrity` recommendations:

1. **`generateDriftRecommendations`** (lines ~137-201): Maps drift findings with `driftType === "chain_coverage_drop"` to `category: "chain_restoration"`, and uncategorized high-severity findings to `category: "governance_integrity"`.

2. **`generateIntegrityRecommendations`** (lines ~223-278): Maps integrity report metrics below 60% threshold: `provenanceRate` → `chain_restoration`, `explanationRate` / `outcomeLinkRate` → `governance_integrity`.

The `InvestigationGenerator` will mirror these two paths, producing `InvestigationRecommendation` records instead of `Recommendation` records. Both generators coexist during the migration window; the legacy path continues to emit `Recommendation` records for backwards compatibility until all consumers read from `InvestigationStore`.

## P10.1 priority integration

Priority is a **computed overlay** at render/queue time:

```
read investigations (native + legacy)
  │
  ▼
read ExecutivePriorityReport from P10.1
  │
  ▼
join: governance subsystem priorityScore → each investigation
  │
  ▼
render/queue sorted by priority (P10.1) × severity × age
```

No priority persisted in `investigations.jsonl`. The join is a pure function. Stale priority is impossible by design.

## Relationship to P6.2 Operator Queue

The P6.2 Operator Queue (designed but never implemented) had a `RecommendationPriority: "investigate"` rank that surfaced investigation items as highest operator attention (`investigate → reject → defer → approve`). P9.6 reuses the concept but with a dedicated artifact type instead of overloading a generic queue item.

Future: P9.6's investigation queue and P6.2's operator queue may converge, but that's a cross-phase design decision deferred until both have shipped.

## File structure

```
Create:
  src/governance/investigation-types.ts     — InvestigationKind, InvestigationStatus, InvestigationRecommendation
  src/governance/investigation-store.ts     — InvestigationStore (append-only JSONL)
  src/governance/investigation-generator.ts — InvestigationGenerator (parallel to governance-recommendation-generator.ts)
  src/governance/investigation-compat.ts    — listCompatibleInvestigations adapter + legacy mapping
  tests/governance/investigation-store.vitest.ts
  tests/governance/investigation-generator.vitest.ts
  tests/governance/investigation-compat.vitest.ts

Modify:
  src/governance/governance-types.ts        — (if needed for export/import)
  src/governance/governance-recommendation-generator.ts — (optional — add note; producers unchanged for now)
```

CLI command structure — `alix governance investigate` sub-namespace:

```
alix governance investigate list                     — list investigations (terminal table)
alix governance investigate list --json              — JSON output
alix governance investigate list --kind chain_restoration  — filter by kind
alix governance investigate show <id>                — single investigation detail
alix governance investigate update <id> --status resolved --resolution "..."  — update lifecycle
alix governance investigate update <id> --assign "@operator" — assign investigation
```

## Acceptance criteria

1. `InvestigationRecommendation` type matches the data model exactly
2. `InvestigationStore.save()` appends to JSONL; `get()`/`list()` resolve latest version per `id`
3. `InvestigationStore.updateStatus()` appends a new version — does not rewrite in place
4. `listCompatibleInvestigations()` returns native + legacy records merged and sorted by `createdAt` desc
5. Legacy records carry deterministic `legacy-investigation-` IDs — no collisions with native UUIDs
6. Legacy records carry `legacySource` provenance
7. Legacy records are read-only — no GovernanceStore mutation, no writes to investigations.jsonl
8. `InvestigationGenerator` creates `InvestigationRecommendation` for `chain_restoration` and `governance_integrity` from drift findings
9. `InvestigationGenerator` creates `InvestigationRecommendation` for `chain_restoration` and `governance_integrity` from integrity metrics
10. `InvestigationGenerator` writes to `InvestigationStore`, not `GovernanceStore`
11. All existing tests pass — no schema changes to existing types
12. CLI commands available and functional for list/show/update

## Explicitly out of scope

| Feature | Belongs to | Reason |
|---------|-----------|--------|
| Removing `chain_restoration` / `governance_integrity` from `GovernanceChangePayload` | Future cleanup | Existing proposals may reference these kinds; removal risks breaking old records |
| Removing legacy paths from `governance-recommendation-generator.ts` | Future deprecation | Both generators coexist during migration; legacy removal is a separate phase |
| Operator queue convergence with P6.2 | Cross-phase design | Let both ship first, then decide on unification |
| CLI batch operations (bulk update, bulk dismiss) | Future | YAGNI — single-item CLI is sufficient for P9.6 |
| Auto-resolve after operator action | Future | P9.6 has no mutation/apply path. Auto-resolve requires workflow hooks |
