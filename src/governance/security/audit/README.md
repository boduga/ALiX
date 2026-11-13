# Audit Integrity Primitives

## Overview
Cross-process primitives that make the audit log tamper-evident: an exclusive
file lock for concurrent CLI/daemon writers, a hash-chained (v2) writer with a
reconcilable head sidecar and redaction, a streaming chain verifier with O(1)
state, and Ed25519 signed checkpoints stored in user state. Together they make
committed history append-only and verifiable without rewriting or truncating
records.

## Interface
- `acquire(lockPath, opts)` / `release(handle)` — exclusive `wx`-created lock with bounded backoff [audit-lock.ts:acquire]
- `LockHandle`, `AcquireResult`, `AcquireError`, `LockContent`, `LockOptions` — lock handle, result union, and PID/host/nonce/time metadata [audit-lock.ts:LockContent]
- `LockErrorCodes` / `LockErrorCode` — `LOCK_TIMEOUT`, `LOCK_STALE`, `LOCK_IO_ERROR`, `LOCK_ALREADY_HELD` [audit-lock.ts:LockErrorCodes]
- `AuditChainWriter` — `append`, `activateLegacy`, `readHead`, `list` [audit-chain-writer.ts:AuditChainWriter]
- `AuditChainWriterConfig` — `auditDir`, forwarded `lock` options, `onRecovery` sink [audit-chain-writer.ts:AuditChainWriterConfig]
- `AuditRecoveryEvent`, `AuditSidecarRecoveredEvent`, `AuditRecoveryFailureEvent` — out-of-band recovery telemetry [audit-chain-writer.ts:AuditRecoveryEvent]
- `verifyAuditLog(options)` / `VerifyOptions` — streaming verification with optional `requestedSeq` capture [audit-verifier.ts:verifyAuditLog]
- `VerificationFinding` / `VerificationResult` / `VerifiedRecordIdentity` — finding union, bounded result, verified tip identity [audit-verifier.ts:VerificationResult]
- `createCheckpoint(options)` / `verifyCheckpoint(options)` — Ed25519 checkpoint sign/verify [audit-checkpoint.ts:createCheckpoint]
- `generateCheckpointKeyPair`, `loadOrCreateCheckpointKeyPair`, `storeCheckpointPrivateKey`, `loadCheckpointPrivateKey` — key lifecycle [audit-checkpoint.ts:loadOrCreateCheckpointKeyPair]
- `importTrustedPublicKey`, `getTrustedPublicKey`, `clearTrustedKeys` — in-memory trusted-key registry [audit-checkpoint.ts:importTrustedPublicKey]
- `CheckpointPayload`, `SignedCheckpoint`, `CheckpointVerifyResult`, `CheckpointKeyPair` — checkpoint shapes [audit-checkpoint.ts:CheckpointPayload]

## Invariants
- Every append holds the cross-process lock across head reconciliation, sequence allocation, JSONL fsync, and head update [audit-chain-writer.ts:AuditChainWriter]
- The persisted JSONL chain is authoritative over the sidecar: a missing, stale, or conflicting head is verified from genesis before any sequence is allocated [audit-chain-writer.ts:AuditChainWriter]
- Recovery never truncates, rewrites, or discards committed records; corrupt, gapped, duplicated, or hash-broken history fails closed [audit-chain-writer.ts:AuditChainWriter]
- Record hash is `sha256("alix-audit-v1:" + canonicalBody + seq + prevHash)` with `"null"` for a null prevHash [audit-verifier.ts:computeRecordHash]
- `details` are redacted before canonicalization and hashing, so hashes cover redacted content [audit-chain-writer.ts:AuditChainWriter]
- `principalId` and `credentialRef` are exact-match allowlisted and stored verbatim despite substring-sensitive patterns [audit-chain-writer.ts:NON_SENSITIVE_KEY_ALLOWLIST]
- Recursive audit emission is refused by a per-instance guard, except for `audit.*` internal actions [audit-chain-writer.ts:AuditChainWriter]
- `onRecovery` telemetry failures never affect chain integrity or the append outcome [audit-chain-writer.ts:AuditChainWriter]
- A log with zero v2 records reports `no_chain` rather than OK, because legacy records carry no hashes [audit-verifier.ts:verifyAuditLog]
- Verification never throws; failures are structured findings [audit-verifier.ts:verifyAuditLog]
- Lock stale detection uses age past `staleThresholdMs` or a non-alive owner PID; default recovery is `"manual"`, not auto-break [audit-lock.ts:isStale]
- Lock backoff is bounded (`min(initial * multiplier^attempt, 5000)`) and capped by `timeoutMs` [audit-lock.ts:acquire]
- Lock release is idempotent and best-effort [audit-lock.ts:release]
- Checkpoint private key lives in user state (not project state), directory `0o700`, file `0o600` [audit-checkpoint.ts:storeCheckpointPrivateKey]
- Checkpoints are tamper-evident evidence, not a tamper-proof guarantee [audit-checkpoint.ts:createCheckpoint]
- Checkpoint verification rejects malformed payloads, missing signatures, and workspace mismatch before signature checking [audit-checkpoint.ts:verifyCheckpoint]
- Signature input is the domain-prefixed canonical (key-sorted) checkpoint payload [audit-checkpoint.ts:createCheckpoint]
- The verifier does not compare sequence/recordHash to the chain; callers must [audit-checkpoint.ts:verifyCheckpoint]
- `activateLegacy` is idempotent and performs its checks inside the lock [audit-chain-writer.ts:activateLegacy]

## Side Effects
- Creates/removes `<auditDir>/audit.lock` with `wx` exclusive create [audit-lock.ts:acquire]
- Creates `<auditDir>/` and writes `<auditDir>/head.json` atomically via temp file + rename [audit-chain-writer.ts:AuditChainWriter]
- Appends one fsynced JSONL line per record to `<auditDir>/audit.jsonl` [audit-chain-writer.ts:AuditChainWriter]
- Reads and writes the checkpoint private key under the user state directory [audit-checkpoint.ts:checkpointKeyPath]
- Mutates the module-level trusted-key `Map` [audit-checkpoint.ts:importTrustedPublicKey]
- Uses `process.pid`, `hostname()`, `randomUUID()`, `Date.now()`, and `node:crypto` SHA-256/Ed25519 [audit-lock.ts:buildLockContent]
- Sleeps between lock retries via `setTimeout` [audit-lock.ts:sleep]

## Verification
- Run: `pnpm test`
