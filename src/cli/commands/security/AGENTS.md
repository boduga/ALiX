# DOX — Security CLI commands

**Purpose:** `alix security`, `alix inspector auth`, `alix audit`, and
`alix credential` handler implementations. Extracted from the former
`../security.ts` megafile (#717); `../security.ts` is now a re-export barrel so
existing import paths (notably `src/cli.ts` and tests) are unchanged.

**Ownership:**
- `shared.ts` — `jsonMode`/`setJsonMode`, `parseDuration`, `auditLogPath`,
  `createFileAudit`, `createNoopMetrics`, `createAuthService`.
- `inspector-auth.ts` — `handleSecurityDoctor`, `handleInspectorAuth{Create,List,Rotate,Revoke,Doctor}`.
- `audit.ts` — `handleAuditVerify`, `loadHead`, `activateAuditChain`,
  `handleAuditActivate`, `handleAuditCheckpoint`, `handleAuditCheckpointVerify`.
- `credentials.ts` — `createCredentialStore`, `handleCredential{List,Get,Set,Delete,Migrate}`,
  `migrateBetweenBackends`.
- `supply-chain.ts` — `handleSupplyChain{LifecycleCheck,Exceptions,VerifyTarball}`.
- `doctor.ts` — `handleSecurityDoctorComprehensive`, `handleSecurityGate`.

**Local Contracts:**
- Each module stays ≤ 1,000 lines (leaf-extraction threshold, #717). New
  handlers belong in the matching submodule, not the barrel.
- `../security.ts` re-exports the public handler surface; do not add logic there.
- `jsonMode` is shared module-level state (`shared.ts`); handlers read the live
  binding and call `setJsonMode`. One CLI invocation runs exactly one handler.
- Audit writes remain fail-closed per the #685/#683 contracts (see `../AGENTS.md`
  and `src/audit/AGENTS.md`).
- `alix audit verify --all` verifies both chains in one command: the runtime v2
  chain (`AuditStore.verifyIntegrity`) and the governance per-record chain
  (`governance/audit-chain.ts` `verifyChain`). JSON mode returns
  `{ runtime, governance }` (#782).

**Work Guidance:**
- Moving a handler: keep the public name and re-export from `../security.ts`.
- Relative imports here are one level deeper than the old file (`../../../` to
  reach `src/`, `../` to reach `src/cli/commands/`).

**Verification:**
- `tests/security/audit/*` — verifier, activate, checkpoint, chain writer.
- `tests/cli/audit-cli-polish.test.ts` — format helpers imported from the barrel.
- `tests/cli/inspector-auth.test.ts`, `tests/security/inspector/*` — auth surface.
