# GE-04 — cooperative verification/update lock experiment

**SECURITY HOLD — not production-safe.**

The experimental `authorized-floor-advance.py` now supplies a candidate-provider callback to `floor-advance.py`. The latter acquires its protected advisory flock before invoking the callback, which verifies the descriptor-read signed manifest, independent key pin, helper digest, release identity and existing floor, and derives the authenticated sequence. The updater re-reads the protected floor and commits its staged, fsynced replacement before releasing the same lock. The new root-only fixture holds the update lock in one process and checks that another process cannot derive its candidate until the lock is released. Existing root-gated signed-floor and concurrent updater tests remain in CI.

This removes the **cooperative** verification-to-update gap between these two experimental functions; it does **not** make the operation safe against privileged actors that ignore flock, a caller selecting different trust paths or UIDs, replacement of trusted release files by root, or crash/power-loss failures. The raw caller-supplied candidate updater remains available to privileged code. There is no protected fixed-authority supervisor, external rollback anchor, or durable release-publication transaction. No production execution is enabled.
