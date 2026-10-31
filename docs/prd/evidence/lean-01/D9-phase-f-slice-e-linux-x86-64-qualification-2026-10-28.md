# D9 Phase F Slice E — Linux x86-64 native qualification

Date: 2026-10-28 (America/Edmonton)
Status: ACCEPTED — Linux x86-64/ext4 half only; Slice E remains HOLD
Scope: Linux x86-64 process-crash/restart durability and routed shell process-tree behavior only

## Source binding

- branch: `fix/d9-phase-f-remediation-v2`
- source commit: `72c9f3a988d16560244989ef0ad7cdfcf7f302c1`
- source tree: `04585da60eb02044cdb3c2b6c84dcd4abf6e9970`
- source worktree was clean before qualification execution

## Native host / storage context

```text
Linux ideapad 6.8.0-146-generic #146-Ubuntu SMP PREEMPT_DYNAMIC Thu Sep  3 16:12:30 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
uname -m: x86_64
Node platform/arch: linux/x64
mount: /dev/sda2 / ext4 rw,relatime,errors=remount-ro
```

Independent review accepted this packet only for this native Linux x86-64/ext4 execution context and the tested process-crash/process-tree contract. It does **not** claim kernel-crash, storage-controller, drive-cache, or power-loss durability. It does **not** qualify Linux ARM64, macOS, Windows, network filesystems, containers, or other filesystems.

## Commands and results

### Build

```sh
pnpm build
```

Result: PASS (`exit 0`).

### Native Node crash/process suite

```sh
node --test --test-concurrency=1 \
  dist/tests/shell-tool.test.js \
  dist/tests/security/effect-journal-sigkill.test.js \
  dist/tests/security/d9-sigkill-durability.test.js \
  dist/tests/security/d9-resumer-sigkill.test.js \
  dist/tests/security/approval-crash-recovery.test.js
```

Result: **30/30 PASS**, 0 failed, 0 skipped/cancelled.

Observed cases include:

- effect-journal real fresh-process `SIGKILL` after effect application and before terminal receipt; exact replay remains quarantined;
- approval/effect `SIGKILL` after consume and after effect; persisted claim cannot authorize replay;
- actual resumer `SIGKILL` at before-resume, after-tombstone, after-consume, after-effect and after-receipt checkpoints, including reassignment recovery checks;
- approval crash-after-consume unknown-outcome denial/recovery;
- routed shell timeout;
- timeout kills detached descendants;
- **operator cancellation kills detached descendants** (fresh native negative added in `72c9f3a9`);
- normal success/nonzero execution and environment/stdin isolation behavior covered by the shell suite.

### Focused Vitest dispatch/cancellation suite

```sh
pnpm exec vitest run \
  tests/security/effect-journal-dispatch-matrix.vitest.ts \
  tests/security/continuation-cancellation.vitest.ts \
  tests/security/d9-phase-f-shell-counterexamples.vitest.ts \
  --reporter=dot
```

Result: **3/3 files, 19/19 tests PASS**.

Observed cases include:

- all current high/critical mutating routed catalog families at the effect-journal boundary;
- shell timeout, signal termination and nonzero exit after observable effect remain `outcomeUnknown` / non-retryable rather than becoming definite terminal failure;
- production MCP post-call ambiguity remains `outcomeUnknown` / non-retryable;
- continuation cancellation and F1/F2/F4 shell counterexamples remain green.

## Qualification disposition

Candidate result for the tested Linux x86-64/ext4 host: **PASS** for:

1. process-crash/restart replay quarantine at the tested journal/approval checkpoints;
2. routed shell timeout/cancel process-tree termination;
3. signal/nonzero/timeout ambiguity semantics;
4. Slice D dispatch/journal invariants exercised natively on this host.

Not qualified / still blocking Slice E completion:

- **Linux ARM64 native execution is not present in this packet and remains REQUIRED.**
- Process-tree qualification covers the tested descendants that remain in the detached shell process group; it does not claim containment of a descendant that deliberately escapes into another process group/session (for example via `setsid`).
- No power-loss durability claim is made.
- No macOS/Windows/container qualification is made; those targets are deferred by ADR-0017/Q10.
- Slice F reconciliation and Slice G governance/evidence work remain separate.

Therefore this packet may qualify the **Linux x86-64 half** of Slice E after independent acceptance, but **Slice E and Phase F remain HOLD** until the required Linux ARM64 evidence and later-slice requirements are complete.

## Independent review

Independent read-only review verdict: **ACCEPT** for the tested Linux x86-64/ext4 half of Slice E only. The reviewer verified source/tree binding, journal ordering, real SIGKILL replay quarantine, timeout/cancellation descendant termination, and ambiguity handling against current source. No material overclaim was found after adding the process-group caveat above. Required Linux ARM64 native evidence, Slice F, and Slice G remain blockers; Phase F remains HOLD.
