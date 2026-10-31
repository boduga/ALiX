# D9 Phase F — bounded ambiguous-effect replay control

**Current status (reconciled 2026-10-29):** implemented through Slice F at the exact-effect boundary. This record does not approve Phase F, D9, Harness Gate E, or LEAN-G01 and does not establish global exactly-once semantics. The current authority is ADR-0017 plus `src/capabilities/tools/effect-journal.ts`; earlier `effect-replay-guard` descriptions below are retained only as historical implementation context.

## Enforced boundary

`src/capabilities/tools/effect-journal.ts` covers routed tools whose registry metadata is both mutating and high/critical risk, including dynamic `mcp.*`. Conservatively classified safe-shell reads remain outside the journal. Authorization, ownership and policy checks remain separate authorities; the journal neither grants permission nor substitutes for first-attempt authorization.

Before adapter entry, ALiX snapshots effect-bearing request arguments, derives a stable exact-effect identity from canonical workspace/tool/arguments, takes an OS-managed per-effect lock, and durably records the journal claim and `started_unknown`. For non-safe shell execution the canonical execution cwd is part of both the identity and the request actually dispatched. Invocation/session/agent/approval IDs do not silently make the same exact effect a new operation.

The execution path keeps the exact-effect lock across adapter completion. Success becomes durable `terminal_success`; definite returned failure becomes `terminal_failure`; timeout, signal, cancellation-after-entry, lost response, thrown transport/provider errors, and explicit `outcomeUnknown` remain non-retryable uncertainty unless stronger evidence exists. A persistence failure after the external effect is treated as unknown, never as success. Existing unresolved/reconciled-success records block exact replay.

## Audited reconciliation

Slice F adds `effect.reconcile` as a distinct, evidence-bound authority. Reconciliation is permitted only with a single-use approved binding to the current effect key **and journal generation**, requested `applied`/`not_applied` outcome, evidence hash/reference, actor identity and policy revision. Reconciliation snapshots its inputs before awaits, re-reads state while holding the same exact-effect lock after approval-store awaits, and serializes competing reconcilers.

- `applied` → durable `reconciled_success`; replay remains blocked.
- `not_applied` → durable `reconciled_not_applied`; only this state may be archived to release the exact effect for a fresh attempt.
- Age, PID, a different invocation id, model prose, or a new unrelated approval never clears uncertainty.
- Append/fsync reconciliation history records generation, actor, approval, policy and evidence identity.
- An implementation/reviewer agent cannot self-authorize reconciliation or clear the D9 technical gate; missing delegated authority remains fail-closed.

Qualification packet: `docs/prd/evidence/lean-01/D9-phase-f-slice-f-reconciliation-qualification-2026-10-29.md` (implementation `db9bf877`, 48/48 targeted tests PASS, independent post-fix review ACCEPT).

## Remaining release blockers and limitations

- `RISK-REPLAY-01` / risk-register `R-014` remains **OPEN**. The exact-effect journal does not globally deduplicate semantically equivalent commands/arguments represented differently, different routed tools/workspaces, pre-upgrade uncertain operations, direct provider/plugin effects, or adapter/provider internal retries. Adapter/provider idempotency keys or authoritative reconciliation protocols are required for broader guarantees.
- A claim can conservatively block an operation that never reached its adapter. Release requires evidence-bound reconciliation; repeated approval alone is insufficient.
- A dishonest/premature adapter success can still defeat the external semantic boundary. Adapter/provider outcome contracts require their own qualification.
- Process-crash tests do not establish kernel-crash, storage-controller, power-loss, network-filesystem, or external-provider transaction guarantees. Unsupported durability conditions fail closed rather than becoming replay permission.
- Linux x86-64 native process-crash/process-tree evidence is qualified at its pinned packet. **Linux ARM64 native qualification remains required** for first-release Phase F under Q10. macOS/Windows/container certification is deferred by ADR-0017.
- Slice G governance/evidence reconciliation and final D9/Harness gate reconciliation remain separate. Phase F remains HOLD.

## P1 corrections and verification (2026-10-28)

This follow-up changes precisely the two reproduced guard predicates: remove rg
from the exemption, and use router-root cwd for safe-shell effect fingerprints.
The executor integration, shell admission grammar, router execution, approval
semantics and retained evidence are unchanged by this follow-up.

