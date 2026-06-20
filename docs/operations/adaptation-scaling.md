# ALiX Adaptation Scaling

> **Part of:** P5.7d Scale Validation
> **Updated:** 2026-06-20
> **Benchmarks:** `docs/operations/benchmarks/`

## Known Acceptable Development Scale

These thresholds represent tested workloads on a typical development workstation.
Production deployments should establish their own limits based on hardware and load.

| Store | Tested to | Limiting factor |
|-------|-----------|-----------------|
| ProposalStore | 1,000 proposals | `list()` is O(n) — linear scan of all JSON files |
| EvidenceStore | 10,000 events | `verify()` is O(n) — full linear scan of JSONL |
| IntelligenceStore | 100 reports | `list()` is O(n) — `readdirSync` + sort |

## Known Bottlenecks

| Operation | Complexity | Impact |
|-----------|------------|--------|
| `ProposalStore.list()` | O(n) — reads all files | Slow at scale; N=1000 ~10ms, N=10000 estimated ~100ms |
| `EvidenceStore.verify()` | O(n) — full JSONL scan | All records read and re-hashed; N=10000 ~seconds |
| `EvidenceStore.query()` | O(n) — linear JSONL scan | No index; each query scans lines sequentially |

## CI Regression Thresholds

These thresholds are checked in CI mode (`ALIX_SOAK_LEVEL=ci`):

| Test | Threshold | Action |
|------|-----------|--------|
| ProposalStore write p95 | < 5ms per write | Alert if > 2x baseline |
| ProposalStore list() 100 items | < 10ms | Alert if > 3x baseline |
| EvidenceStore append p95 | < 10ms per append | Alert if > 2x baseline |
| EvidenceStore verify() 1000 items | < 500ms | Alert if > 3x baseline |

## Recommendations for P6

1. **`ProposalStore.list()` with status filter** — if P6 queries proposals by status frequently, consider indexing by status at the store level (separate files per status, or a manifest).
2. **EvidenceStore query performance** — if P6 does real-time queries, the linear JSONL scan will become a bottleneck. Consider adding an index file (separate JSONL with { fingerprint → offset } mappings).
3. **Compaction strategy** — if P6 generates high evidence volume, establish a regular compaction schedule. Compaction reduces the `verify()` scan time.
