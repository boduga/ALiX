# GE-04: Atomic filesystem mutation boundary — implementation contract

Status: DESIGN ONLY / SECURITY HOLD. This document does not qualify GE-04 or authorize a merge.

## Observed implementation gaps

- `src/capabilities/tools/tool-router.ts` `file.create` now pins existing leaf descriptors with `O_NOFOLLOW`, but `mkdir(dirname(...))` and the initial exclusive create still resolve parent directories by pathname. An attacker who can replace a parent directory between authorization and use can redirect a write.
- `src/execution/patch/patch-engine.ts` uses separate `resolvePatchPath` checks and pathname-based `writeFile` for search/replace, structured patches, and unified diffs. `rm` and directory creation are also pathname-based.
- Shell-mediated writes and external tools cannot be made safe merely by checking path strings before command execution.
- `O_NOFOLLOW` only protects the final component; canonical checks and lstat/realpath rechecks are not atomic authorization of a future mutation.

## Security invariant

For each mutating operation, the directory actually used by the kernel to perform the operation MUST be a descendant of the authorized, pinned workspace and owned-scope directory handles, and the leaf MUST satisfy the operation's preconditions. The authorization and mutation MUST refer to the same pinned objects, not separately resolved pathnames. A symlink swap MUST never cause a write, create, rename, or delete outside the authorized directory tree.

## Proposed capability boundary

Introduce an internal `ScopedMutationService` used by `file.create`, `file.delete`, patch application, and checkpoint restore. It receives an immutable authorization context (workspace, owned scopes, protected/sensitive paths, policy revision, worker identity), an operation, and relative target path. It returns a structured result and mutation evidence. No caller may supply a trusted absolute path as a substitute for authority.

On Linux, implement a reviewed native helper using directory file descriptors and `openat2` with `RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS` (and appropriate `RESOLVE_NO_MAGICLINKS`) or an equivalent audited fd-relative walk; perform `openat`/`mkdirat`/`renameat`/`unlinkat` relative to pinned directory handles. Resolve owned scopes under the workspace root without following symlinks. Recheck policy revision/lease validity at the final boundary. Never fall back to pathname-based writes if the primitive is unavailable.

On macOS and Windows, provide equivalent native handle-relative guarantees or fail closed for governed writes until independently qualified. A platform-specific implementation must have its own adversarial tests; Linux behavior alone cannot qualify cross-platform safety. A Node-only `realpath`/`lstat`/`O_NOFOLLOW` implementation is NOT equivalent to the invariant.

## Operation contracts

- **Create:** exclusive create; identical existing content returns unchanged success; differing existing content requires an owned overwrite authorization. Parent creation must remain beneath pinned directories.
- **Overwrite:** open an authorized regular file without symlink following; verify pinned identity and preimage, write via pinned handle or safely replace via fd-relative rename. For failure atomicity, prefer same-directory temp file, fsync, and fd-relative rename after final authorization. Preserve metadata policy explicitly.
- **Patch:** plan and validate every file before mutations; preimage hashes refer to pinned content. Apply operations through the same service. Preserve checkpoint and rollback semantics; do not claim all-or-nothing multi-file transactions without a journal and crash recovery.
- **Delete:** operate on a validated leaf relative to pinned parent, without following symlinks; clarify symlink-unlink policy separately.
- **Shell:** shell commands with arbitrary filesystem mutation are not safely scope-enforceable through argument extraction alone. Deny in owned/governed mode unless executed inside an independently qualified OS sandbox with a restricted writable mount view. Explicit policy approval does not substitute for containment.

## Adversarial qualification matrix

1. Symlink at owned root, nested parent, and final leaf (inside/outside workspace).
2. Dangling links, symlink loops, non-existent nested parents, absolute and `..` traversal, path normalization, and platform separators.
3. Deterministic parent swap between authorization and create, overwrite, delete, and patch; assert external sentinel unchanged.
4. Concurrent workers writing different contents; prove no unowned inode mutation and document expected conflict behavior.
5. Symlink swap during patch preimage verification and checkpoint restore; prove no external mutation.
6. Shell-mediated `>`, `mv`, `cp`, script execution and command substitutions in governed mode; demonstrate denial or sandbox containment.
7. Crash and partial write, disk-full, permissions, and cleanup failures; verify journal/recovery and audit evidence.
8. Linux, macOS and Windows CI coverage of each supported backend; unsupported backend must fail closed.

