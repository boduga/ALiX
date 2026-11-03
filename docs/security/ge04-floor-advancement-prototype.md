# GE-04 — cooperative protected-floor update experiment

**SECURITY HOLD — not a production floor updater or authorization boundary.**

`experiments/ge04/floor-advance.py` uses descriptor-validated root-owned directory ancestry, a protected advisory flock, a checked existing floor, an exclusively created staging file, file fsync, rename over `floor.json`, and directory fsync. It rejects decreases and preserves equal values. `test-floor-advance-root.py` is a root-gated CI fixture for advancement, downgrade rejection, and distinct-UID denial. This is a cooperative single-filesystem prototype, not a power-loss proof.

**Critical gaps:** the candidate is caller-supplied rather than derived from a signed and independently authorized release; a privileged caller can advance the floor arbitrarily and deny older releases. The lock is advisory; its creation and crash leftovers need further hardening. There is no recovery protocol for interruption between release publication and floor update, no same-UID hostile concurrency guarantee, no protection from privileged replacement or rollback of the entire floor directory, and no TPM or equivalent external monotonic anchor. CI result for this revision is pending. No production execution or mutation authorization is enabled.
