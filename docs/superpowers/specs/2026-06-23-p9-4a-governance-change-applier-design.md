# P9.4a — GovernanceChangeApplier

> **Status:** SDS approved
> **Risk level:** Critical
> **Spec home:** `docs/superpowers/specs/2026-06-23-p9-4a-governance-change-applier-design.md`
> **Plan home:** `docs/superpowers/plans/2026-06-23-p9-4a-governance-change-applier.md`
> **Governs:** branch from `main` at the P9.3 merge base.

## Core framing

> P9.3 asks: *Should this proposal be allowed?*
> **P9.4a asks: *How do we safely apply an approved governance change?***

This is the first P9 phase that crosses into **governance mutation territory**. Every prior P9 phase (P9.0–P9.3) was read-only analysis, recommendation, proposal, or approval gate. P9.4a writes governance configuration files to disk.

### Non-negotiable invariant

```
Only approved governance_change proposals may mutate governance files.
Every mutation requires:
  validate → snapshot → pre-write hash check → atomic write → evidence → applied status
```

---

## Architecture

### Routing

`selectApplier()` in `src/cli/commands/adaptation.ts` routes by `proposal.target.kind`:

```ts
case "governance": {
  const applier = new GovernanceChangeApplier(cwd, snapshotStore, writer);
  return (p) => applier.apply(p);
}
```

Routing responsibility split:
- **`selectApplier`** — routes by `target.kind` (`"governance"` → `GovernanceChangeApplier`)
- **`GovernanceChangeApplier`** — validates `payload.kind` is supported for the current phase

Unsupported governance payload kinds fail **inside** `GovernanceChangeApplier`, not in `selectApplier`. The `"learning"` target.kind remains deferred (unchanged throw).

### Single applier, internal routing

Approach A: a single `GovernanceChangeApplier` class with kind-specific private methods. No strategy abstraction until the taxonomy grows beyond 4 kinds.

```
P9.4a SUPPORTED_KINDS = { "confidence_calibration", "lens_adjustment" }
```

Unsupported kinds fail clearly before any file I/O:

```
GovernanceChangeApplier does not support chain_restoration in P9.4a.
```

---

## Apply flow (complete)

```
approved governance_change proposal
  ↓
(1) validate proposal.status === "approved"
  ↓
(2) validate proposal.action === "governance_change"
  ↓
(3) validate payload.kind is in SUPPORTED_KINDS
  ↓                              ←── fail before any file I/O
(4) resolve target file path
  ├─ confidence_calibration → .alix/governance/calibration.json
  └─ lens_adjustment        → .alix/governance/lens-registry.json
  ↓
(5) read target file → compute validatedHash
  ↓
(6) validate schema (entries exist, expected shape)
  ↓
(7) validate expected current values (drift guard)
  ├─ confidence_calibration: entry.target === payload.target
  │                          entry.value === payload.currentCalibration
  └─ lens_adjustment:        entry.lens === payload.lens
  ↓
(8) acquire mutation lock (process-local, steps 8–16)
  ↓
(9) snapshot target file (atomic)
  ↓
(10) re-read target file → compute preWriteHash
  ↓
(11) assert preWriteHash === validatedHash    ← race/drift guard
  ↓                               ←── fail: "Target changed between validation and mutation"
(12) mutate target file (atomic)
  ├─ confidence_calibration:  entry.value = payload.suggestedCalibration
  └─ lens_adjustment:
       promote → status = "active"
       demote  → status = "demoted"
       retire  → status = "retired"; enabled = false
  ↓
(13) compute afterHash
  ↓
(14) record adaptation_applied evidence with:
  ├─ proposalId
  ├─ payload.kind
  ├─ targetFile
  ├─ snapshotId (snapshot.fingerprint)
  ├─ beforeHash (validatedHash)
  └─ afterHash
  ↓
(15) ProposalStore.update(id, { status: "applied" })
  ↓
(16) release mutation lock
```

---

## Failure table