## Final-boundary authorization protocol (required before production)

A parent/child READY/GO handshake alone is **insufficient**: authority can be revoked after GO and before `openat2`/`write`. The production design must provide one linearization point shared by **all** lease/policy revocations and governed mutations, including independent daemon processes.

1. **Single authority coordinator.** All ownership lease revocations, policy invalidations and governed mutation admissions must use one durable, cross-process synchronization domain. Any bypassing writer or revoker invalidates the guarantee. A module-private JavaScript verifier brand, `instanceof`, and an in-memory mutex do not provide this guarantee.
2. **Prepare and pin.** The native worker opens workspace and owned-scope directory handles with no symlink traversal. It reports a unique request identifier, operation digest and pinned identity over an authenticated, private IPC channel; it must not accept an untrusted GO token from argv, environment, or an arbitrary process.
3. **Authorize under exclusive coordination.** The trusted coordinator acquires the shared mutation/revocation exclusion lock, reloads authoritative policy and lease state, validates the exact invocation and the already-consumed approval claim, then authorizes only that specific worker/request. The lock must remain held until the kernel mutation has completed or definitively failed. A revocation waits for this operation to finish, or wins the lock first and prevents it.
4. **Mutate and acknowledge.** While the coordinator retains exclusion, the helper performs the fd-relative operation and returns a terminal receipt tied to the request identifier. A broken pipe, crash, timeout, or missing receipt yields an **unknown** outcome, not a fabricated failure or success; reconcile the on-disk state before settlement.
5. **Release and audit.** Persist the outcome and release exclusion in a documented order; ensure the lock cannot become permanently held after process crashes. Establish explicit ordering between lease expiry, monotonic clock checks, lock acquisition and the mutation linearization point. Do not claim expiry guarantees stronger than the protocol enforces.

### Read-only recovery inspection after restart

`src/execution/filesystem/ge04-recovery.ts` exposes `inspectGe04UncertainClaims(ApprovalStore)`: it reloads the durable approval store and reports consumed claims whose outcomes are `pending` or `unverified`, with approval id, worker id, consumption timestamp and invocation fingerprint. Storage errors propagate; no filesystem write, replay, claim classification or lease mutation occurs. A test reopens a fresh store after a helper writes then exits nonzero and verifies that the unresolved claim survives and replay is still denied. `assessGe04Reconciliation` explicitly returns `eligibleForAutomaticTransition: false` for every uncertain claim because the approval ledger lacks a trustworthy execution-owner identity and native receipt. Supplying a guessed PID or observing a stale heartbeat must not change this result. **This is inspection, not completed crash recovery**: there is no trustworthy dead-worker attestation, native terminal receipt or automatic reconciliation yet. The API intentionally does not assert a pending claim belongs to a dead worker.

### Ambiguous helper outcome quarantine

The experimental adapter now treats a spawned helper that exits nonzero or by signal as an **unverified mutation**, not a proven failure. The consumed approval remains unsettled for reconciliation; a second attempt cannot replay that approval. A deterministic test has the helper create a file and then exit nonzero, demonstrating why exit code alone cannot establish no mutation. A spawn failure before execution is still reported as an error. This is only an in-process quarantine behavior, not a crash-recovery journal or a qualified terminal receipt protocol.

### Experimental ownership-only fence (not a production boundary)

`OwnershipRegistry.withExclusiveLeaseFence` now holds the existing cross-process ownership lock across the experimental helper invocation. `ScopedMutationAuthorizationGrant.withLeaseFence` uses this API, so an explicit `OwnershipRegistry.revoke` or `release` cannot interleave with the helper's write after the fence is acquired. A revocation that wins first prevents dispatch. A regression test exercises competing registry instances and verifies that revocation waits for the fenced action.

