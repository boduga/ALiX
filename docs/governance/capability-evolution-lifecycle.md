# ALiX Capability Evolution Lifecycle

> **Audience:** Operators, integrators
> **Part of:** P5.7e Documentation Freeze
> **See also:** [Adaptation Lifecycle](adaptation-lifecycle.md), [Governance Model](governance-model.md)

## Purpose

This document describes how ALiX analyzes its own capability topology to
produce health assessments, gap/overlap/drift detection, and evolution
proposals for human review.

## Capability Lifecycle States

```
emerging → active → mature → stagnant → declining → deprecated
```

| State | Meaning |
|-------|---------|
| `emerging` | Recently added, limited resolution history |
| `active` | Regular use, healthy resolution rate |
| `mature` | Stable, well-established, high resolution count |
| `stagnant` | Declining use, unresolved issues piling up |
| `declining` | Decreasing resolution rate, increasing revert rate |
| `deprecated` | Near-zero usage, candidate for removal |

## Analysis Types

### Health Analysis

- Computes lifecycle state per capability
- Uses trend-aware computation with 20% threshold for rising/falling/stable
- Considers: resolution count (30-day window), revert rate, keep rate, agent count

### Gap Analysis

- Detects demand-signal evidence for missing capabilities
- Sources: reflection reports with `capability_gap` recommendations
- Filters by signal strength (minimum 2 by default)

### Overlap Analysis

- Jaccard-based similarity between capability signal sets
- Reports consolidation candidates when overlap exceeds threshold
- Provides coverage scores (A→B, B→A) and shared signal counts

### Drift Analysis

- Detects scope creep by comparing original vs current capability scope
- Reports split candidates when drift magnitude exceeds threshold (default 0.5)

## Generation Pipeline

```bash
# 1. Generate the capability evolution report
alix capability-evolution report [options]

# 2. Review findings (read-only report output)
# Output: CapabilityEvolutionReport JSON

# 3. Generate investigation proposals from findings
alix adaptation generate --capability-evolution [--report <path>]

# 4. Proposals are created as pending create_improvement_issue
# 5. Human reviews and approves/rejects
```

## Governance Boundaries

- Capability evolution is **read-only** — it never mutates system state
- Evolution proposals are **investigation-only** — always `create_improvement_issue`
- All proposals start `pending` with `provenance: "auto"`
- No structural mutation (no agent card creation, no capability removal) happens automatically

## Related Documents

- [Adaptation Lifecycle](adaptation-lifecycle.md) — full proposal lifecycle
- [Governance Model](governance-model.md) — governance invariants
