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

## Fixed cgroup synthetic qualifier

Operator selected exclusive cgroup ownership as recovery authority. The closed native fixture/controller passed independent source/root-scope review and executed on the designated VM: 28 passed, 1 skipped, including all 24 live cgroup methods. Local 5 passed, 24 skipped; existing related Vitest 16/16 passed. After identity-bound cleanup, the witness identity was unchanged, zero synthetic UID/GID processes remained and the test unit/private directories/staging were absent. Exact sources, commands, raw observations and limits: `docs/audits/evidence/ge04/r1b2-cgroup-2026-11-09/record.md`. This is atomic cgroup birth and same-boot fixed-worker cleanup/recovery evidence, not hostile filesystem/network isolation or a production task backend. B1 integration/full B2 and C–F remain open.

## Pinned image construction increment

All15reported GitHub checks passed at6582e0c6. Operator selected pinned worker
images and an outer supervisor-owned cgroup with a runc-owned payload group.
Fresh review identified competing native/runtime cgroup deletion owners in the
first broad plan; the selected outer/inner separation fixes the direction, while
its exact lifecycle/journal/profile/bundle-custody protocol remains unimplemented
and unqualified. The previous single-leaf evidence does not qualify this layout.

A separate pure image-byte builder/verifier is being implemented under
`docs/security/ge04-oci-qualification-image.md`. It accepts a pinned opaque
payload and emits/checks one bounded deterministic OCI layout. No executable
safety or admission is inferred; no image extraction, runtime config, container
execution or production composition is added. Local18/18format tests pass and were independently reproduced, including golden
fingerprints derived outside the module. Final scoped source review found no
actionable finding; evidence is retained in
`docs/audits/evidence/ge04/r1b2-image-bytes-2026-11-09/record.md`. B1/B2 and C–F
remain open, with SECURITY HOLD active.


## Runtime-view local-contract continuation (2026-11-09)

The untracked `native/ge04/cgroup-runtime-view-qualification.c` remains the
same SHA-256 `1a414741fd3087ea0aa432601fc693056b758c484b462b663bd1a2c08b655639`.
A local `cc -std=c11 -O2 -Wall -Wextra -Werror -fanalyzer` compilation passed.
The final fsync deadline guards were inspected but have **not** received the
required independent re-review. The bundled EGM workflow was not available
in this session; no substitute agent review or approval is claimed.

Added `tests/agents/test_ge04_runtime_view.py`, which implements only strict
staging inventory/original-receipt/manifest validation, canonical event/result
parsing, and unprivileged native refusal cases. Seven local tests passed.
The Python root entry deliberately raises a refusal even after valid staging;
no live phase observer or root controller is implemented and **no VM root
probe was run**. Added the partial qualification boundary document
`docs/security/ge04-runtime-view-qualification.md` and updated
`native/ge04/AGENTS.md` (DOX). The new files are uncommitted, and this
checkpoint is **not** an acceptable stage/cleanup packet. Keep primary draft
PR #1100, all evidence and branch/worktrees, and GE-04 SECURITY HOLD intact.

Remaining: fully implement bounded kernel phase observer/cleanup and root
unit custody (under separate reviews), run local/staleness/DOX/graph checks,
review exact source and execution packets, then consider the separately
reviewed disposable-VM run. R1-B1/B2/C–F and Gate F remain OPEN.

### Second local-only protocol increment

Extended the Python fixture with `BoundedPhasePipe` (finite-deadline binary
line reader, split/coalesced diagnostics, overflow/EOF handling) and
`PhaseSequence` (ordered phases and stable reported child generations).
Four focused tests were added; latest local suite is **11 passed, 0 failed**.
These utilities are untrusted-diagnostic admission prechecks only and are
not called a kernel observer. Root admission remains an unconditional refusal.
No VM execution, independent source review, commit, push or merge is claimed.

### Read-only process-observation primitives

Added bounded parsers for `/proc/<pid>/stat` state/startticks,
`/proc/<pid>/status` four UID/GID identities, and `cgroup.procs` exact
member sets. A passive `check_reported_generation` cross-check rejects
PID/startticks, identity and membership mismatch in supplied observations.
Two new local tests passed (13/13 total). No actual generation-pinned pidfd,
procfs read/re-read, mount/namespace/FD custody, unit check or ACK gate is
wired; the root controller still raises an unconditional refusal. GitNexus
impact lookups for prior Python symbols remained UNKNOWN/not found, never
interpreted as low risk. Source bytes for the native C helper are unchanged.

### Observer-owned pidfd local proof, still root-inert