**Current approval semantics:** `ApprovalStore.revoke` explicitly refuses a `consumed` approval. A successful `consumeApproved` therefore cannot be retroactively revoked using that method. Policy invalidation similarly operates on `approved` records, not consumed claims. The outstanding problem is **new policy configuration taking effect** or lease expiry while an already-consumed operation is in flight; merely locking the approval store cannot serialize either event. The final design must specify whether in-flight operations are grandfathered, cancelled before mutation, or marked unknown, with one enforceable linearization point for policy publication and mutation. Do not present approval-store revocation as a protection against a consumed grant.

**Expiry finding:** An already-expired lease is denied before entering the fence, but a lease can expire during a long-running fenced action. The lock serializes explicit registry revocation/release, not wall-clock expiry. Regression tests intentionally demonstrate both cases; a time check at fence entry is not an expiry guarantee through the kernel write.

**Limits:** This fence does not serialize policy configuration changes or approval-store revocation, and a lease may expire while the action is running. The lock is held for the entire helper lifetime, so lock waiters can fail closed on timeout. The current prototype also has no crash-reconciled mutation receipt. Do not call this the final atomic authorization boundary, and do not register the experimental backend in production.

**Unresolved design work:** the current `OwnershipRegistry`, policy revision checks, and native helper do not implement this shared coordination protocol. Cross-process lock ordering, crash recovery, helper authenticity, parent/child liveness, and filesystem commit semantics need an ADR and adversarial tests before implementation can be qualified. In particular, merely adding a READY/GO message to the current helper would **not** close the TOCTOU gap.

## Release gates

- Independent reviewer verifies the native primitive, authority binding, and all mutation call sites.
- Red-team tests run against the exact pinned commit, with reproducible swap harness and sentinel assertions.
- No regression to existing idempotency, ownership, protected-path, checkpoint, and audit semantics.
- Evidence identifies any remaining unsupported mutation channels. Until then, GE-04 and D9 Phase F remain HOLD.

## Experimental adapter authorization guard (2026-11-02)

The opt-in `ExperimentalLinuxScopedMutationService` requires an injected
authorization verifier that is **only** obtainable from
`createScopedMutationAuthorizationVerifier`
(`src/execution/filesystem/scoped-mutation-authorization.ts`). A caller-supplied
callback is rejected at construction by a module-private brand, closing the
previous fail-open where any `async () => true` satisfied the guard. Missing
identity/revision/lease/approval metadata, a `null` grant and verifier errors
all fail closed.

The verifier factory now rejects plain-object substitutes for the approval and ownership stores (`instanceof` checks), and the live lease predicate refuses existing symlinked parent components before consuming an approval. These are defense-in-depth checks, **not** proof of a trusted same-process caller or an atomic kernel authorization boundary: JavaScript prototypes can be manipulated, canonical prechecks can race, and the native helper still does not validate policy/lease/approval itself.

The composition reuses ALiX's existing authorities and adds no second one:

- **Policy:** `computePolicyRevision` — the same fingerprint the coordination
  scheduler uses to invalidate stale approvals. `PolicyGate` is deliberately NOT
  re-invoked at this boundary because its `evaluate*` methods mint and reuse
  approvals as a side effect.
- **Approval:** `ApprovalStore.consumeApproved`, the one atomic single-use
  claim. The record must be `approved`, unexpired per `approvalExpiryState`,
  bound to this worker and policy revision, and match the exact invocation
  (`computeScopedMutationInvocation` → the shared `computeInvocationFingerprint`).
  A forged, pending, expired, revoked, already-consumed or differently-bound
  record is refused without spending a valid one.
- **Ownership:** `OwnershipRegistry` via `createLiveScopedLeaseVerifier` and the
  shared `scopeContains` matcher.

The experimental adapter also revalidates the grant immediately before helper dispatch. If the lease or policy lapses after the approval claim but before dispatch, it settles the attempt as failed and does not spawn the helper. This does **not** close the interval between dispatch and the kernel mutation: the native helper still needs a trusted, enforceable final-boundary authorization protocol.

