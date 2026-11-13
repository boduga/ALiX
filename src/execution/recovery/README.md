# Crash Recovery Scanner & Repair

## Overview
Read-only integrity scanning and audited, idempotent repair for ALiX's durable stores under `{root}/.alix/` and the daemon stores under `~/.alix/`. `recovery-types.ts` defines the crash-point injection seam and the finding/report vocabulary; `recovery-scanner.ts` inspects stores and cross-file references without ever mutating state; `recovery-repair.ts` applies automated repairs for findings marked repairable and records each action in the audit trail. Crash injection exists so tests can abort a store mid-write and assert recovery behavior; production wires `NoopCrashInjector`.

## Interface
- `CrashPoint`, `CrashInjector`, `NoopCrashInjector`, `ThrowingCrashInjector`, `CrashInjectedError` [recovery-types.ts:CrashPoint] [recovery-types.ts:CrashInjector] [recovery-types.ts:ThrowingCrashInjector]
- `RecoveryFinding`, `RecoverySeverity`, `RecoveryFindingKind`, `RecoverySubsystem` [recovery-types.ts:RecoveryFinding] [recovery-types.ts:RecoveryFindingKind]
- `RecoveryReport` with severity counts, repaired/failed IDs, and a summary [recovery-types.ts:RecoveryReport]
- `RepairOptions` and `DEFAULT_REPAIR_OPTIONS` (dry-run default) [recovery-types.ts:RepairOptions] [recovery-types.ts:DEFAULT_REPAIR_OPTIONS]
- `scan(root, options?)` and `ScanOptions` for severity/subsystem filtering [recovery-scanner.ts:scan] [recovery-scanner.ts:ScanOptions]
- `reportSummary(report)` for CLI display [recovery-scanner.ts:reportSummary]
- `repair(root, options?)` returning a dry-run or executed report [recovery-repair.ts:repair]
- Repair handlers keyed by finding kind: `stale_temp_file`, `stale_lock`, `stale_pid_file`, `orphaned_daemon_task`, `inconsistent_cross_reference` [recovery-repair.ts:REPAIR_HANDLERS]

## Invariants
- `scan` is always read-only and never mutates state [recovery-scanner.ts:scan]
- Findings receive per-run monotonic IDs; the counter resets at each `scan` call [recovery-scanner.ts:nextId] [recovery-scanner.ts:scan]
- Corrupt data files are reported `critical` and marked non-repairable for manual review [recovery-scanner.ts:scanCoordinationStore] [recovery-scanner.ts:scanApprovalStore]
- Stale lock detection treats `EPERM` as a live process; only dead PIDs become findings [recovery-scanner.ts:isPidAlive]
- Legacy lock directories are classified from `meta.json`; only dead-PID locks are stale [recovery-scanner.ts:readLockMeta]
- Expired active ownership leases are reported `orphaned_ownership_lease` [recovery-scanner.ts:scanOwnershipRegistry]
- Chronicle index and entries are reconciled in both directions [recovery-scanner.ts:scanChronicleStore]
- Completed/failed coordination workers must have a result file, and aggregates must point at their own run id [recovery-scanner.ts:scanCrossFileConsistency]
- Aggregates with no run file are reported `aggregate_missing_run` [recovery-scanner.ts:scanCrossFileConsistency]
- Daemon tasks left `running` or `cancel_requested` on restart are reported as orphaned [recovery-scanner.ts:scanDaemonStores]
- Malformed event-log and audit lines are `info` `partial_event_log_line` findings; data loss is limited to that line [recovery-scanner.ts:scanEventLogs]
- Severity filtering is applied after all checks, and `bySeverity` counts only included findings [recovery-scanner.ts:scan]
- `repair` defaults to dry-run and mutates nothing unless `execute` is true [recovery-repair.ts:repair] [recovery-types.ts:DEFAULT_REPAIR_OPTIONS]
- Every successful repair appends an audit record; audit failure is best-effort and non-fatal [recovery-repair.ts:appendAuditRecord]
- `orphaned_ownership_lease` is marked repairable by the scanner but its handler returns false, escalating to manual review [recovery-repair.ts:REPAIR_HANDLERS]
- Repair never fabricates a missing chronicle entry file; it only adds valid on-disk entries to the index [recovery-repair.ts:REPAIR_HANDLERS]
- Repair is idempotent: an already-indexed chronicle entry is left unchanged and reported as not repaired [recovery-repair.ts:REPAIR_HANDLERS]
- Unhandled or throwing repairs land in `failedRepairIds` rather than aborting the run [recovery-repair.ts:repair]

## Side Effects
- `scan` reads store files and directories only; it writes nothing [recovery-scanner.ts:scan]
- Executed repairs can delete stale temp files and lock paths (`rmSync`) [recovery-repair.ts:REPAIR_HANDLERS]
- Stale-PID repair deletes the PID file and strips `pid` from `~/.alix/daemon.json` [recovery-repair.ts:REPAIR_HANDLERS]
- Orphaned daemon tasks are rewritten to `failed_orphaned` with a completion timestamp and error [recovery-repair.ts:REPAIR_HANDLERS]
- Chronicle repairs rewrite `.alix/chronicle/index.json` with an added stub entry [recovery-repair.ts:REPAIR_HANDLERS]
- Repairs append JSON lines to `.alix/audit/recovery.jsonl` [recovery-repair.ts:appendAuditRecord]

## Verification
- Run: `pnpm test`