Added read-only `observe_live_generation`, which verifies a canonical procfs
starttick before opening an observer-owned pidfd, samples UID/GID via procfs,
rechecks generation and polls pidfd for liveness. The new tests exercise the
actual unprivileged test process and reject wrong ticks/UID/GID. Local runtime-
view tests now pass **15/15**. This does NOT prove protected procfs ancestry,
cgroup unit ownership, namespace/mount/FD inventories, complete phase matrix
or ACK authorization, and the root controller remains intentionally absent.
The native C helper is unchanged; no root/VM execution, commit or merge.

## Proposed cross-platform worker placement — ADR-0019 (2026-11-09)

Repository survey found ADR-0018 already allocated to the independent trust
service; the cross-platform execution proposal is ADR-0019, not an overwrite
of the existing trust decision. Drafted
`docs/architecture/adrs/ADR-0019-cross-platform-worker-execution.md` with
status PROPOSED. It preserves the existing mandatory
`TaskWorkerSupervisor` as portable coordination/worker-lifecycle seam;
a future Linux-only pinned OCI/runc backend owns pidfds, namespaces,
cgroups, native streams, exact kernel custody and recovery. Windows/macOS
controllers may eventually delegate to separately qualified Linux VMs or
remote Linux services, not silently spawn a native fallback.

Aligned `docs/security/ge04-production-worker-lifecycle.md`,
`docs/security/ge04-capability-discovery.md`,
`docs/security/ge04-q32-supervisor-verification-boundary.md`,
`docs/security/ge04-oci-qualification-image.md`,
`docs/security/ge04-runtime-view-qualification.md` and
`native/ge04/AGENTS.md`. Added a historical qualification note to ADR-0007;
its accepted 2026 direct-spawn decision was not rewritten or represented as
GE-04 security evidence. The initial qualification scope stays Linux x86-64.
The proposed backend eligibility requires independently protected identity,
release, trust/boot/architecture, launch authority, recovery and cleanup
evidence, and fail-closed refusal on missing/unknown qualification.

GitNexus pre-design impact of `TaskWorkerSupervisor` was CRITICAL with
699 upstream references (lower bound), 132 processes and 20 modules; no
interface/source implementation was changed. Independent architecture and
security approval, future OS adapter design, guest/transport qualification,
R1-B1/B2/C–F and Q13 release are **all still pending**. GE-04 SECURITY HOLD
remains active. Do not infer VM/root execution or production worker admission
from documentation; retain the draft primary PR and all worktrees.

### Platform-neutral supervisor contract review and namespace snapshot

Source-reviewed `src/agents/worker-task-supervisor.ts` and
`src/agents/worker-supervisor.ts` against proposed ADR-0019. Current v1
`SupervisedWorkerEvidence` supplies PID/UID/startticks/registrationId but no
backend, guest-boot or cross-host principal, and `wait/cancel/revoke/reconcile`
returns do not prove descendant cleanup or safe retry. Added an exact API
gap/migration table to ADR-0019 and current lifecycle docs. GitNexus reports
`snapshotWorkerEvidence` CRITICAL upstream impact (276 references, 102
processes); no production contract/source was changed or accepted.

Resumed local-only runtime-view work with read-only `observe_namespace_links`
for mnt/cgroup namespace symbolic identity against independently opened
namespace descriptor device/inode, bracketed by starttick checks. A new
unprivileged test initially found a regex error; corrected it and re-ran
**16/16 passing**. This is diagnostic only, not protected procfs, namespace
custody, VM qualification or authority for native ACK. Root qualification
still refuses unconditionally and no VM root execution is permitted.

### Additional read-only cgroup and FD grammar (GE-04 HOLD)

Added local-only strict `parse_cgroup_events` (populated/frozen),
`parse_subtree_control` (cpu/memory/pids), `parse_fd_inventory` and
`check_fd_inventory` to `tests/agents/test_ge04_runtime_view.py`.
Two new negative-test methods bring the unprivileged suite to **18/18**.
These accept supplied bytes/FD names only: there is no protected cgroup
file-descriptor opening, mount-root custody, actual descriptor target check,
complete phase observer or authenticated ACK gate. Original native source
and unconditional privileged refusal remain unchanged. Independent native
review, root-scope evidence and GE-04 security clearance remain pending.

### Exact phase cgroup membership matrix — local only

Added pure supplied-data `verify_phase_cgroup_snapshot` covering INTENT,
PRE_NAMESPACE, PINNED, ENABLED, PRE_JOIN and READY. The helper checks the
reported PID/tick pairs against exact expected outer/launcher/payload direct
members, cgroup.events populated state and outer enabled controllers. It
rejects extra/missing members, unexpected payload tasks, contradictory
population, wrong controllers and unsupported phases. Two new negative-test
methods bring local runtime-view tests to **20/20**. EMPTY, DENIED and
recover/sweep are deliberately excluded pending separate custody/recovery
contracts. No protected cgroup descriptors, independent live phase observer,
root admission/ACK, privileged run, production C caller or GE-04 hold release.

