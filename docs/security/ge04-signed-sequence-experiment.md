# GE-04 — signed sequence and protected floor prototype

**SECURITY HOLD — standalone test-only verifier, not wired to production or the descriptor-bound release verifier.**

`experiments/ge04/signed-sequence.py` verifies an Ed25519 signature over a version-2 manifest containing a numeric `sequence`, checks the signed release identity and helper digest, and compares that authenticated sequence to the independently protected floor through `release-floor.py`. The root-gated test accepts a signed sequence at the floor, rejects lower sequences and malformed values, and rejects a modified high sequence under the original signature. CI is pending for this revision.

The signing key and release name are still caller-supplied to this prototype; **a malicious caller could supply their own key and signed release**. The protected floor is not advanced atomically or monotonically, and this prototype does not bind a key pin, manifest, helper, and floor into one fixed-authority supervisor transaction. Existing version-1 release verification is unchanged. Next: integrate with descriptor-pinned independent key trust, validate crash-safe floor updates and release publication, and prevent replay. No helper execution or authorization is performed.
