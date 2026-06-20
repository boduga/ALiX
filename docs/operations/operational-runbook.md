# ALiX Operational Runbook

> **Audience:** Operators
> **Part of:** P5.7e Documentation Freeze
> **See also:** [Governance Model](../governance/governance-model.md), [Adaptation Lifecycle](../governance/adaptation-lifecycle.md)

## Purpose

This document covers day-to-day operations, incident response procedures, and
recovery playbooks for the ALiX governance and adaptation systems.

## Normal Operations

### List pending proposals
```bash
alix adaptation list --status pending
```

### Show proposal details
```bash
alix adaptation show <proposal-id>
```

### Approve a proposal
```bash
alix adaptation approve <proposal-id>
```

### Batch approve
```bash
alix adaptation approve <id1> <id2> <id3>
```

### Apply an approved proposal
```bash
alix adaptation apply <proposal-id>
```

### Generate proposals from reflection
```bash
alix adaptation generate --reflection <path-to-report.json>
```

### Generate proposals from capability evolution
```bash
alix capability-evolution report --json
alix adaptation generate --capability-evolution
```

### Check adaptation pipeline health
```bash
alix adaptation status
```

### Trace proposal lineage
```bash
alix adaptation lineage <proposal-id>
alix adaptation lineage <proposal-id> --json
alix adaptation lineage <proposal-id> --export lineage.json
```

### Verify evidence store integrity
```bash
alix evidence verify
```

## Incident Response

### Playbook 1: Corrupt Proposal File

**Detection:**
- `alix adaptation list` crashes or shows partial results
- Error output mentions JSON parse errors

**Recovery:**
1. Identify the corrupt file:
   ```bash
   ls -la .alix/adaptation/proposals/
   # Look for partial or zero-byte files
   ```
2. Quarantine the corrupt file:
   ```bash
   mkdir -p .alix/adaptation/quarantine
   mv .alix/adaptation/proposals/<corrupt-file> .alix/adaptation/quarantine/
   ```
3. Verify the store loads normally:
   ```bash
   alix adaptation list
   ```
4. If the proposal was important, recreate it from evidence:
   ```bash
   alix evidence list --kind adaptation_proposed --json
   ```
5. Decision: re-propose or accept the loss.

**Expected result:** ProposalStore loads normally, corrupt file isolated for forensic analysis.

### Playbook 2: Missing Evidence

**Detection:**
- `alix evidence verify` reports missing fingerprints
- `alix adaptation lineage <id>` shows `completeness: "broken"` with `missing_evidence_fingerprint`

**Recovery:**
1. Confirm evidence compaction history:
   ```bash
   ls -la .alix/security/
   # Check for .compacted files
   ```
2. Trace proposal lineage to understand what's missing:
   ```bash
   alix adaptation lineage <proposal-id>
   ```
3. If snapshot exists, evidence can be re-recorded:
   - The snapshot files in `.alix/adaptation/snapshots/` contain pre-mutation state
   - Manual re-recording is possible but generally unnecessary
4. Document the gap for audit purposes.
5. If necessary, re-record critical evidence from snapshots.

**Expected result:** Gap is understood and documented. No data loss if all mutation paths still work.

### Playbook 3: Failed Apply

**Detection:**
- `alix adaptation show <id>` shows `status: "failed"`
- Error output during `alix adaptation apply <id>`

**Recovery:**
1. Read the error:
   ```bash
   alix adaptation show <proposal-id>
   # Look for the "error" field
   ```
2. Common causes and fixes:

   | Error | Cause | Fix |
   |-------|-------|-----|
   | `ENOENT: no such file or directory` | Target directory doesn't exist | Create the directory manually |
   | `already exists` | Agent card already exists (create path) | Use `update_agent_card` instead |
   | `Step not found` | Skill step name doesn't match | Verify skill JSON structure |
   | `Snapshot not found` | Snapshot file missing for revert | Verify snapshot store integrity |

3. Fix the root cause.
4. Create a new proposal (the failed one is terminal):
   ```bash
   alix adaptation propose <updated-report.json>
   # Or create via CLI
   ```
5. Approve and apply the new proposal.

**Expected result:** Root cause identified and resolved. New proposal created and applied.

### Playbook 4: Failed Revert

**Detection:**
- Evidence record `adaptation_revert_failed` exists
- Error output during `alix adaptation apply <revert-proposal-id>`

**Recovery:**
1. Check snapshot integrity:
   ```bash
   cat .alix/adaptation/snapshots/<source-proposal-id>.json | jq '.contentHash'
   ```
2. Verify the target file still exists at the expected path.
3. If the snapshot is corrupted:
   - The original change cannot be reverted automatically
   - Manual restore: edit the target file back to its pre-change state
   - Create a manual `update_agent_card` or `adjust_skill_definition` proposal to restore
4. If the target file was moved or deleted:
   - Create a fresh proposal to restore the intended state
   - The snapshot content is still available for manual reference

**Expected result:** Manual intervention determines whether automatic revert is possible.

### Playbook 5: Snapshot Integrity Mismatch

**Detection:**
- `alix adaptation lineage <id>` shows `integrity_mismatch` warning
- `SnapshotStore.loadVerified()` throws during revert attempt

**Recovery:**
1. The snapshot content hash no longer matches the stored content.
2. Possible causes:
   - Snapshot file was manually edited
   - File system corruption
   - Disk full during snapshot write
3. If the original file is still intact:
   - Take a new snapshot manually
   - Create a new revert proposal
4. If the original file has changed (external edit):
   - The snapshot is stale — a revert would overwrite subsequent changes
   - This requires a human decision: accept the change, or restore from backup

**Expected result:** Human evaluates whether the snapshot is safe to use or stale.

### Playbook 6: Lineage Break

**Detection:**
- `alix adaptation lineage <id>` shows `completeness: "broken"`
- Warning: `missing_evidence_fingerprint`

**Recovery:**
1. Check if evidence compaction has occurred:
   ```bash
   ls -la .alix/security/*.compacted 2>/dev/null
   ```
2. If compaction is the cause, the break is expected:
   - Old evidence records were consolidated
   - Lineage is partial by design after compaction
3. If compaction has not occurred:
   - Evidence records may have been deleted or corrupted
   - Check `alix evidence verify` for details
   - Restore from backup if available
4. Document the lineage break for audit purposes.

**Expected result:** The break is classified as expected (compaction) or investigated (data loss).

## Backup and Restore

### What to back up

```bash
.alix/adaptation/proposals/     # All proposals
.alix/adaptation/snapshots/     # Pre-mutation snapshots
.alix/adaptation/effectiveness/ # Effectiveness reports
.alix/adaptation/intelligence/  # Intelligence reports
.alix/security/                 # Evidence store (append-only)
```

### Backup procedure
```bash
tar -czf alix-adaptation-backup-$(date +%Y%m%d).tar.gz \
  .alix/adaptation/ \
  .alix/security/
```

### Restore procedure
```bash
tar -xzf alix-adaptation-backup-<date>.tar.gz
# Verify integrity
alix adaptation list
alix evidence verify
```

## Related Documents

- [Governance Model](../governance/governance-model.md) — governance invariants
- [Adaptation Lifecycle](../governance/adaptation-lifecycle.md) — proposal lifecycle
- [Adaptation Scaling](adaptation-scaling.md) — scale limits and benchmarks