The grant also exposes `revalidate()` and `settle()`. `revalidate()` re-checks
the lease and policy revision **after** the helper runs: authority that lapses
mid-write cannot be reported as `created`/`changed: true` — the adapter returns
`{ kind: "unverified", changed: true }` instead. This narrows, but does not
eliminate, the residual verification-to-spawn TOCTOU window; Node cannot hold
the kernel's checks across a process boundary, so a production integration needs
the fd-relative primitive to re-check authority itself before the final write.

Still NOT qualified: the native helper, executable packaging, cross-platform
backends and independent review are outstanding, and production service
selection remains unregistered and fail-closed (`createScopedMutationService`).
Adversarial coverage lives in
`tests/execution/filesystem/linux-scoped-mutation.test.ts` (forged/expired/
revoked/mismatched lease, policy revision mismatch, forged/pending/expired/
revoked/mismatched approval, changed bytes or target, single-use replay, mid-flight
lapse, and the opt-in real native helper).

### GE-04 experimental pre-spawn evidence (2026-11-02)

The experimental adapter now creates and syncs an exclusive attempt record in `.alix/ge04/attempts/` before native helper dispatch. It contains the approval ID, lease ID, worker ID, invocation, host PID and timestamp. Failure to persist blocks dispatch. This is not a child-process identity, authenticated native receipt or evidence that a mutation occurred. No automatic recovery transition is authorized by these records.

### Helper termination test

A regression test verifies that a helper can write and then terminate by signal. The adapter returns an uncertain outcome, and restart inspection retains the pending consumed claim. This does not demonstrate recovery from host termination or authenticate a native receipt.

### Host termination after attempt journal fsync

A separate Node host process writes and syncs a GE-04 pre-spawn record, then is terminated by SIGKILL. The surviving test process reads the journal and verifies the persisted approval, PID and pre-spawn state. This proves persistence across host termination at that checkpoint only. It does not cover a host crash during a native write, helper identity, receipt authenticity or automatic recovery.

### Host termination while a helper remains active

An adversarial process test starts a shell helper from a separate Node host, waits for the helper to begin, and terminates the host with SIGKILL. The helper can survive and create a file after host death. The persisted pre-spawn record cannot distinguish this from a completed or failed helper. Therefore host liveness alone is not sufficient to reconcile consumed approvals or authorize replay. This is a controlled process-lifecycle reproduction, not a native C helper receipt test.

### Native helper persistence before zero exit

The experimental Linux C helper now fsyncs the created file and its actual containing directory, including nested paths, before returning zero. A failed sync or inability to reopen the containing directory returns nonzero, which the adapter quarantines as an ambiguous outcome because creation may already have occurred. This is not an authenticated receipt, cross-process authorization barrier or proof of power-loss durability on every filesystem and storage stack.

### Real native helper survives parent SIGKILL

`experiments/ge04/test-native-host-crash.py` compiles the actual C helper with test-only barrier hooks, starts it through a separate Python host, kills that host while the helper is blocked at its pinned-directory barrier, then releases the helper and observes the created file. This confirms the orphan-helper hazard against the real native prototype. The test uses no approval/lease authority and provides no authenticated terminal receipt; it must not be treated as production qualification.

### Journal symlink rejection (defense in depth)

The experimental attempt writer now rejects symlinked workspace ancestors and journal components, creates journal directories individually, and opens new records with exclusive create and `O_NOFOLLOW`. Tests cover workspace and `.alix/ge04/attempts` redirection. This is **not** a trusted journal: path checks and subsequent path-based opens still race with concurrent renames, and workspace writers may tamper with records. Move the journal into a protected authority-owned store with fd-relative pinned operations before relying on it for recovery decisions.

### Journal directory permissions

The experimental journal writer now rejects `.alix`, `ge04`, and `attempts` directories unless owned by the executing Unix UID and inaccessible to group/other users. This is a fail-closed check against cross-user interference, not a protected authority store: a worker running as the same UID can still tamper with or rename the directories, and path-based checks remain subject to TOCTOU. Recovery must not treat these records as authenticated evidence.

