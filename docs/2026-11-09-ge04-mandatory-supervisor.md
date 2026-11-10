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

### Independently supplied view records and real self-cgroup read-only observation

Reworked the composite diagnostic to **reject one record compared with itself**.
It now requires separate expected/observed binding dictionaries, fails on any
mismatch or mutation during the observation, and rejects independently sampled
namespace changes. These are agreement checks, **not** authentication of the
external bootstrap source.

Added `parse_self_cgroup_v2` with traversal/ambiguity refusals and a separate
`observe_unprivileged_self_cgroup` that reads the **real current Linux cgroup v2
subtree** without modification. It ties procfs-reported self scope and pidfd
process generation to cgroup2 mount major/minor device, held directory
ancestry, cgroup.procs membership and cgroup.events populated state, with
post-read scope/generation checks. It returns only `UNQUALIFIED_LIVE_KERNEL_VIEW`.
The current-user cgroup source/expected inode identities remain unprotected;
this is not the qualification worker or independently owned unit. Local
runtime-view suite **29/29 PASS**. The C fixture was not modified; root entry
continues unconditional refusal; production hold remains active.

### Six-phase cgroup file correlation + terminal HOLD (2026-11-09)

Added `observe_cgroup_phase_read_only`: reads and double-checks supplied
root/unit/outer + launcher/payload directory identities and direct cgroup
control-file bytes for INTENT through READY, verifies exact memberships,
subtree populated/controllers, and root stopped child generations (mocked in
local tests). Added `observe_terminal_cgroup_read_only`: EMPTY requires two
stable empty-state snapshots; DENIED **always** quarantines pending independent
recovery. Neither helper writes an ACK, launches or kills a worker, authenticates
the original bootstrap or qualifies real child isolation; diagnostic return
values contain UNQUALIFIED or QUARANTINE.

Local runtime-view suite **32/32 PASS**; focused supervisor tests **36/36
PASS**, OCI-image **18/18 PASS**, TypeScript and DOX PASS. Separate read-only
Codex engineering review reported no actionable regression in this diff; it
also reproduced an intermittent baseline live self-cgroup `Invalid member`
fixture rejection, which remains documented as a test-stability issue.
Independent human native/root review, protected controller/source ownership,
disposable-VM qualification and production release remain blocked.

### Immutable bootstrap descriptor transport — root admission remains refused

Added Linux-only `native/ge04/bootstrap_binding.py` (qualification-only)
with strict canonical bounded immutable memfd receipt parsing. Reads require
all four write/grow/shrink/further seals, checked type/owner/UID/GID/inode,
bounded length and stable fstat. A separate unprivileged process transfers
an FD with UNIX SCM_RIGHTS in the local test suite; output remains
`UNQUALIFIED_SEALED_BOOTSTRAP`. The external issuer, systemd credentials,
unit custody, original intent and kernel claims are NOT authenticated.
Separate model engineering review found P2 unsupported-platform import and
UID/GID-assumption defects; fixed before push, with Linux-only test discovery
skipping on unsupported platforms and separate expected GID validation.
No privileged work, ACK or production supervisor changes. GE-04 HOLD ACTIVE.

### Kernel peercred sealed bootstrap receipt — engineering slice

Added qualification-only `native/ge04/bootstrap_receiver.py`: bounded UNIX
seqpacket SCM_RIGHTS receipt with SO_PEERCRED, separately supplied publisher
PID/UID/GID/starttick expected identity and independent observer callback,
exact one FD, original sealed inode, nonce and attempt matching. The receiver
closes its socket and all delivered descriptors on every terminal path.
Review found two P2 defects (portable test import, invalid-input owned-socket
leak); corrected and added early-cleanup regression. Tests demonstrate
same-user local SO_PEERCRED comparisons, not root publisher custody or a
trusted kernel process-generation observer. It only returns
`UNQUALIFIED_KERNEL_PEER_HANDOFF`; no production caller or ACK. Remaining
GE-04 R1-B1 blockers: protected original publication, reviewed root controller,
independently pinned systemd and cgroup mount identity, real child lifecycle
and cleanup/recovery VM proof, and independent security approval.

### Bootstrap publisher reconciliation — no privileged publication