| Step | Failure | System state |
|------|---------|-------------|
| 1–3 | Not approved, not governance, unsupported kind | No file I/O, no snapshot |
| 4 | Unknown kind (internal error) | No file I/O, no snapshot |
| 5 | Target file missing/unreadable | No snapshot |
| 6 | Schema invalid | No snapshot |
| 7 | Current value drift (`expected 0.7, found 0.65`) | No snapshot |
| 8 | Lock acquisition fails (another mutation in progress) | No snapshot, no mutation |
| 9 | Snapshot write fails (atomic) | No snapshot, target unchanged |
| 10–11 | Pre-write hash mismatch | Snapshot exists, target unchanged |
| 12 | Mutation write fails (atomic) | Snapshot exists, target unchanged |
| 14 | Evidence recording fails | Mutation applied, proposal stays `approved`. Best-effort `adaptation_failed` evidence recorded. |
| 15 | ProposalStore.status update fails | Mutation applied, evidence exists, proposal stays `approved`. Best-effort `adaptation_failed` evidence recorded with reason `status_update_failed`. |

**Key safety properties:**
- Mutation lock serializes governance writes — no concurrent mutations on overlapping files.
- Snapshot is atomic — no partial snapshot file. Use write-tmp → fsync → rename.
- Mutations are atomic — no partial target file. Use write-tmp → fsync → rename.
- Snapshot is taken **after** validation, **under the lock**, **before** mutation. A snapshot always means "a valid, about-to-be-mutated file."
- Validation re-reads the file before writing (pre-write hash check) to catch drift between validation and mutation.
- If evidence recording or status update fails after successful mutation, the proposal stays `"approved"` (not `"applied"`). A best-effort `adaptation_failed` evidence event is recorded (with `reason: "evidence_recording_failed"` or `"status_update_failed"`). The snapshot remains available for recovery/revert.

---

## Mutation lock

A process-local mutex serializes steps 8–16 of the apply flow:

```ts
private static lock: Promise<void> = Promise.resolve();

private async acquireLock(): Promise<void> {
  // Simple promise-chain mutex — serializes concurrent apply calls
  let release: () => void;
  const next = new Promise<void>((resolve) => { release = resolve; });
  const prev = GovernanceChangeApplier.lock;
  GovernanceChangeApplier.lock = next;
  await prev;
  return release!;
}
```

This prevents concurrent governance mutations within the same process. If two threads/operators call `apply()` simultaneously, the second one waits until the first completes. The lock is purely process-local — cross-process coordination is out of scope for P9.4a.

---

## Mutation logic

### confidence_calibration

Target file: `.alix/governance/calibration.json`

```json
{
  "calibrations": [
    { "target": "red_team", "value": 0.70 },
    { "target": "blue_team", "value": 0.65 }
  ]
}
```

Validation:
- `calibrations` is an array
- Find entry where `entry.target === payload.target`
- Assert `entry.value === payload.currentCalibration` (drift guard)

Mutation:
- Set `entry.value = payload.suggestedCalibration`

### lens_adjustment

Target file: `.alix/governance/lens-registry.json`

```json
{
  "lenses": [
    { "lens": "red_team", "status": "active", "enabled": true, "pv": 0.82 }
  ]
}
```

Validation:
- `lenses` is an array
- Find entry where `entry.lens === payload.lens`
- Assert entry exists (drift guard)

Mutation:
- `promote` → `status = "active"`
- `demote` → `status = "demoted"`
- `retire` → `status = "retired"`; `enabled = false`

PV is measured evidence, not a writable config field — P9.4a does not mutate it.

---

## SnapshotStore atomicity fix

The existing `SnapshotStore.save()` uses `writeFileSync` directly (no atomicity). P9.4a changes it to:

```
write content to .tmp file
fsyncSync(tmpFd)
renameSync(.tmp → final)
```

This ensures the snapshot on disk is either complete or absent — never partial. All existing appliers benefit from this fix.

---

## Revert support

Governance mutations produce snapshots through `SnapshotStore` — the same infrastructure P5.2e established. The existing `RevertApplier` can restore a governance config file from its snapshot without any changes:

- `SnapshotStore.loadVerified(proposalId)` verifies `contentHash` integrity
- `RevertApplier.apply()` writes the restored content to `snapshot.filePath`
- The evidence chain (`adaptation_snapshot_taken` → `adaptation_applied` → `adaptation_revert_*`) is intact

All governance mutation snapshots use the same contract (`proposalId`, `filePath`, `content`/base64, `contentHash`).

**Snapshot fingerprint is the canonical rollback reference.** RevertApplier restores by snapshot fingerprint, not by proposal lookup alone. This future-proofs multi-snapshot scenarios where a single proposal may produce multiple snapshots.

---

## Testing

### GovernanceChangeApplier unit tests

1. Rejects non-approved proposal
2. Rejects non-governance_change proposal
3. Rejects unsupported payload.kind (e.g. `chain_restoration`)
4. Rejects missing target file
5. Rejects invalid schema (wrong shape)
6. Rejects stale proposal (current value drift)
7. Rejects pre-write hash mismatch
8. Applies confidence_calibration successfully
9. Applies lens_adjustment promote successfully
10. Applies lens_adjustment demote successfully
11. Applies lens_adjustment retire successfully
12. Records evidence with snapshotId + beforeHash + afterHash on success

### Integration tests

13. Full end-to-end: real temp files, verify file changed, snapshot exists, evidence recorded
22. Revert governance mutation: approve → apply (verify file changed) → revert (verify original file restored) → verify contentHash matches snapshot

### SnapshotStore atomicity tests

14. Save writes via temp → rename (verify final path exists, .tmp does not)
15. Simulated write failure leaves no partial final snapshot

### Target-write atomicity tests

16. Failed calibration write leaves original calibration.json unchanged
17. Failed lens registry write leaves original lens-registry.json unchanged

### selectApplier routing tests (in adaptation CLI test file)

18. Routes `target.kind === "governance"` to GovernanceChangeApplier
19. Still throws for `target.kind === "learning"`
20. Unsupported governance payload kind fails inside applier, not selectApplier

### Sentinel coverage (in governance-sentinels vitest)

21. `governance-change-applier.ts` added to allowed-import lists

---

## File structure

### New files

| File | Responsibility |
|------|---------------|
| `src/adaptation/appliers/governance-change-applier.ts` | Single applier class, internal routing for supported kinds |
| `tests/adaptation/appliers/governance-change-applier.vitest.ts` | Unit + integration tests (tests 1–17, 22) |

### Modified files

| File | Change |
|------|--------|
| `src/adaptation/snapshot-store.ts` | `save()` becomes atomic (write-tmp → fsync → rename) |
| `src/cli/commands/adaptation.ts` | Add `case "governance"` to `selectApplier()`; update `default` message |
| `tests/adaptation/snapshot-store.vitest.ts` | Add atomicity tests (tests 14–15) |
| `tests/cli/commands/adaptation.vitest.ts` | Add routing tests (tests 18–20) |
| `tests/governance/governance-sentinels.vitest.ts` | Add new applier to allowed-import lists |

### No changes to

- P5 proposal type definitions (`adaptation-types.ts`)
- `ApprovalGate` — P9.4 consumes only already-approved proposals
- `EvidenceEventWriter` — reuses existing `recordAdaptationApplied`, `recordSnapshotTaken`, `recordAdaptationFailed`
- `RevertApplier` — governance snapshots use the same contract
- Any existing applier (`AgentCardApplier`, `SkillApplier`, `RevertApplier`)

---

## Explicitly out of scope

| Feature | Notes |
|---------|-------|
| `chain_restoration`, `policy_coverage`, `governance_integrity` | Deferred to P9.4b+ |
| Strategy/method abstraction per category | Deferred until 4+ supported kinds |
| Cross-process mutation lock | Process-local only for P9.4a |
| Auto-apply of governance proposals | Never — full propose→approve→apply lifecycle required |
| Git rollback or branch operations | Out of scope by design — ALiX adapts its own configuration |
| PV mutation in lens_adjustment | PV is measured evidence, not writable config |
