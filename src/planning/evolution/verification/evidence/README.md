# Evolution Verification Evidence

## Overview
Constructs and stores A2.4 verification evidence: the immutable, governance-consumed objects distilled from verification reports. This package owns integrity hashing, expiry enforcement, provenance lineage, the operational report builder, and an append-only evidence ledger whose reads are fail-closed on expiry and integrity. It also re-exports the runtime execution evidence store so observation providers can import it at the evolution boundary.

## Interface
- `VerificationEvidenceInput` — input shape for evidence construction [verification-evidence.ts:VerificationEvidenceInput]
- `createVerificationEvidence(input)` — stamps `evidenceId`, defaults expiry to +90 days, and computes the integrity hash [verification-evidence.ts:createVerificationEvidence]
- `computeEvidenceIntegrityHash(evidence)` — canonical-stringify + SHA-256 under the `alix-evolution-v2:` domain prefix, excluding the hash field [verification-evidence.ts:computeEvidenceIntegrityHash]
- `isEvidenceExpired(evidence, currentTimeMs?)` [verification-evidence.ts:isEvidenceExpired]
- `markReverificationRequired(evidence)` [verification-evidence.ts:markReverificationRequired]
- `VerificationEvidenceLedger` — ledger interface (`store`, `get`, `listByProposal`, `listProposals`, `countExpired`, `listExpired`) [evidence-ledger.ts:VerificationEvidenceLedger]
- `InMemoryVerificationEvidenceLedger` — in-memory implementation [evidence-ledger.ts:InMemoryVerificationEvidenceLedger]
- `EvidenceNotFoundError`, `ExpiredEvidenceError`, `IntegrityMismatchError` [evidence-ledger.ts:EvidenceNotFoundError]
- `LineageTracker` (`addRecord`, `getLineage`, `length`, `clear`) accumulates provenance in insertion order [lineage-tracker.ts:LineageTracker]
- `VerificationReportBuilder` (`addExecutionLog`, `addReplayMetadata`, `addMetricResult`, `addDiagnostic`, `build`) [verification-report.ts:VerificationReportBuilder]
- `ExecutionEvidenceStore` re-export from the runtime layer [evidence-store.ts:ExecutionEvidenceStore]

## Invariants
- The integrity hash is canonical JSON + SHA-256 with the `alix-evolution-v2:` prefix and covers every field except `integrityHash` [verification-evidence.ts:computeEvidenceIntegrityHash]
- A missing `expiresAt` defaults to `verifiedAt` + 90 days; a non-ISO `verifiedAt` throws [verification-evidence.ts:createVerificationEvidence]
- An unparseable `expiresAt` is treated as expired (fail-closed) [verification-evidence.ts:isEvidenceExpired]
- Stored evidence is never modified or deleted by the ledger except for explicit expired-entry cleanup [evidence-ledger.ts:VerificationEvidenceLedger]
- `store` rejects a duplicate `evidenceId` and keeps a defensive deep copy [evidence-ledger.ts:InMemoryVerificationEvidenceLedger]
- `get` fails closed on missing, expired, or integrity-mismatched evidence [evidence-ledger.ts:InMemoryVerificationEvidenceLedger]
- `listByProposal` excludes expired evidence unless `includeExpired` is set, and silently skips integrity mismatches [evidence-ledger.ts:InMemoryVerificationEvidenceLedger]
- `LineageTracker` preserves insertion order, which reflects verification pipeline execution [lineage-tracker.ts:LineageTracker]
- Report `evidenceClass` is always `"projected"` [verification-report.ts:VerificationReportBuilder]
- `VerificationReport` is the operational/debug artifact; `VerificationEvidence` is the governance object [verification-report.ts:VerificationReportBuilder]

## Side Effects
- `createVerificationEvidence` and `VerificationReportBuilder.build` generate ids with `randomUUID()` [verification-evidence.ts:createVerificationEvidence] [verification-report.ts:VerificationReportBuilder]
- `createVerificationEvidence` and `markReverificationRequired` use the wall clock only through caller-supplied or defaulted time [verification-evidence.ts:createVerificationEvidence]
- `InMemoryVerificationEvidenceLedger` holds evidence in a process-local `Map` (no persistence) [evidence-ledger.ts:InMemoryVerificationEvidenceLedger]
- Integrity hashing uses `node:crypto` `createHash("sha256")` and `canonicalStringify` [verification-evidence.ts:computeEvidenceIntegrityHash]

## Verification
- Run: `pnpm test`