The regression table covers benign reads, ordinary rg, separate/equals/quoted
preprocessor flags, Git output flags, successful effects, idempotent writes,
ordinary errors and MCP. Executor regressions cover ask/auto/bypass, fresh
sessions, actual preprocessor execution with a durable counter, cwd-only changes,
benign safe-shell execution at root and distinct non-safe-shell directories.
The real rg probe uses `rg '--pre' sh script.txt script.txt`: the final operand
supplies a file explicitly because this shell transport leaves stdin piped open.
The script appends one counter line and emits no match, producing a returned
error after a real effect. The cwd-only guard probe uses a mocked ambiguous Git
router response; a separate real `pwd` control confirms router-root execution.

Executed checks on the corrected implementation:

- `node_modules/.bin/tsc -p tsconfig.json` — PASS (compilation/type checking);
  final `--noEmit` typecheck after the assertion refinement — PASS.
- `node_modules/.bin/tsc -p tsconfig.unused.json --noEmit` — PASS.
- Focused Vitest: effect boundary plus continuation unknown-outcome/cancellation
  suites — 39/39 PASS, using `--configLoader native` for the read-only dependency
  link. This includes real rg preprocessing in all three session modes.
- Eleven compiled Node regression files — PASS: effect replay, legacy approval
  single-use, approval crash recovery, consumed propagation, executor events,
  tool router, shell path resolver, safe shell, ownership path scope, R1 boundary
  freeze and subsystem layer boundaries. Log: `/tmp/d9-focused-node.log` (local,
  ephemeral). The effect suite retains SIGKILL and fresh-process coverage.
- `git diff --check` — PASS; untracked edited files are also checked separately.
- DOX audit — FAIL (exit 1): its committed-tree resolver cannot find the
  untracked `effect-replay-guard.ts` and `executeWithEffectReplayGuard`. Direct
  working-tree read-back confirms the file, export and three executor call sites.
  The final retry failed earlier (exit 2: cannot resolve HEAD in child-process
  capture). No staging or commit workaround was used. Neither run passes DOX.

A controlled baseline check temporarily restored only the two vulnerable
predicates, then restored the fixed source in a `finally` block. All six
corrected probes failed as expected (three modes per defect); the fixed source
passes all six. After refining the real rg assertion to check the counter after
retry before checking response metadata, the final targeted run again passed
6/6 (18 unrelated cases intentionally skipped). Baseline log:
`/tmp/d9-corrected-baseline.log` (local, ephemeral).

The first baseline Vitest attempt exposed the cwd bypass in all three modes but
its rg probe timed out waiting for piped stdin. That fixture was corrected with
an explicit file operand before claiming real preprocessor coverage.

GitNexus pre-edit impact rated `ToolExecutor` CRITICAL (58 impacted symbols,
10 direct references; initialization, agent-loop and subagent processes).
The new guard lookup returned UNKNOWN/not found; a direct reference search
confirmed all three executor dispatch sites. The shared ALiX graph is 54 commits
behind HEAD and local augment is unavailable while another process holds its DB.
`detect_changes(scope: all, worktree: /home/babasola/Projects/ALiX-d9-crash-probe)`
reports HIGH risk, 7 changed indexed symbols/sections, 12 affected processes and
two tracked files, without partial/truncated flags. Untracked guard/tests are
absent from diff-based graph analysis. Full current graph qualification remains
outstanding; this result is not global replay assurance.

DOX: the tools owning contract is updated. Root and docs contracts retain their
existing scope and child indexes; no new DOX boundary was introduced. Existing
untracked evidence, review artifacts and node_modules are preserved; SHA-256
comparison verified all 43 pre-existing evidence files unchanged. No commit,
push, merge, security clearance or gate approval is part of this change.


## P1 persistent-cwd correction (2026-10-28)

The independently reproduced bypass was valid: the guard hashed requested cwd
while a persistent ShellPool reused its initial actual cwd. Relative non-pooled
cwd also used host process resolution rather than the guard's workspace-relative
resolution. The earlier verification above did not qualify those behaviors.

The router and guard now share `shell-execution-directory.ts`: existing cwd is
resolved relative to the canonical workspace and canonicalized through realpath.
Safe-shell still executes at workspace root. An existing pool rejects a different
canonical cwd, including after timeout; it is not silently replaced. Routed pool
commands run in isolated subshells starting at the fixed canonical directory.
Thus command-driven cd, traps, functions and environment changes cannot alter the
next command's starting directory. This intentionally removes cross-command shell
state persistence from the routed fixed-cwd mode; direct ShellPool users keep the
legacy mode unless they opt in. Non-persistent shell may execute in a genuinely
different directory, with a corresponding distinct effect identity.