Added `native/ge04/bootstrap_publisher.py`: fixed six-step unprivileged-only
contract to reconcile original prebirth intent with separately provided
systemd manager and kernel snapshots, enforce exact keeper/invocation/attempt,
unit active/nonrestarted and mount/cgroup hierarchy identities, and reject
changed records across repeated observations. The sealed descriptor output
is explicitly UNQUALIFIED. `publish_root_bootstrap` **always raises** and
the fixture mint path rejects UID 0. Six synthetic tests PASS. The manager
and kernel inputs are callable test fixtures, not authenticated readers.
This neither provides original protected publication nor creates/activates a
systemd unit, so R1-B1 and GE-04 security approval remain open. The exact
remaining authority requirements are in
`docs/security/ge04-bootstrap-publisher-contract.md`.

### Actual systemd system-bus fixed-unit observation (read-only)

Added `native/ge04/systemd_unit_observer.py` to query the real systemd
system D-Bus: pinned unique root-UID service owner, read-only fixed GetUnit,
exact object path, required Unit/Service states and stable repeated property
snapshots. The current unprivileged host returns NoSuchUnit; no unit was
created/adopted. The observer cannot establish original prebirth intent,
manager-origin approval, keeper pidfd/cgroup mount custody, or privilege.
Result always UNQUALIFIED. R1-B1 and GE-04 hold remain OPEN. See
`docs/security/ge04-systemd-manager-observation.md`.

### Existing systemd unit / keeper kernel corroboration — read-only

Added `native/ge04/unit_kernel_observer.py`, correlating fixed live systemd
GetUnit/Unit/Service observations with a *supplied* original keeper PID,
startticks, invocation, cgroup2 mount ID/device, and root/system.slice/unit
inode-chain. It checks observer-owned pidfd, exact `/proc/<pid>/cgroup`,
procfs start generation, kernel cgroup membership and owner record stability,
then resamples the systemd manager to reject replacements. Never launches,
signals, creates units, changes cgroups, ACKs or removes quarantine.
Separate model code review found two defects; fixed bounded reads to require
EOF before accepting full mountinfo/membership, and permitted live R/S/D
scheduler transitions without weakening generation checks. 5/5 focused
local tests pass. Positive tests use controlled fixtures; there is no live
qualification unit and no authenticated protected original receipt. Root
publisher is still refused, R1-B1 OPEN, GE-04 SECURITY HOLD ACTIVE.

### Native root fixture default-disabled; source preaudit opened

Default builds of the 740-line native cgroup-runtime-view fixture now refuse
all valid modes (exit 77) before root setup; only a specifically named
compile-time VM-qualification opt-in can include the privileged code path.
The opt-in does not grant authorization or meet the independent source/root
review, disposable VM, original bootstrap, worker ACK or Q13 gates.
The `test_ge04_native_default_hold.py` Linux-only regression compiles the
normal source and confirms exit 77 for all eight valid modes and 64 for
unknown input. No root helper was executed. Preaudit observations and exact
current source hash are recorded in
`docs/security/ge04-native-controller-source-preaudit.md`.
An external automated code review of the default-deny diff identified one
cross-platform test skip issue, corrected. The broader C security review is
still pending and GE-04 SECURITY HOLD remains active.

### No-adoption recovery sweep guard

Corrected `sweep_empty` in the closed native C helper: a lone existing
`worker-*` cgroup directory can no longer be accepted for cleanup from a
name scan without an original matching `intent.tmp` record (invocation,
parent, exact directory name/dev/inode). The ordinary binary still refuses
all eight modes with exit 77. Added a Linux source-level regression checking
that intent is required before `open_outer`. A separate read-only model review
found no actionable change-specific defects; independent root security review
and live VM crash/recovery evidence remain mandatory. GE-04 SECURITY HOLD
remains active.

### Cleanup refuse-on-missing-original and pre-kill identity resample

Changed native `cleanup_until` to report refusal when `c->owned` is false
rather than treating absence of pinned outer custody as successful cleanup.
For published-intent cleanup, it repeats original record, lock, held kill-FD
identity, child enumeration and launcher/payload inode checks immediately
before the cgroup.kill write. Three local native source/default-deny tests
pass; no root helper executed. This remains a non-atomic defensive recheck,
not independent kernel authority, full crash recovery or a security release.
GE-04 SECURITY HOLD ACTIVE.

