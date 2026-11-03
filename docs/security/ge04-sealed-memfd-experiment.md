# GE-04 — sealed memfd executable experiment

Status: **isolated Linux proof only; SECURITY HOLD**.

## Reproduction

`python3 experiments/ge04/test-sealed-memfd-exec.py`

The experiment compiles the existing GE-04 native helper, copies its bytes into a Linux `memfd_create(MFD_ALLOW_SEALING)` descriptor, independently hashes the descriptor bytes, and applies `F_SEAL_WRITE | F_SEAL_GROW | F_SEAL_SHRINK | F_SEAL_SEAL`. It asserts that subsequent `pwrite` and `ftruncate` fail, deletes the original executable pathname, then launches the native helper through `/proc/self/fd/<fd>` using `pass_fds`. The helper creates a file in a temporary owned directory. This validates sealed-byte execution on the test host, not the correctness of the production trust chain.

## Security boundaries and gaps

- The experiment does **not** bind the expected digest to an authenticated build artifact, a trusted coordinator identity, or a protected persistent installation. The test computes the digest from the same compiled file it loads; this proves mechanics, **not provenance**.
- It does not implement trusted privilege separation, verify kernel credentials of the helper process, or prove the child ran the expected memfd at a specific PID/start-time.
- It does not provide authenticated terminal evidence, fsync receipt persistence, a durable attempt ledger, policy/lease revocation fencing, or crash-safe reconciliation.
- Sealing must happen **before** the executable is exposed for execution. A production launcher must fail closed on seal failure, hash mismatch, fd handoff failure, and ambiguous exit/receipt.
- The existing TypeScript `launchGe04PinnedHelper` is deliberately unchanged: GitNexus upstream impact currently reports CRITICAL (978 impacted, 166 processes); integration needs a separately scoped review and adversarial tests rather than silently changing a high-impact function.

No production mutation path is enabled and no GE-04 security gate is cleared by this experiment.
