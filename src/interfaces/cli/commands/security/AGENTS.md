# DOX — Security CLI commands

**Purpose:** `alix security`, `alix inspector auth`, `alix audit`, and
`alix credential` handler implementations. `../security.ts` is the compatibility re-export barrel.

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
- Each module stays ≤ 1,000 lines. New
  handlers belong in the matching submodule, not the barrel.
- `../security.ts` re-exports the public handler surface; do not add logic there.
- `jsonMode` is shared module-level state (`shared.ts`); handlers read the live
  binding and call `setJsonMode`. One CLI invocation runs exactly one handler.
- Inspector token enrollment accepts repeatable `--workspace <path>` arguments.
  `handleInspectorAuthCreate` canonicalizes every supplied path through
  `canonicalWorkspaceId` before constructing the auth service or creating a
  credential, deduplicates equivalent paths, and rejects missing/unresolvable
  values. Unsupported equals-form workspace options are rejected before any
  credential or audit mutation; they never become unscoped enrollment.
  Omitting the option retains undefined legacy scope. `AuthService.createToken`
  records the granted scope in its `token.created` audit details (`workspaceIds`,
  with `null` for undefined legacy scope and `[]` for explicit deny-all); rotation
  carries the preserved scope into `token.rotated`. Paths are host-local
  identities; enrollment on another host requires that host's canonical paths.
- Audit writes remain fail-closed; follow `src/governance/audit/AGENTS.md`.
- **Operator-principal CLI (SRAP-1 G3-A′).** `alix inspector auth` gains
  `migrate [--principal <id>]`, `principal {disable|enable|remove}`, and
  `reconcile`; `create` accepts `--principal <id>` to adopt an existing
  principal. Every enrollment, rotation, revocation, migration, and status change
  is **write-ahead audited** (audit intent first; failure persists nothing and is
  never reported as a successful mutation) and runs its read-modify-write under
  the shared cross-process lock (`principal` lock before `auth-store` lock;
  authoritative state is re-read after acquiring the lock; a held or stale lock
  fails closed with no write). `migrate` holds both locks for the batch and binds
  only unbound, non-revoked, non-expired tokens, re-checking an adopted
  `--principal`'s active status under the lock at commit time; it is idempotent
  under concurrent migration, never resurrects a revoked credential, and never
  overwrites an existing binding. **Revocation preserves `principalId`** for
  historical attribution. `reconcile` reports incomplete enrollments (a principal
  with zero bound credentials), principals with no active credentials, and
  dangling bindings; it never silently deletes evidence (removal is explicit via
  `principal remove`, which refuses while credentials remain bound). Owner:
  `src/governance/security/inspector/AGENTS.md`.
- `alix audit verify --all` verifies both chains in one command: the runtime v2
  chain (`AuditStore.verifyIntegrity`) and the governance per-record chain
  (`governance/audit-chain.ts` `verifyChain`). JSON mode returns
  `{ runtime, governance }`.

**Work Guidance:**
- Moving a handler: keep the public name and re-export from `../security.ts`.
- Relative imports here are one level deeper than the old file (`../../../` to
  reach `src/`, `../` to reach `src/interfaces/cli/commands/`).

**Verification:**
- `tests/security/audit/*` — verifier, activate, checkpoint, chain writer.
- `tests/cli/audit-cli-polish.test.ts` — format helpers imported from the barrel.
- `tests/cli/inspector-workspace.test.ts` — canonical enrollment, multiple paths,
  omitted scope, and invalid input with no credential/audit side effects.
- `tests/cli/inspector-auth.test.ts`, `tests/security/inspector/*` — auth surface.

**Child DOX Index:** none.