### Same-UID journal forgery demonstrated

`ge04-journal-tamper.test.ts` demonstrates that a second same-UID filesystem writer can replace the approval ID inside a persisted pre-spawn record despite owner-only directory modes. Thus mode `0700`, symlink checks and `O_NOFOLLOW` do not establish an authority-owned trust boundary when workers share the coordinator UID. Journal data remains **untrusted diagnostic evidence only**, never proof of authorization, native execution or eligibility for automatic reconciliation. Production qualification requires OS-level isolation (distinct security principal or equivalent) and fd-relative protected evidence storage, or a separately authenticated durable receipt protocol whose signing authority workers cannot access.

### Experimental evidence-store isolation preflight

`assertGe04EvidenceIsolation` rejects same-UID worker ownership of the evidence root, workspace/evidence ancestry overlap, symlinked path components, permissive evidence-root modes and group/other-writable ancestors. It requires the coordinator to own the evidence root. This is a **standalone preflight**, not wired to production or journal writes: it retains no directory FD, cannot defeat concurrent same-UID renames, cannot prove a worker actually runs under the declared UID, and does not authenticate native-helper receipts. Do not treat a passing check as permission to reconcile or replay consumed approvals.

### Experimental pinned evidence writer

`recordGe04ProtectedEvidence` adds a standalone Linux-only writer for an evidence root that passes the isolation preflight. It opens the root with `O_DIRECTORY | O_NOFOLLOW`, verifies ownership and owner-only permissions against the pinned FD, creates an exclusive record through `/proc/self/fd/<directory-fd>/` and fsyncs the record and directory. This prevents a subsequent pathname rename from redirecting the leaf create away from the pinned inode. It is **not wired into** the production or experimental mutation adapter, and its worker UID is caller-supplied rather than attested. The test only simulates distinct UIDs. No native helper attests the record; no automatic reconciliation or replay is permitted. Production needs real worker credential isolation, protected IPC, and crash-safe authenticated receipts.

### Declared worker UID spoofing demonstrated

`ge04-protected-evidence-credential-spoof.test.ts` demonstrates that passing a different `workerUid` into the pinned writer does not establish actual process separation: a same-UID actor can still rewrite its evidence record. The machine's unprivileged user-namespace probe did not succeed; real separate-UID access-denial tests remain unverified here. Worker identity must come from an OS-attested execution boundary rather than caller-provided configuration. Until then protected records remain diagnostic, not authoritative receipts.

### Linux worker credential observation prototype

`inspectGe04WorkerCredentials` reads Linux `/proc/<pid>/status` UID/GID fields and `/proc/<pid>/stat` start-time ticks, rejecting same-UID and inconsistent-credential processes. Focused tests exercise same-UID rejection and read-only observation of a different-UID process. This is **not an OS-enforced worker launch boundary**: PID lookup can race process death/reuse and a different-UID PID is not proof of an ALiX-owned worker. A future implementation must bind a supervised child process to a pidfd (or equivalent), verify its credentials at the execution boundary, enforce isolation for the worker's entire lifetime, and avoid passing coordinator-owned evidence FDs to the worker. No recovery or production mutation path uses this prototype.

### Bracketed worker identity observation

`inspectGe04WorkerCredentials` now reads `/proc/<pid>/stat` before and after the UID/GID observation and rejects a changed start-time identity. `ge04-supervised-worker-identity.test.ts` launches and cleans up a real same-UID child and confirms denial. This narrows a simple PID-replacement window but **does not close PID reuse or credential-change races**, attest a child was spawned by the coordinator, or provide a pidfd-held execution boundary. The child test is not a distinct-UID filesystem denial test. No production or reconciliation authorization is enabled.

### Experimental distinct-UID worker launch guard

