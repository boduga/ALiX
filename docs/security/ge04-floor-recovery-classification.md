# GE-04 — experimental read-only release/floor recovery classification

**SECURITY HOLD. Not a supervisor, authorization decision, or production recovery implementation.**

`experiments/ge04/release-floor-recovery.py` compares a pinned, signed, descriptor-read release sequence against a protected rollback floor. It reports `VERIFIED_CURRENT` only when the signed release verifies and its sequence equals the protected floor. Missing or invalid inputs, signatures, rollback, or a sequence mismatch are classified `UNCERTAIN` and **never repaired, retried or executed**. The privileged pinned-sequence fixture covers a future signed release before floor advancement, matching committed release/floor, and an older signed release after advancement.

This classifier is deliberately conservative: a valid signed release with a sequence greater than the floor is `UNCERTAIN` until a separately authorized publication transaction resolves it. It cannot prove that an operation executed or that a receipt is durable. Separate reads are not an atomic snapshot against privileged concurrent updates. Caller-selected paths/UID, same-UID adversaries, power-loss durability, authenticated supervisor-owned attempt ledger, lease fences, and terminal receipts remain unresolved. Production mutation remains disabled.
