# GE-04 — trusted Linux supervisor protocol (design, not implementation)

**Status: SECURITY HOLD.** This document defines the next experimental boundary; it does not qualify GE-04, authorize production execution, or permit automatic replay.

## Trust model and authority

The coordinator and workspace workers are not trusted to attest their own execution. A separately privileged supervisor must own the helper installation, executable digest policy, protected attempt ledger, and terminal receipt store. The worker must run under a distinct kernel UID with no ability to write the supervisor executable store, supervisor evidence root, supervisor IPC endpoint, or coordinator authorization state. Same-UID separation is **not** a security boundary. A digest supplied by the worker or derived from the file being checked is not provenance. The supervisor must pin an independently approved digest and verify the bytes before sealing.

The existing GE-04 approval claim, policy revision, invocation fingerprint, worker identity, lease, owned path, and attempt ID are separate authority inputs. A worker-provided JSON record is never sufficient evidence. The supervisor must receive the authoritative approval/lease decision over an authenticated coordinator-to-supervisor channel and reject a request whose source, binding, version, expiry, or nonce cannot be established.

## Proposed state machine

`PREPARED → ADMITTED → SPAWNED → FSYNC_CONFIRMED → RECEIPT_DURABLE → RECONCILED`

`DENIED`, `ABORTED_BEFORE_MUTATION`, and `UNCERTAIN` are terminal or quarantined alternatives; `UNCERTAIN` must not become `DENIED` or `SUCCESS` by timeout, PID absence, or worker assertions alone. No state transition permits replaying a consumed approval.

1. **Prepare:** supervisor assigns an unpredictable attempt ID, pins the policy revision and exact invocation fingerprint, records the approved lease and owned path, and fsyncs a protected `PREPARED` entry before launching any helper. No worker may supply the attempt ID as authority.
2. **Admission:** under a cross-process lease/policy revocation fence, revalidate approval consumption, expiry, policy revision, and ownership. The fence must remain effective until mutation has reached an irrevocable, documented point. A coordinator process dying must not silently release the only fence while a surviving helper can mutate.
3. **Executable:** open a protected installation descriptor, verify its ownership and independently approved SHA-256, copy the exact bytes into `memfd_create(MFD_ALLOW_SEALING)`, verify the copied bytes, apply and verify `F_SEAL_WRITE|F_SEAL_GROW|F_SEAL_SHRINK|F_SEAL_SEAL`, and execute only the sealed descriptor. Fail closed on any mismatch, seal failure, or fd handoff ambiguity. Kernel sealing protects bytes; it does not authenticate who requested the action.
4. **Process identity:** supervisor must retain an unambiguous child identity (pidfd or equivalent kernel-bound lifecycle handle), constrain inherited descriptors and credentials, and prevent worker-created or substituted processes from impersonating the authorized helper. A PID plus `/proc` start ticks alone is insufficient to bind a terminal event.
5. **Terminal evidence:** the helper reports completion only after file and containing-directory fsync. The supervisor must bind that event to the supervisor-launched child identity, exact attempt ID, authorized operation and resulting file identity; an inherited writable fd3 text string alone is spoofable. The supervisor writes and fsyncs an authenticated, append-only terminal receipt under a worker-inaccessible directory before reporting success.
6. **Reconciliation:** on restart, read only supervisor-protected durable state, verify receipt identity and monotonic state transitions, and classify missing or ambiguous terminal evidence as `UNCERTAIN`. Reconciliation must never reissue the mutation or reconsume an approval. An operator must explicitly resolve uncertainty with independently verified filesystem evidence.

## Required adversarial gates

- Substitute the helper pathname between verification and execution; replace or mutate the original inode after sealing; show the sealed executable still matches the approved digest.
- Present an attacker-chosen digest, a forged supervisor response, copied approval/lease port, wrong policy revision, expired approval, or revoked lease; no mutation occurs.
- Kill coordinator, supervisor, and helper separately before admission, after admission, during the mutation syscall, after file fsync, and before durable receipt; classify each result without false success or replay.
- Revoke or expire a lease during a paused helper; prove that a post-revocation mutation is impossible under the defined linearization contract.
- Spoof fd3 notification, duplicate attempt IDs, replay receipts, inherit notification fd into descendants, swap PID identities, and tamper with workspace journal; none can create a trusted success record.
- Demonstrate real distinct-UID denial against protected executable/evidence/IPC roots on the target Linux host, not merely simulated UID configuration.

## Implementation sequence

1. Keep current production `UnavailableScopedMutationService` unchanged. Build a separate Linux-only supervisor prototype with a sealed-memfd helper and externally pinned digest. No API exposure to worker code.
2. Add kernel-attested child identity and protected durable pre-spawn/terminal ledger. Prove notification spoofing cannot become trusted success.
3. Define and implement cross-process revocation/expiry fencing with crash semantics, then exercise the kill/revoke matrix.
4. Only after independent security review and all adversarial gates pass, consider a separately authorized production composition change. No step in this document authorizes merge or release.

**Current evidence:** `experiments/ge04/test-sealed-memfd-exec.py` proves Linux memfd mechanics only. The TypeScript pinned launcher and protected evidence writer remain experimental and unwired; GitNexus currently marks their upstream impact CRITICAL. This design does not convert those proofs into authorization or a trusted receipt.