### Native phase-bound ACK framing — still non-authorizing

The cgroup-runtime-view native helper's phase ACK input now requires a
canonical `GE04ACK1` frame carrying the current invocation, phase name,
and strictly increasing in-process sequence. The previous `c` ACK is rejected.
An inert unprivileged C probe exercises the real native parser and rejects
replays, wrong phase/sequence/invocation, duplicate frames and malformed
payloads. This prevents accidental protocol confusion but does not prove
ACK-sender identity: stdin owner can forge the entire public frame. There
is still no protected root controller or independent kernel-phase authority.
Default native root entry remains disabled; R1-B1 OPEN and GE-04 HOLD ACTIVE.

### Read-only phase-controller state machine — no ACK authority

Added `native/ge04/phase_controller.py`, a nonprivileged diagnostic-only
controller-side six-phase sequence validator. It normalizes caller-supplied
original binding through the canonical schema, parses native EV records,
checks manager/kernel witness correlation for keeper identity, rejects
misordered/replayed/expired/contradictory observations, and permanently
quarantines on failure. Both EMPTY and DENIED remain quarantined, and
`issue_ack` always raises permission refusal. The default witness uses
existing read-only systemd/pidfd/cgroup observation; the synthetic tests
supply a fixture. The binding issuer is not authenticated, the observer has
no hard callback timeout and this component has no IPC writer. No privileged
execution, worker admission or phase ACK is possible. GE-04 HOLD ACTIVE.

### Isolated bounded read-only phase observation — no ACK authority

The default `ReadOnlyPhaseController` manager/kernel observer now executes
inside a fresh unprivileged `python -I` subprocess, with a parent-enforced
absolute deadline, bounded canonical stdin and incrementally capped stdout.
A stuck child is killed and reaped; invalid, missing, oversized or late
response poisons the controller attempt. The code still refuses every ACK,
creates no systemd unit and never invokes the privileged C entry. Existing
read-only D-Bus/procfs/pidfd/kernel observations are preserved; original
identity and source custody are not independently authenticated. Injected
test callbacks do not have an enforced deadline and remain non-authorizing.
The fixed-unit live host reports absent; synthetic positive witness tests
cannot prove root authority. See
`docs/security/ge04-bounded-isolated-phase-observer.md`. R1-B1 OPEN, GE-04
SECURITY HOLD ACTIVE.

### Existing original root approval custody checked before/after observation

A read-only `protected_approval_observer.py` checks the fixed C fixture's
root-owned original `approval.v1` and zero-byte `.lock` against an externally
supplied expected invocation and exact parent cgroup inode/device. It opens
only fixed no-follow directory/file paths, rejects unsafe/missing/mutating
records and reconfirms paths and files before returning an explicitly
UNQUALIFIED correlation. The isolated manager/kernel worker now requires
this check before and after each observation, failing closed when absent.
Six local tests include malformed records, inode/invocation substitutions,
symlink denial, real unprivileged ownership refusal, and a synthetic positive
with mocked root metadata. This is **not** authenticated root-created
prebirth evidence, unit birth authorization, source custody or a root-ready
observer; no privileged operations or permissions changes were made. See
`docs/security/ge04-existing-root-approval-custody.md`. GE-04 HOLD ACTIVE.

### Original pre-birth issuance vs post-birth unit inode — design contract

Identified a missing chronological trust boundary: existing native
`approval.v1` references the unit cgroup inode, which may not exist before
systemd unit creation. Added a pure `PrebirthIssuanceContract` separating
immutable PREBIRTH expected-absence/durable intent from post-creation
BIRTH_OBSERVED with exact boot/attempt/nonce, manager invocation, keeper,
mount and cgroup identity, and permanent quarantine on ambiguous crash,
restart, mismatch or replay. It shares the canonical sealed record schema
and unconditionally refuses approval, ACK and recovery methods. The original
absence/durability fields and all subsequent observations are mock-supplied;
no protected root journal, actual unit birth, or trusted publisher exists.
See `docs/security/ge04-original-prebirth-issuance.md`. R1-B1 OPEN and
SECURITY HOLD ACTIVE.

### Exclusive prebirth journal persistence fixture — unprivileged only

