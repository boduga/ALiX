# GE-04 — signed-release-derived floor advancement experiment

**SECURITY HOLD — not a production-authorized floor update.**

`authorized-floor-advance.py` derives the candidate sequence from the same descriptor-read manifest bytes already authenticated by the independently pinned signing key, signed-release identity, helper digest and protected floor in `trusted-release-verification.py`. It then passes that sequence to the cooperative fsynced `floor-advance.py` updater. The privileged `test-pinned-sequence-root.py` now verifies a signed advancement from 10 to 11 and rejection of a previously signed release at 10. Existing version-1 no-floor behavior remains experimental and is not a production gate.

**Unresolved:** caller-selected config, release, floor and owner UID are not trusted supervisor authority. The verifier and updater are separate transactions: a concurrent privileged update can change the floor between validation and commit. The updater's raw `advance()` entrypoint remains callable with arbitrary sequences by privileged code, and there is no authorization policy for selecting the approved release, mount provenance validation, protected rollback anchor, crash recovery or proof of power-loss durability. This experiment does not authorize helper execution or mutation. CI qualification for this revision is pending.