`spawnGe04IsolatedWorker` is an unwired Linux-only launcher prototype. It rejects same-UID workers, invalid UID/GID values, relative executable paths and unprivileged coordinator attempts to change UID. When privileged, it requests UID/GID at spawn and checks observed `/proc` credentials; on failed verification it kills the child. The tests on this unprivileged host validate rejection only, **not** a real distinct-UID launch or filesystem denial. The launcher has no pidfd, sandbox, executable allowlist, or authenticated helper receipt, and must not be used as an authorization boundary or enabled in production.

### Opt-in real cross-UID evidence denial test

`ge04-distinct-uid-denial.test.ts` exercises a real Linux worker under UID/GID 65534 and checks that it cannot read, overwrite, or create files under a coordinator-owned 0700 evidence directory. It executes only when the test runner is already privileged; otherwise it explicitly **skips** without attempting elevation. On the current unprivileged host this test was skipped, so cross-UID denial remains **unverified**. A privileged controlled CI runner must execute it and report a passing result before treating this boundary as demonstrated. This does not establish pidfd supervision, trusted receipts, or recovery safety.

### Dedicated cross-UID CI gate

`.github/workflows/ci.yml` defines a branch-restricted, least-privilege GitHub-hosted Linux security job for the GE-04 pull request. It builds ALiX and runs the real cross-UID filesystem denial test under an explicitly privileged test runner; any skipped test fails the job. This is a test-only CI privilege context, not a production privilege grant. Workflow existence does not establish a passing result: require a linked successful GitHub Actions run before marking the cross-UID evidence denial verified.

The standalone manual workflow was not registered on the default branch (GitHub dispatch returned HTTP 404), so the gate was moved into the existing PR CI workflow as the `ge04-cross-uid-denial` job, restricted to the GE-04 feature branch. Do not interpret the workflow definition as proof of a successful privileged run; inspect its GitHub Actions result.

### Cross-UID CI run outcome and gate correction

GitHub Actions run `41583983711`, job `125745057216`, executed the distinct-UID filesystem denial test under privileged Linux and reported **tests 1, pass 1, fail 0, skipped 0**. The job itself failed because the first gate matched the literal `skipped 0`. The CI assertion was changed to require exact test totals (one test, one pass, zero failures, zero skips). This verifies the tested owner-only directory denial, **not** end-to-end GE-04 authorization, helper identity, or crash-safe recovery. A subsequent green CI job is still required to validate the corrected gate.

### Native containing-directory inode pinning

The native `scoped-owned-create.c` helper now resolves and pins the *containing* directory before its test barrier and before file creation. It creates the leaf relative to that fd and fsyncs the **same fd**, rather than reopening a mutable parent pathname after creation. `test-nested-parent-swap.py` deterministically renames and symlink-replaces the nested containing directory while the helper is paused, then verifies the file remains under the pinned original inode and the unowned directory is untouched. Basic helper, owned-parent swap, nested-parent swap, and native host-crash characterization tests passed. This fixes the directory-identity fsync race but **does not** prevent an orphan helper from mutating after coordinator death; the native host-crash test still demonstrates that gap.

### Native helper parent-death binding

The experimental Linux helper now sets `PR_SET_PDEATHSIG` to `SIGKILL` at entry and checks that its immediate parent PID is unchanged across registration. A deterministic native test pauses before mutation, SIGKILLs the spawning host, observes the helper exit or become a zombie, releases the barrier, and verifies no file appears. This closes the demonstrated *paused orphan helper* reproduction. The kernel signal is asynchronous relative to an in-flight syscall and does not establish transactional rollback, cross-process revocation fencing, authenticated receipts, or guaranteed absence of mutations already underway at the instant of host death. Production remains disabled.

### Experimental native terminal notification (not a trusted receipt)

The native helper optionally accepts `GE04_ATTEMPT_ID` and `GE04_RECEIPT_FD`, and writes `GE04v1 <attempt-id> fsynced` to an inherited descriptor only after syncing the created file and its containing directory. The standalone test verifies the attempt-bound notification and separately proves that a missing notification fd can produce a nonzero exit **after** a file has been created. Therefore no receipt or nonzero exit may authorize automatic replay. This protocol is **not authenticated or crash-safe**: environment variables and inherited descriptors alone do not prove helper identity, no protected durable evidence is persisted, and the adapter does not yet supply or verify it. Keep the production backend disabled and consumed claims quarantined pending a protected receipt/identity design.

