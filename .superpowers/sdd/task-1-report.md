# Task 1: P30.1 — Lineage Types

**Status:** DONE

**Files created:**
- `src/governance/governance-lineage-types.ts` — Foundation types: 6 shallow phase refs (SignalRef, CandidateRef, OutcomeRef, TraceRef, ExplanationRef, ComplianceRef), LineageRecord with phasePresence (p24–p29) and 5 boundary flags, LineageIndex with 4 lookup maps
- `tests/governance/governance-lineage-types.test.ts` — 3 passing tests covering all 6 phase ref shapes, phasePresence booleans, and boundary flags

**Test summary:** 3/3 passing

**Types defined:**
- `SignalRef` — signalId, signalKind, windowEnd
- `CandidateRef` — candidateId, title, status
- `OutcomeRef` — outcomeId, candidateId, outcomeType
- `TraceRef` — outcomeId, candidateId, signalKind
- `ExplanationRef` — explanationId, type
- `ComplianceRef` — packageId, windowStart, windowEnd
- `LineageRecord` — lineageId, assembledAt, phasePresence (p24–p29 booleans), 6 optional shallow refs, 5 boundary flags (readOnly, noPolicyMutation, noThresholdChange, noAutoAdoption, noRanking)
- `LineageIndex` — byCandidateId, bySignalKind, byOutcomeType, byCompliancePackageId (all `Map<string, string[]>`)

**Key design decisions:**
- All phase refs are deliberately shallow — no full phase objects embedded
- Boundary flags are readonly literal `true` following existing P24/P25/P29 patterns
- Store-independent pure types — no stores, no fs, no execution adapters
