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

R1-B1 is incomplete: a follow-up source change blocks the known direct `SubagentCLI.main`/CLI and `DefaultWorkerExecutor` entries with fixed unavailable-supervisor refusal. The delta passed 63 Vitest cases, including five real compiled subprocess refusal cases and four real-guard unit assertions; retained historical-loop tests explicitly mock the guard. The separate evidence verifier reproduced all 63 cases, the then-expanded 46 Node assertions, both type checks and staleness. The later conservative process-dependency census expands the Node group to 49 assertions and passed its final independent source/evidence recheck, including TSX/JSX traversal coverage. The source reviewer reported no remaining actionable finding in the delta. Whole-consumer classification and backend/qualification remain unfinished. The launch guard now pins known refused entries and conservatively freezes 42 direct process-dependency modules against unreviewed changes/additions, using CRLF-normalized source hashes. It is still lexical and does not prove arbitrary computed imports, shell payloads or native code safe. A qualified durable supervisor must also establish cross-manager attempt/scope exclusion and unresolved recovery; JavaScript tracking cannot do so.

Do not begin R1-B2 implementation as if B1 were accepted. B2 requires real restricted-UID containment and kernel-authenticated IPC with hostile-worker evidence. R1-C requires broker-owned model/config migration. R1-D requires independently protected durable claims and final-effect fencing. R1-E requires complete legacy deletion and migration/rollback evidence. R1-F requires independently witnessed security qualification and an explicit release decision; an agent cannot issue those approvals to itself.


## PR and CI checkpoint

Primary draft PR: https://github.com/boduga/ALiX/pull/1100. First commit `e3f98d18` is pushed. Its 15 reported GitHub checks passed, including Linux/macOS/Windows unit lanes, integration, typecheck, DOX and supply-chain checks. Those results apply to that commit only; the entry-refusal follow-up must pass its own exact-head checks before integration. No merge, issue closure or production release has occurred.


## Designated qualification environment

The operator identified `ubuntu@10.1.1.13` as the prepared qualification environment in response to the host/root-test question. SSH host-key verification succeeded. Read-only inspection observed Linux x86-64 on `alix-ge04-qual-01`, user ubuntu UID 1000, and noninteractive sudo availability. Initial noninteractive PATH inspection did not locate Node, pnpm or a compiler, nor the probed conventional repository paths; toolchain/source discovery is in progress. No privileged native test, deployment or production credential admission has run. Authorization is confined to reviewed synthetic qualification in this designated environment; it does not authorize production services or independent release sign-off.

## Native VM probe and graph-route closure

Commit c8a2fec3 preserves the reviewed fixture-only GNU compatibility correction and narrow designated-VM evidence:3passed1skipped, no test resources remain, witness identity unchanged. Raw initial failure retained. See `docs/audits/evidence/ge04/r1b1-native-2026-11-09/record.md`; this does not complete B2 or grant release. Raw logs intentionally retain their original trailing blank lines.

Independent consumer review classified42process-import modules and found graph CLI/SOP execute/rerun task-loop dispatch as an additional worker bypass. The graph adapter now refuses through the canonical unavailable-supervisor guard immediately before either call, preserving policy blocks and failed rerun persistence. Capability optout/forced rerun cannot enable execution. GitNexus reported CRITICAL class impact; malformed/fuzzy route results were source-checked rather than treated as complete coverage. Executor-entry tests cover real refusal and no new provider/config/task calls (public graph/SOP host commands already load configuration), later-node stop, timeout diagnostic preservation and failed rerun persistence. Final verification/review recorded after execution.

Graph closure validation:8/8real-entry Vitest cases and27/27compiled graph/authorization/launch-guard assertions passed, independently reproduced. Typecheck/unused/emit,4,942-file staleness audit and source whitespace passed. Independent source review found two P2 items (close cached SQLite before deleting temp workspace; qualify public graph/SOP config-loading claims), both corrected and re-reviewed with no actionable scoped finding. DOX committed-tree audit passed7tokens across3owning docs before this increment; rerun after commit. Static guards remain lexical and production native/task backend qualification remains open.

Graph refresh for this increment completed with BM25/FTS disabled after index-build failure; context still returned some malformed inferred paths. Final detect_changes reported7changed files17symbols0affected flows, no partial/truncated flags. Zero flows is not a completeness claim; exact source caller audit and independent27/8assertion verification supplement this degraded graph.

## R1-B2 byte-stream transport increment

Operator selected SOCK_STREAM. Fresh-context readiness/design reviews resolved API, listener nonblocking/deadline, fixture ownership and deterministic hostile-test details before source implementation. The new native library/harness remain disconnected from production and expose no credentials/effects. Local compilation and refusal checks pass; privileged transport runs and source review are still pending at this entry. Contract: `docs/security/ge04-native-stream-transport.md`. All 15 reported GitHub checks passed at 0ac61082 before this increment.

The reviewed stream suite subsequently passed on the designated VM:30 passed, 1 skipped, including 29/29 live methods. Local 2 passed, 29 skipped. Labeled before/after observations show zero synthetic processes/directories and unchanged active/running witness identity. Exact sources and raw results: `docs/audits/evidence/ge04/r1b2-stream-2026-11-09/record.md`. This qualifies only the listed synthetic transport behavior. Native/TS production composition, full B2 containment/recovery and C–F remain open.