### Terminal notification pre-mutation validation

The native helper now checks that both optional notification parameters are supplied together, validates the UUID-shaped attempt ID, and verifies that the inherited notification descriptor exists **before** opening or creating a target. The regression verifies missing configuration cannot create a file, while a valid but non-writable descriptor still demonstrates an ambiguous post-fsync notification failure. These checks do not authenticate the supervisor, establish write capability in advance, or make receipts durable; no automatic reconciliation is authorized.

### Experimental adapter attempt-bound notification channel

The experimental `ExperimentalLinuxScopedMutationService` now passes the journal-generated attempt ID to `invokeHelper`. Its opt-in `requireNativeNotification` mode gives the child a dedicated fd 3 and requires both a zero exit and exactly `GE04v1 <attempt-id> fsynced` before reporting helper success. Missing, mismatched or nonzero outcomes are quarantined as unverified. Legacy test fixtures still use the default mode; the real native integration test opts into strict notification. The adapter does **not** yet verify the executable's identity, authenticate the child as the intended helper, persist a protected terminal receipt, or reconcile a consumed approval after a crash. In particular, a substitute executable can forge the text notification, and a successful in-memory notification is not durable evidence. No production enablement or automatic recovery is permitted.

### Adversarial forged-notification reproduction

`tests/execution/filesystem/ge04-notification-spoof.test.ts` demonstrates a substituted shell executable that reads the supplied attempt ID and writes the exact expected `GE04v1` message to fd 3, then exits zero without executing the audited native helper. This test passes and establishes that notification text plus exit status does not authenticate the executable or establish mutation durability. This is a negative security test, not a qualifying receipt test. Automatic reconciliation remains prohibited until verified helper identity and protected durable evidence are implemented.

### Experimental helper executable integrity preflight

`inspectGe04HelperIntegrity` opens the configured helper with `O_NOFOLLOW`, checks a pinned regular-file descriptor's owner UID, rejects group/other-writable files, requires an executable bit and single hard link, hashes its bytes with SHA-256, and checks metadata before/after the read. The focused regression rejects changed content, writable modes and symlink aliases. This is **not exec-time authentication**: the helper is not launched through the verified descriptor, an attacker can replace the executable path after inspection, and an owner-writable file can be altered by a same-UID process. The preflight is standalone and deliberately not wired into the adapter or production. Do not use its passing result as evidence that the executed process matches the verified digest. A qualified design needs an immutable/protected executable and a launch protocol binding the executed inode to the verified descriptor, plus kernel process supervision and protected durable receipts.

### Experimental descriptor-bound helper execution

`launchGe04PinnedHelper` preflights the configured executable's digest and ownership, opens a second descriptor, checks that its device/inode matches the inspected file, and launches `/proc/self/fd/4` with that descriptor inherited as fd 4; fd 3 remains the attempt-bound notification pipe. The real native integration test verifies successful execution and notification. This prevents pathname replacement *after* the descriptor is pinned from redirecting execution to a different inode. **Not qualified:** the preflight and pin are distinct opens, content may change on the same inode after hashing, the helper owner may be the same UID as a hostile worker, executable ancestry is not independently protected, and the notification remains spoofable by an executable that passes the configured digest. No protected terminal receipt or automatic reconciliation exists. This standalone launcher is not wired to the production or experimental mutation adapter.

### Experimental helper isolation preflight

`assertGe04HelperIsolation` rejects a declared worker UID equal to the coordinator's expected helper owner UID, requires that owner to match the current coordinator effective UID, checks directory ancestors for coordinator/root ownership and no group/other write permissions, and requires a singly linked executable with no write bits. A focused test covers same-UID, writable executable and unsafe `/tmp` ancestry rejection. This is a **standalone preflight only**: `workerUid` is caller-declared rather than verified against the actual kernel worker process, and path checks are subject to concurrent replacement. The coordinator can also chmod its own helper inode after inspection, so this is not immutable execution or a receipt trust anchor. Do not wire this to production or treat it as authenticated helper execution without process-identity and descriptor-bound verification.

