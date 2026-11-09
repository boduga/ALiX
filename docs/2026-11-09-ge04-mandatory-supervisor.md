# GE-04 mandatory supervisor work — 2026-11-09

GE-04 SECURITY HOLD ACTIVE. Issue #1054 remains open. This is a reviewed manager/task-contract increment, not completed R1-B1 or production qualification.

## Baseline and branch

Base `a927ee2b`, branch `fix/ge04-r1b1-mandatory-supervisor`, isolated worktree `/tmp/alix-ge04-r1b1-mandatory`. The previously registered directory was absent and was restored on the existing branch. No other branch/worktree was deleted. Host process inspection found no stalled Codex restart process; none was terminated. Work's execution tools were used without a Codex CLI model login.

The operator requested sequential completion of R1-B1 → R1-B2 → R1-C → R1-D → R1-E → R1-F without repeated routine section approvals. The selected result model is one bounded completion per handle. Engineering work and delegated design decisions do not supply independent human security qualification, credentials, privileged execution or hold clearance.

## Implemented increment

`SubagentManager` no longer directly spawns a process, selects a worker executable, writes credential FD3, forwards keyring environment or signals a PID. It requires the trusted `TaskWorkerSupervisor` interface; absent authority and old override/observer options refuse execution. Runtime config cannot enable a backend. No production task-supervisor implementation is supplied.

Trusted preparation owns immutable task specifications and opaque configuration IDs. An explicit nonsecret projection includes task/model/scope metadata. Prepared requests and completion evidence must match run/worker/attempt and exact process generation. Result schema/UTF-8 bounds are checked; exit zero alone never implies success. Partial/failed/rejected results retain findings. Normal process wait and structured completion remain separate.

Cancellation fences preparation, queued dispatch, pending native launch and running work. Shared quarantine prevents already-pending tasks from dispatching after uncertain cleanup. Late returned handles retain cleanup responsibility. Confirmed cancellation cannot become success during lease release. Failed revocation, wait or cleanup never acts as termination evidence. Lease renewal failure fences execution; retained map entries do not guarantee cross-manager exclusivity after lease loss.

## Engineering review

Fresh-context EGM implementation-readiness, codebase-details and style reviewers inspected the bounded plan. Readiness/codebase findings about exact schemas, state transitions, kernel fixtures and renewal-loss guarantees were resolved and re-audited with no residual Blocker/Major for this increment.

A separate agent reviewed current source. It found pending-revocation settlement, shared-quarantine dispatch, lease-release cancellation and deferred-launch races, plus a false quarantine on clean queued cancellation. Each was corrected with regression coverage. Final source recheck reported no remaining actionable findings within the manager/task-contract scope. This is agent engineering review, not human security qualification.

A separate evidence verifier independently reproduced the consolidated 44 Node assertions, 51 Vitest assertions, both type checks, staleness and whitespace checks. The final cancellation-error classification adjustment was then rechecked in the focused contract suite; uncertainty remains visible in the cause rather than being classified as task success.

## Verification

- TypeScript noEmit and unused checks passed.
- Final consolidated compiled Node command used `--test-isolation=none --test-reporter=spec`: manager, old-observer refusal, kernel executor, launch guard and existing architecture guards — **44 assertions passed**, zero skips.
- Final consolidated Vitest command used `--configLoader runner`: task contract, MP-01 parity, existing supervisor/Linux/durable-launch/recovery-gate suites — **51 assertions passed**, zero skips.
- The explicit Node isolation setting is necessary here: default isolated execution reports only file-level counts and must not be cited as individual assertion coverage.
- Staleness audit passed, zero stale references. Whitespace diff check passed.
- Supervisor naming check reports three pre-existing identifiers in unrelated files. This increment does not claim that repository-wide gate is green.
- The local DOX checker resolves source claims against committed HEAD; before committing new source it reports the new file/validator unbacked. The committed-tree audit must pass before PR creation.
- GitNexus main index required a forced rebuild after FTS repair failed. Earlier partial/CRITICAL impact output was not treated as clean. Forced main rebuild succeeded; scoped manager impact then reported MEDIUM, 13 direct callers, one process and two modules. The separate worktree index succeeded. Complete staged change analysis covered 12 files, 198 symbols and nine affected flows, with HIGH risk and no partial/truncated flags. The indexed execution-flow inventory still has global exploration limits, so these counts are not whole-program route completeness.

All new execution tests use credential-free doubles. No native privileged program, provider request or production credential admission was executed.

## Remaining sequential gates

R1-B1 is incomplete: direct `SubagentCLI.main`/CLI routes and `DefaultWorkerExecutor` still expose legacy worker execution, and whole-consumer coverage/static guards remain unfinished. The new launch guard deliberately covers only the manager/task facade, not the whole repository. A qualified durable supervisor must also establish cross-manager attempt/scope exclusion and unresolved recovery; JavaScript tracking cannot do so.

Do not begin R1-B2 implementation as if B1 were accepted. B2 requires real restricted-UID containment and kernel-authenticated IPC with hostile-worker evidence. R1-C requires broker-owned model/config migration. R1-D requires independently protected durable claims and final-effect fencing. R1-E requires complete legacy deletion and migration/rollback evidence. R1-F requires independently witnessed security qualification and an explicit release decision; an agent cannot issue those approvals to itself.