Added `native/ge04/prebirth_fixture_journal.py`, an unprivileged disposable
fixture that uses no-follow exclusive creation of a canonical original
prebirth record, file and directory fsync, and refuses all reopen/retry as
quarantine. Its separate caller-supplied unit-absence probe is sampled before
and after the write and is **not authenticated**. Seven tests cover fault
injection after write/file fsync/dir fsync, corrupt journal, symlink, wrong
permissions, forced root refusal and missing absence. It creates no systemd
unit or root file, and has no ACK or recovery authority. A protected issuer
and independently verified new unit birth remain unimplemented; GE-04 HOLD.

### Actual systemd absence observation for unprivileged original journal

Added a read-only system-bus negative observer that pins the root-owned
manager name and requires two exact fixed-unit GetUnit NoSuchUnit and
GetUnitFileState FileNotFound observations. Installed, loaded, ambiguous and
owner-substituted cases refuse. The optional unprivileged journal fixture
can use this observer before and after file/dir fsync, replacing a synthetic
absence callback with real current systemd evidence. Absence is not a lock
or atomic exclusive unit creation; original attempt and publisher are not
authenticated. No service creation, root access or ACK was enabled. B1-B,
independent security review, disposable VM and Q13 remain OPEN.

### Fixed exclusive unit-birth handoff — non-authorizing prototype

`exclusive_birth_handoff.py` now specifies a four-step caller-supplied
sequence: original persisted PREBIRTH and fixed-unit absence observation;
non-replacing `StartTransientUnit(mode=fail)` creation job claim; matching
`done` completion claim; fixed manager invocation, keeper and no-restart
observation. Any missing/failed/replayed/ambiguous transition permanently
quarantines the attempt. Nine synthetic tests pass, including immutable
read-only observer snapshots. No D-Bus mutation,
root issuer, authenticated job transaction, unit creation, phase ACK or
recovery implementation exists; all authority methods refuse. The
independent source/privilege review and approved disposable VM remain
blocking, and SECURITY HOLD remains active. See
`docs/security/ge04-exclusive-birth-handoff.md`.

### One-use systemd JobRemoved event shape (diagnostic only)

Added `systemd_job_event_contract.py` to reject caller-supplied job event
mismatches and replays, checking fixed unit, manager unique sender, exact
job path/numeric ID, and `done`. The result remains UNQUALIFIED: no real
D-Bus subscription, authenticated manager event, root issuer, unit birth,
ACK, recovery or production consumer exists. A protected controller must
subscribe before the creation request and keep the original job receipt,
fail closed on lost signals/restarts, and separately validate kernel birth.
R1-B1 OPEN, GE-04 SECURITY HOLD ACTIVE.

### Actual read-only systemd JobRemoved signal observer

Added an unprivileged, short GLib/D-Bus JobRemoved listener for the fixed
service and root-owned manager, validating expected job ID/path, unique
sender, `done` and unchanged manager. A timeout, mismatch, missing signal or
owner change refuses. The expected job is not authenticated original
creation evidence; it is caller supplied and remains UNQUALIFIED. The event
window is capped at 2 seconds, but synchronous D-Bus setup/cleanup is not
bounded by that clock. No systemd unit is created, worker admitted, root
helper invoked, ACK issued or security gate lifted. See
`docs/security/ge04-systemd-live-job-signal-observation.md`.

### Isolated JobRemoved observer with parent-enforced process deadline

Added an unprivileged Python subprocess wrapper for the real read-only
JobRemoved listener. It enforces an absolute <=3s end-to-end parent budget,
nonblocking capped pipes, exact canonical witness parsing and kill/reap on
hung system-bus setup, subscription or cleanup. Tests include a hung worker,
oversized stdout, noncanonical and forged positive replies; all outputs remain
UNQUALIFIED. No exclusive systemd creation, independently authenticated
original journal, phase ACK, root execution or security gate release.
R1-B1 OPEN; GE-04 SECURITY HOLD ACTIVE.

### Cross-source birth packet reconciliation — non-authorizing

Added a pure one-use consistency checker comparing the original canonical
prebirth/journal and postbirth record with a fixed creation/job claim, raw
JobRemoved event, bounded live-signal summary, systemd manager and supplied
kernel keeper/mount/cgroup evidence. Mismatches and replay quarantine;
11 synthetic adversarial tests pass. The caller can still forge every
input, original cgroup ancestry remains separately unpinned, and no durable
replay prevention exists. No privileged creation, ACK, worker admission or
security clearance. See `docs/security/ge04-cross-source-birth-reconciliation.md`.