### Bound read-only cgroup/mount observations (GE-04 HOLD)

Added `parse_cgroup2_mountinfo` rejecting malformed, multiple, non-root
and wrong-location cgroup2 mount records. Added `read_bound_cgroup_snapshot`
using O_DIRECTORY/O_NOFOLLOW and an expected externally provided directory
(dev,ino), bounded read-only dirfd-relative control-file opens, exact
control-file parsers and postread path/identity checks. Two negative-test
methods cover mismatched identity, symlink substitutions, malformed event
counters and mountinfo ambiguity; local suite **22/22 PASS**. These are
unprivileged synthetic tests, **not** a protected kernel phase controller,
race-free mount ancestry proof, independently bound systemd unit/cgroup
custody or source of ACK authority. Native C helper remains qualification-only;
root entry still refuses, no VM/root execution or production activation.

### Root-to-leaf cgroup ancestry (read-only qualification contract)

Added `observe_bound_cgroup_ancestry` to the local runtime-view qualification
module. Opens the expected root/outer/leaf directory chain with held
O_DIRECTORY/O_NOFOLLOW descriptors, verifies independently provided device/inode
bindings and rechecks the traversed entries. Test rejects traversal,
substituted links, mismatched generation and replacement; **23/23** unprivileged
tests pass. Does not establish systemd unit custody, trusted mount ID,
protected expected identity, atomic snapshot or ACK authority. No production
source/C helper changes, privileged launch or GE-04 release authorization.

### Independent unit/mount/keeper binding review — explicit HOLD

Added pure, fail-closed `validate_external_cgroup_binding` for matching strict
invocation, fixed unit, mount ID/device/root, keeper PID/generation and
three-level cgroup ancestry between separately supplied records. One new
negative-test method brings local runtime-view tests to **24/24 PASS**.
Neither supplied record is independently authenticated, so this is NOT
trusted systemd/kernel provenance or a worker admission check. Added
`docs/security/ge04-runtime-view-independent-binding-review.md` recording
mandatory evidence owners, missing protected source checks, prohibited
fallbacks, and independent review/VM authorization sequence. The native C
fixture, Python root refusal, production supervisor, and GE-04 SECURITY HOLD
remain unchanged. No privileged execution was performed.

### Consolidated baseline and terminal/recovery contract sprint

Committed the 12 accumulated qualification-only files as `142e435e`
(`test(ge04): checkpoint unqualified runtime-view contracts`). This is
an engineering checkpoint, **not** independent code review, privileged
qualification or security release. No changes to the native C helper.

Added bounded `evaluate_closed_qualification_transcript` for all eight fixed
fixture modes. It checks ordered phases, stable child generations, exact
success/failure terminal reasons, caller-supplied zero membership/populated
cleanup claims, and crashes that must remain QUARANTINE_PENDING_RECOVERY.
It has no authority to send ACK, authenticate those claims or admit a worker.
The local suite now passes **26/26**; explicit root admission remains a denial.

Added `docs/security/ge04-r1b1-closeout-gates.md`, consolidating eight
blocking trust/custody/observer/recovery/root-review/evidence acceptance gates
and the full adversarial matrix. Remaining work requires independently
protected original systemd invocation/keeper and cgroup/mount provenance,
full kernel-backed observation of EMPTY/DENIED/recovery and independently
reviewed disposable VM qualification. R1-B1 remains OPEN; SECURITY HOLD active.

### Read-only composite kernel binding probe — engineering only

Implemented `observe_read_only_bound_view` within the unprivileged Python
qualification tests: compares a caller-supplied canonical binding with an
actual Linux pidfd/proc generation, namespace link identities and the exact
keeper `/proc/<pid>/mountinfo` cgroup2 mount ID/device; re-observes them across
bounded dirfd-relative reads of a synthetic root/outer/leaf cgroup tree.
The result is fixed `UNQUALIFIED_OBSERVATION`, never ACK, admission, release or
permission to execute as root. Negative tests reject wrong mount identity,
keeper generation, cgroup inode and malformed event data; **27/27 local tests
pass**. The expected bootstrap/systemd identity is NOT authenticated and the
cgroup file fixture is not a real delegated subtree. The production backend,
privileged controller and independent security gates remain incomplete;
GE-04 SECURITY HOLD ACTIVE.
