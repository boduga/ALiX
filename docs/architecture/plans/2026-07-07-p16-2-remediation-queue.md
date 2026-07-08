# P16.2 — Governance Remediation Queue

**Date:** 2026-07-07
**Status:** Plan
**Spec:** `docs/architecture/specs/2026-07-07-p16-2-remediation-queue.md`

Pure mapper: P16.1 recommendations → batched remediation proposals. No store, no CLI, no lifecycle transitions.

## Task 1 — remediation-queue.ts

Exports `createRemediationProposalsFromRecommendations(recommendations, options?)`.

Batches by (responseKind, severity, windowStart, windowEnd). Deterministic proposalId encoding batch dimensions. Empty recommendations → empty output. Status always "open".

## Task 2 — Tests

| # | Test |
|---|------|
| 1 | Empty recommendations → empty proposals |
| 2 | Single recommendation → single proposal with open status |
| 3 | Same-kind+severity → one batched proposal |
| 4 | Different severities → separate proposals |
| 5 | Proposal IDs deterministic (same input → same id) |
| 6 | Duplicate source IDs → no duplicate proposal |
| 7 | Severity rolls up (highest in batch) |
| 8 | Evidence refs deduped + sorted |
| 9 | Includes windowStart/windowEnd on proposal |
| 10 | proposalId changes when window changes |
| 11 | createdAt uses injected options.now |
| 12 | responseKind typed as union, not string |
| 13 | Pure module: zero store imports, zero audit imports |

## Acceptance

Empty → []. Batches by (responseKind, severity, window). Deterministic IDs. Severity rollup. No store/audit imports.
