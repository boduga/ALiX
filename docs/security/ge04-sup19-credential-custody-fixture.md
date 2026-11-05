# GE-04 SUP-19 — Distinct-UID credential custody fixture

**SECURITY HOLD. This is a privileged Linux test of file permissions and clean process creation, not a production trust root or authorization implementation.**

`experiments/ge04/test-credential-custody-root.py` creates a root-owned 0700 directory and a create-once 0600 32-byte fixture credential using the SUP-15 provisioning API. It launches separate, freshly exec'd Python processes with `close_fds=True` and an empty `pass_fds` allowlist. A root-owned test process can reopen the same fixture key after process exit, and a UID/GID 65534 process cannot read it. Both children inspect `/proc/self/fd` to ensure the fixture credential file descriptor was not inherited. A later fresh root process fails to open the credential after the fixture file is removed. The root process reports a SHA-256 digest only for comparison, not key bytes.

The CI privileged GE-04 lane runs this test after SUP-18. This test does **not** demonstrate safe credential revocation from an already-running holder, isolation from other root processes, independent process role identity, a secure service manager, authenticated message provenance, denial of deliberate `SCM_RIGHTS` delegation, or atomic final-boundary authorization. In particular, SUP-16 still demonstrates that an intentionally transferred preauthenticated connection can carry an inert request from an untrusted UID while `SO_PEERCRED` reflects the original connector. Removal of a file does not erase a previously copied key or revoke a previously authenticated session.

Production `UnavailableScopedMutationService` stays disabled; PR #1039 remains open and unmerged. Any lifting of the hold requires a separate authority design, enforcement proof, and independent security review.