A busy pool rejects concurrent entry. Every command has a fresh completion marker
and reports its exit status; nonzero status cannot release the claim as success.
Timeout, cancellation, process/transport error and premature exit permanently
retire the pool; listeners are cleaned up. POSIX retirement kills the process
group. The router forwards cancellation and preserves its cancellation exception.
A fresh executor still encounters the durable claim for the original directory,
including across persistent/non-persistent switches and relative/symlink aliases.
A rejected request can conservatively retain an additional claim for a directory
where nothing ran; reconciliation remains required, as with other pre-effect errors.

`tests/security/persistent-shell-cwd.vitest.ts` exercises the production pool, not
the historical inline copy in the unit test. Its real shell appends a counter,
then times out; a request changing cwd cannot append again in the old directory
or execute in the new one on that router. Controls cover warmed pools, actual
relative and absolute cwd, lexical and symlink aliases, non-persistent execution,
root-only safe shell, command-driven cd, fresh executor/transport retries,
concurrent entry, cancellation, premature exit and nonzero status.

Executed verification for this correction:

- Isolated baseline: compiled the HEAD router and production ShellPool into
  `/tmp`, keeping the working sources unchanged and using the current guard.
  Timeout then changed cwd produced **two counter lines in the original cwd**.
  Log: `/tmp/d9-cwd-baseline.log`. Initial attempts to prepare the baseline with
  a TypeScript JS API/Node transform API were unavailable; the successful probe
  used the installed TypeScript CLI. No baseline source was restored over work.
- Focused Vitest: four files, **52/52 PASS** (new production-pool regressions,
  effect boundary, continuation unknown-outcome and cancellation). After adding
  the legacy direct-pool compatibility control, the final new suite passes
  **14/14**, bringing the unique focused cases to 53. Logs:
  `/tmp/d9-cwd-vitest.log`, `/tmp/d9-cwd-final-vitest.log`.
- `node_modules/.bin/tsc -p tsconfig.json` — PASS; final `--noEmit` after the
  compatibility control — PASS. `tsconfig.unused.json --noEmit` — PASS.
- Eleven compiled Node test files — **11/11 PASS**: replay guard (including
  fresh-process SIGKILL), approval single-use/crash/consumed propagation,
  executor events, tool router, shell path resolver, safe shell, ownership
  parity, R1 boundary freeze and layer boundaries. `/tmp/d9-cwd-node.log`.
- `git diff --check` — PASS. Existing 43 evidence files under the D9 evidence
  subtree retain their original SHA-256; unrelated untracked files and the
  dependency symlink are preserved.
- DOX automation — **unavailable, not PASS**. `pnpm check:dox` first reported
  read-only dependency/store locks, then exit 2 resolving HEAD. Direct
  `node scripts/check-dox-claims.mjs` also exited 2. A diagnostic git spawn
  returned the valid HEAD hash and exit status 0, but Node attached
  `spawnSync git EPERM`, which makes the checker reject capture. The checker
  also only certifies committed trees, not these untracked additions. No
  staging/commit workaround was used. Manual read-back verifies the shared
  resolver, its two consumers, the new test, and owning tools contracts.

GitNexus pre-edit impact reported MEDIUM for the router class and HIGH for the
production pool/run path (router/executor dispatch; 12 dispatch processes).
The guard is absent from the 54-commit-stale graph (UNKNOWN, not an all-clear);
text confirmation finds its three existing executor call sites. A disambiguated
router execute impact is also HIGH and reports interface/dynamic dispatch gaps.
Final explicit-worktree `detect_changes(scope: all)` reports HIGH, 23 indexed
symbols/sections, 12 affected processes and four tracked files, without partial
or truncated flags. Untracked guard, shared resolver and new tests are absent
from diff-based graph analysis. Local graph augmentation is unavailable because
another GitNexus process holds the database; no current full re-index was run.
These are bounded graph results, not whole-worktree security qualification.

DOX pass: the nearest tools contract now owns canonical directory resolution,
fixed pool cwd, subshell isolation and transport retirement, with production
regression coverage indexed. Root and docs AGENTS contracts/indexes are unchanged:
their scope and child boundaries did not change. No commit, push, merge or gate
approval was performed.

Limits: this remains bounded directory-and-command identity, not provider-level
exactly-once. A genuinely different directory on a fresh router is a different
operation; commands using absolute targets can affect the same external resource
from different directories. Hostile filesystem namespace changes between path
resolution and spawn are not made atomic by realpath. Background/detached effects,
forged success and adapter-internal retries retain the earlier limitations. Linux
bash/process-group behavior is exercised here; Windows process-tree termination,
power loss, filesystem durability and real providers are not qualified. Existing
claims created by the old incorrect cwd identity are not migrated or cleared.
No independent verdict, gate, approval or release authorization is changed.