### Experimental kernel-observed helper gate

`assertGe04VerifiedHelperGate` composes existing helper-isolation and digest checks with two observations of a worker's Linux `/proc` UID, GID, and process start-time ticks. It rejects caller-declared UID/GID/start-time values that disagree with the first kernel observation, and fails if the second observation differs. A same-UID forgery regression passes unprivileged; the distinct-UID positive test is root-gated and **skipped on unprivileged developer hosts**. This does not bind a process lifetime to a pidfd, protect against PID reuse outside the observation window, pin an immutable executable through the entire launch, or establish an authenticated durable receipt. It is standalone and not wired to the adapter; no GE-04 production or reconciliation authorization may rely on it.

### Descriptor-bound launch denial regression

The pinned-helper integration suite now checks both a successful real native launch and a digest-mismatch rejection that must leave the target file absent. This establishes fail-closed behavior for a mismatched configured digest before launch; it does **not** establish immutable inode contents, pidfd-supervised lifetime, or a trusted terminal receipt. No automatic reconciliation is authorized by these tests.

### Experimental pinned-descriptor integrity refinement (not qualified)

`launchGe04PinnedHelper` now opens the executable once, verifies ownership/mode/link count and hashes the **same open file descriptor** subsequently inherited by the child as fd 4. `inspectGe04HelperIntegrityFd` performs the descriptor-bound verification; the original `inspectGe04HelperIntegrity` remains a standalone wrapper that opens and closes its own descriptor. A regression renames the executable after opening the pinned descriptor, replaces the pathname with different bytes, and proves the pinned descriptor still hashes to the original digest while fresh pathname inspection rejects the replacement. This eliminates the previous two-open pathname substitution gap, but does **not** prevent same-inode modification after hashing, establish immutable protected helper bytes, authenticate a terminal receipt, or guarantee child process lifetime. This remains experimental and unwired; no automatic recovery or production enablement is authorized.

### Owner-writable helper rejection at pinned launch (still not immutable)

The experimental `launchGe04PinnedHelper` now refuses any helper inode with owner, group, or other write permission (`mode & 0222`), even when the pinned-descriptor SHA-256 matches. A real native integration regression verifies that a mode-0700 helper is rejected before creating the requested file, while the mode-0500 native helper still runs and emits its attempt-bound notification. This removes a readily writable executable from the launcher acceptance set; **it does not enforce immutability**. The same UID as the inode owner can change permissions or modify contents, and the coordinator still lacks a kernel-enforced protected executable store, pidfd lifetime binding, or authenticated durable receipt. This launcher remains experimental and unwired. GE-04 stays on security hold.

### Same-inode executable mutation after descriptor verification (negative qualification)

The regression in `tests/execution/filesystem/ge04-helper-integrity.test.ts` now verifies the residual same-UID executable integrity gap without running any governed filesystem mutation. It hashes a mode-0500 shell fixture from an open descriptor, then uses the executable owner's UID to change its permissions, overwrite the **same inode**, and restore mode 0500. Executing `/proc/self/fd/4` with the original pinned descriptor runs the **modified** bytes. A fresh digest check rejects those bytes, but that rejection happens too late to protect the demonstrated execution. This is a deterministic negative characterization of descriptor pinning, **not** an exploit of the production backend (which remains disabled) and not a demonstration that a privileged distinct-UID worker can perform the same action.

**Release implication:** neither a one-descriptor digest check nor mode-0500 is an immutable code identity guarantee when the inode owner can chmod and rewrite it. A production design must provide a protected immutable executable source or a kernel-sealed executable snapshot whose executed bytes are exactly the verified bytes; enforce the helper's owner/security-domain separation from all untrusted workers and prevent mutable alias paths. The launch/receipt protocol still requires authenticated worker identity, cross-process authority fencing, durable terminal evidence, and independent review. No fallback to path-based helper execution, automatic replay, merge, or production enablement is authorized by this test.
