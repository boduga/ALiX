# Security CLI Commands

## Overview
Handler implementations for `alix security`, `alix inspector auth`, `alix audit`, and `alix credential`. The parent `../security.ts` barrel re-exports the public handler surface without adding logic `[../security.ts:handleSecurityDoctor]`. Each command module owns one CLI area and stays at or below 1,000 lines; new handlers belong in the matching submodule, not the barrel `[AGENTS.md:Ownership]`.

## Interface
- `jsonMode`, `setJsonMode`, `parseDuration`, `auditLogPath`, `createFileAudit`, `createNoopMetrics`, `createAuthService` — shared CLI state and Inspector auth wiring `[shared.ts:createAuthService]`.
- `handleSecurityDoctor` — legacy Inspector boundary-state report over `config.ui` and the auth store `[inspector-auth.ts:handleSecurityDoctor]`.
- `handleInspectorAuthCreate`, `handleInspectorAuthList`, `handleInspectorAuthRotate`, `handleInspectorAuthRevoke`, `handleInspectorAuthDoctor`, `handleInspectorAuthMigrate`, `handleInspectorAuthPrincipal`, `handleInspectorAuthReconcile` — operator credential and principal lifecycle subcommands `[inspector-auth.ts:handleInspectorAuthCreate]`.
- `handleAuditVerify`, `loadHead`, `activateAuditChain`, `handleAuditActivate`, `handleAuditCheckpoint`, `handleAuditCheckpointVerify` — runtime audit integrity, chain activation, signed checkpoints, and checkpoint verification `[audit.ts:handleAuditVerify]`.
- `createCredentialStore`, `handleCredentialList`, `handleCredentialGet`, `handleCredentialSet`, `handleCredentialDelete`, `handleCredentialMigrate`, `migrateBetweenBackends` — credential-store commands and backend migration `[credentials.ts:createCredentialStore]`.
- `handleSupplyChainLifecycleCheck`, `handleSupplyChainExceptions`, `handleSupplyChainVerifyTarball` — lifecycle-script allowlists, advisory exceptions, and tarball verification `[supply-chain.ts:handleSupplyChainLifecycleCheck]`.
- `validateSecurityExceptionsDocument`, `handleSecurityDoctorComprehensive`, `handleSecurityGate` — comprehensive passive diagnosis and the acceptance gate `[doctor.ts:handleSecurityDoctorComprehensive]`.
- The `../security.ts` barrel exports every public handler above `[../security.ts:handleSecurityDoctor]`.

## Invariants
- `jsonMode` is shared module-level state; every handler calls `setJsonMode(args.includes("--json"))` before emitting output, and exactly one handler runs per CLI invocation `[shared.ts:jsonMode]` `[shared.ts:setJsonMode]`.
- `parseDuration` accepts only `<integer><s|m|h|d>` and returns `null` for any other shape `[shared.ts:parseDuration]`.
- Inspector enrollment validates all `--workspace` values through `canonicalWorkspaceId`, deduplicates canonical paths, and rejects the unsupported `--workspace=` form before constructing the auth service or creating a credential `[inspector-auth.ts:handleInspectorAuthCreate]`.
- Enrollment roles must appear in `AUTH_TOKEN_ROLES`; an unknown role exits with status 1 before any token creation `[inspector-auth.ts:handleInspectorAuthCreate]`.
- Rotation defaults `--grace` to `1h`, rejects a missing or invalid grace duration, and keeps the previous token valid for the grace window `[inspector-auth.ts:handleInspectorAuthRotate]`.
- Revocation requires an interactive `y` confirmation unless `--yes` is supplied `[inspector-auth.ts:handleInspectorAuthRevoke]`.
- `reconcile` reports incomplete enrollments, principals without active credentials, and dangling bindings; it deletes nothing `[inspector-auth.ts:handleInspectorAuthReconcile]`.
- `audit verify --all` requires both the runtime v2 chain and the governance per-record chain to verify; JSON output returns `{ runtime, governance }` `[audit.ts:handleAuditVerify]`.
- `audit checkpoint` activates a missing integrity chain before signing, then writes a signed checkpoint over the current head `[audit.ts:handleAuditCheckpoint]`.
- `audit checkpoint-verify` exits 1 on signature failure but exits 0 when the signature is valid even if the chain head differs, reporting the difference in its detail `[audit.ts:handleAuditCheckpointVerify]`.
- Supply-chain exceptions default to `check` (fail-closed); only an explicit `list` without `check` selects report-only mode `[supply-chain.ts:handleSupplyChainExceptions]`.
- Security exceptions must be an object with an `advisories` array whose entries have non-empty string ids; a present `expiry` must parse as a date `[doctor.ts:validateSecurityExceptionsDocument]`.
- The comprehensive doctor exits 0 for healthy, 1 for warnings, and 2 for failures or errors `[doctor.ts:handleSecurityDoctorComprehensive]`.
- The security gate passes only when every check is `ok`; production requires a signed config and an existing audit log, and a non-loopback bind requires `requireTlsForRemote` `[doctor.ts:handleSecurityGate]`.
- `migrateBetweenBackends` is idempotent for an already-selected target, never flips the backend selector after a failed copy, and records `migratedFrom` on each migrated entry `[credentials.ts:migrateBetweenBackends]`.

## Side Effects
- `createAuthService` creates the auth-state directory with mode `0o700`, constructs `AuthStore` over `<authStateDir>/auth-store.json`, and wires `AuthAuditStore` at `<authStateDir>/audit.jsonl` `[shared.ts:createAuthService]` `[shared.ts:auditLogPath]`.
- `createFileAudit` appends every auth event through `AuthAuditStore.append` and callers await it so a failed audit write fails the enclosing mutation `[shared.ts:createFileAudit]`.
- `inspector auth create` prints the plaintext token exactly once and records `token.created`; `rotate` prints the replacement token once and records `token.rotated` `[inspector-auth.ts:handleInspectorAuthCreate]` `[inspector-auth.ts:handleInspectorAuthRotate]`.
- `audit activate` calls `AuditStore.activateIntegrity`, sealing legacy records and starting the hash chain `[audit.ts:handleAuditActivate]`.
- `audit checkpoint` creates the output directory, loads or creates the checkpoint keypair (private key at `~/.local/state/alix-inspector/audit-checkpoint.key`), and writes the signed JSON checkpoint to the requested path `[audit.ts:handleAuditCheckpoint]`.
- `audit checkpoint-verify` reads the checkpoint and `head.json`, auto-imports its own public key, and verifies the signature and anchored head `[audit.ts:handleAuditCheckpointVerify]`.
- `credential set` writes the secret to the credential store and persists a `cred://` reference into the user config `apiKeys`; `credential delete` removes the store entry and best-effort deletes the config reference `[credentials.ts:handleCredentialSet]` `[credentials.ts:handleCredentialDelete]`.
- `credential migrate --to` writes every entry to the target backend, updates the stored backend selector, and scrubs the plain-file source when it was the origin `[credentials.ts:migrateBetweenBackends]`.
- Every handler terminates the process with `process.exit` using the status its verification or gate result dictates `[doctor.ts:handleSecurityGate]` `[supply-chain.ts:handleSupplyChainLifecycleCheck]`.

## Verification
- Run: `pnpm test`