### Durable consumption journal fixture, no privileged recovery

Added an unprivileged O_EXCL birth-consumption marker that is fsynced before
the existing cross-source packet check. Any crash, failed check or process
restart prevents reuse of the existing marker within its user-owned directory;
8 adversarial fixture tests cover crash boundaries, substitution and replay.
The same UID can delete the marker, so it establishes no protected durable
replay prevention. No unit creation, root journal, ACK, cleanup or security
release. See `docs/security/ge04-transaction-consumption-fixture.md`.

### Protected owner authority gate contract — refusal only

Added `protected_owner_review_boundary.py`, a pure diagnostic gate map that
refuses to promote caller-supplied claims (including all-true claims) into
root issuer custody, exclusive unit birth, job/kernel ownership, phase ACK,
VM qualification or independent signoff. All privilege-bearing methods are
unconditional refusals. Six focused adversarial tests pass; no actual trusted
controller has been implemented. See
`docs/security/ge04-protected-transaction-owner-contract.md`.
R1-B1 OPEN; GE-04 SECURITY HOLD ACTIVE.

### Protected Root Controller Phase 1 — native source implementation begins

Added `protected-prebirth-journal.[ch]` with a root-only fixed-path exclusive
prebirth journal primitive and held descriptor/inode rechecks, plus
`protected-root-controller.c` whose main ALWAYS exits 77. This begins actual
production-intended C source, replacing the earlier pattern of standalone
synthetic validation layers. Tests compile the native library under strict
warnings and check exact Python prebirth format compatibility, malformed
inputs, unprivileged refusal and unconditional controller hold. No privileged
execution, original boot/attempt source, service creation, ACK, cleanup,
recovery, or security acceptance. See
`docs/security/ge04-protected-root-controller-phase1.md`.

### Phase 2 — native first-attempt fence and kernel boot identity

Implemented production-intended `protected-attempt-fence.[ch]`: kernel boot
UUID normalization, getrandom nonce, exclusive fsynced root-only first-attempt
ledger and held identity verification. Prebirth native journal staging now
requires the same held attempt fence both before and after writing. The
controller binary still exits 77 with no override; all tests execute only
as unprivileged user. No trusted root staging or second-attempt/recovery
protocol, no unit creation or phase ACK. B1 gates remain OPEN.

### Protected Root Controller Phase 3A — native systemd manager subscription

Added production-intended `protected-systemd-transaction.[ch]` with a private
libsystemd bus, pinned root-owned manager unique owner, original attempt and
prebirth held-descriptor checks, and a JobRemoved match before Subscribe.
The fixed-unit creation API is an unconditional EPERM/security hold and the
controller executable still exits 77. Unprivileged native compile/link,
denial and cleanup tests cover the source; there is no actual exclusive
creation request, job-completion authority, unit birth or phase ACK. B1 gates
remain open pending independently reviewed protected root execution.

### Phase 3B1 native request-cookie/job completion binding (no creation)

Extended production-intended `protected-systemd-transaction.[ch]` with one
nonzero outgoing D-Bus cookie, same-bus/manager METHOD_RETURN reply checks,
canonical positive systemd job path, and one matching fixed-unit JobRemoved
signal (either before or after the reply). Substitution, replay or failure
poisons. The outgoing creator never sets its request cookie, as the entire
StartTransientUnit call remains EPERM-disabled; this is source and
unprivileged injected-event tests only. No production manager birth, root
run, phase ACK or Q13 clearance. See
`docs/security/ge04-protected-root-controller-phase3b1.md`.

### Phase 3B2 — fixed native systemd request body source, no dispatch

Added `protected-systemd-request.[ch]` with an exact hardcoded
StartTransientUnit message payload: fail-mode fixed unit, Type=exec,
NoNewPrivileges, Delegate, one candidate uninstalled keeper path and no
auxiliary units. The serializer has no bus/send operation; native held
creation remains unconditional EPERM and controller still exits 77.
Unprivileged tests verify literal fields, container ordering and injected
serialization failures. No service launched, root run, ACK or Q13 clearance.
See `docs/security/ge04-protected-root-controller-phase3b2.md`.
