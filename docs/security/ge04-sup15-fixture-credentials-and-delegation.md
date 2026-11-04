# GE-04 SUP-15 — Fixture credentials and real FD delegation evidence

**SECURITY HOLD. Not trusted provisioning, credential custody, authorization or production execution.**

`experiments/ge04/fixture-credential-provisioning.py` creates an exclusive 32-byte random test key in a caller-selected owner-only directory; the fixture reader opens the directory and key with `O_NOFOLLOW`, checks owner, permissions, regular-file type, single link and exact length, and refuses existing key replacement. The directory and expected owner are supplied by the test caller: there is NO independently pinned root-owned ALiX coordinator trust root. This is a fixture, not a secure production credential store.

`experiments/ge04/test-fixture-credential-delegation.py` verifies unsafe permissions, key symlink and double installation rejection. More importantly, a real Unix `SCM_RIGHTS` transfer supplies an already-connected socket to a forked process, which writes a precomputed authenticated inert request. SUP-12 accepts the request while the kernel's `SO_PEERCRED` remains unchanged. This **reproduces a delegation risk**; the test does NOT prevent it. Fork also inherits memory, so it does NOT prove a recipient without key access could perform the same action in an isolated role.

**Unresolved gate:** Prevent unapproved FD transfer/inheritance by OS process isolation, independent coordinator-role credential provisioning, protected key custody, per-message identity/authority assurance where needed, and a reviewable policy for transferred descriptors. The test-only secret remains readable into ordinary user process memory. Neither successful IPC nor a MAC is mutation authorization. There is no final mutation-boundary policy/approval/lease serialization, durable replay ledger, crash recovery guarantee or authenticated receipt. The production `UnavailableScopedMutationService` is unchanged and PR #1039 must stay unmerged.

**Next:** Develop a genuinely credential-separated supervisor harness with a supervisor-managed lifecycle, explicit role restrictions and adversarial FD delegation tests. Avoid claiming a file-based test credential establishes independent authority.
