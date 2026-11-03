# GE-04 — isolated supervisor preflight prototype

**SECURITY HOLD. Experimental only. No helper execution, authorization, mutation, or receipt.**

Run `python3 experiments/ge04/test-supervisor-preflight.py`. The standalone `supervisor-preflight.py` takes a helper pathname, a separately supplied expected SHA-256, and a pre-existing evidence directory. It refuses symlink helper paths, writable or multiply linked helper inodes, incorrect digests, and evidence directories that are not owner-only. It copies the helper to a sealed Linux memfd, re-hashes the copy, verifies all seals, and fsyncs an exclusive `pre_spawn` record under the pinned evidence directory. The record explicitly states `admission: NOT_AUTHORIZED`. The sealed memfd is closed without executing anything.

The adversarial smoke test proves that digest mismatch, writable helper and symlink denial leave the evidence directory empty; successful preparation writes exactly one private pre-spawn record. The existing sealed-memfd execution experiment is separately rerun as a regression. No attempt ID can be used to infer authorization or execution.

## Not yet trusted

- The command-line digest is caller-supplied. It is **not** pinned by a protected manifest or independently authenticated build provenance.
- The test runs with one OS UID; evidence root ownership and mode checks do **not** establish a worker-inaccessible store. The path's ancestor directories, mount trust, rename races and same-UID tampering are not solved.
- The helper's original inode may be mutable by privileged actors during the copy. Metadata checks and a final digest do not constitute an authenticated source; the sealed copy itself cannot be modified after sealing.
- The prototype has no coordinator authentication, policy/lease admission, approval consumption, kernel-bound child identity, terminal receipt, cross-process revocation fence, crash reconciliation or replay.
- This is intentionally separate from the high-impact TypeScript launcher and protected evidence writer. Neither production wiring nor a merge is authorized.

## Real distinct-UID adversarial gate (CI pending)

`experiments/ge04/test-supervisor-distinct-uid.py` requires explicit root execution (never elevates itself), prepares a supervisor-owned evidence record, forks a child with kernel UID/GID 65534, and demands `EACCES`/`EPERM` on read, overwrite, create, and unlink attempts. The temporary parent is mode 0755 so the test isolates denial at the evidence directory rather than relying on an inaccessible parent. The existing GE-04 privileged CI job runs the test with `sudo -n` and requires the explicit PASS marker. On an unprivileged local machine the script exits nonzero with `REQUIRES root (not a pass)`; this is **not** a local qualification. A green privileged CI run is still needed. This tests only filesystem DAC isolation; it does not authenticate the supervisor or provide durable terminal receipts.

Next: design a protected supervisor-owned installation/manifest and verify this real distinct-UID gate in CI, then introduce an authenticated admission protocol before any mutation-capable helper execution.
