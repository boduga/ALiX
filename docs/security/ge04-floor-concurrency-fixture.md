# GE-04 — cooperative floor concurrency fixture

**SECURITY HOLD — no production authorization.**

The root-only `test-floor-concurrency-root.py` starts six concurrent processes attempting different sequence advances against the same protected floor. Each uses the existing advisory-lock updater. Lower candidates may be rejected after a higher candidate commits; the final floor must equal the maximum candidate. A deliberately abandoned staging file containing a higher number must not affect the committed floor. CI qualification is pending.

This tests cooperative serialization and orphan staging tolerance only. It does not simulate power loss, ensure a malicious privileged writer obeys the lock, authenticate candidates, or close the verification-to-update race in `authorized-floor-advance.py`. A true transaction must verify the pinned release while holding the same protected update lock and commit under that lock, with an independent release authorization policy. No production enablement.
