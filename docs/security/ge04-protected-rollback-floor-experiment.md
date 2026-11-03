# GE-04 — protected rollback floor read experiment

**SECURITY HOLD. This is NOT a complete rollback prevention mechanism.**

`experiments/ge04/release-floor.py` reads `floor.json` from a descriptor-validated, root-owned directory ancestry and requires a non-writable, single-link, root-owned file with a bounded strict JSON record `{version: 1, minimumSequence: integer}`. It rejects a caller-provided candidate sequence below that floor. The root-only CI fixture verifies floor acceptance/rejection, writable-file denial, and real distinct-UID inability to overwrite the protected record. CI qualification of this change is pending.

**Critical unclosed trust boundary:** The candidate sequence is still supplied by the caller, not extracted from a signed manifest. Current signed-release manifests have no signed monotonic sequence, and there is no atomic, durable, administrator-authorized advancement of the floor. A malicious caller can claim a high sequence. Thus this is only a protected-floor *reader* and adversarial filesystem test, not integrated rollback security. Next steps: add a signed release sequence and compare it under the same descriptor-bound verification, define atomic monotonic floor updates and crash recovery, and test downgrade and same-UID adversaries. Production remains disabled.
