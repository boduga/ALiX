# D9 Phase F — REQ 2 automated independent-verifier contract

**Status: governance contract amendment; no gate clearance.**

REQ 2 permits an independent automated verifier to qualify technical evidence without a mandatory human reviewer. This replaces a blanket human-qualification dependency for REQ 2 **only**; it does not delegate owner clearance (REQ 3), release/Q13 authority, or approval of sensitive mutations.

## Qualification conditions

1. **Separate authority:** verifier identity, execution context, and evidence writer are recorded. The implementer cannot issue its own qualifying verdict; a different model name alone does not establish isolation. Verifier must not inherit the author's unreviewed assertions, mutable test results, or ability to rewrite its qualification target.
2. **Immutable target:** pin the full commit/tree, build inputs, dependency lockfile, environment, and test commands. Any material code change invalidates the prior verdict for the changed scope.
3. **Independent re-derivation:** check tracked artifacts and SHA-256 hashes from a fresh checkout; independently execute relevant positive and negative tests, including adversarial mutation or fault-injection checks that demonstrate the tests can fail.
4. **Security boundaries:** reproduce or close each GE-01…GE-05 finding, including canonical-path/symlink escapes, policy deny precedence, crash/replay uncertainty, and absence of denied effects. No unresolved security bypass may be marked qualified.
5. **Auditable verdict:** retain immutable prompt/instructions, execution log, test outputs, hashes, reviewed revision, reviewer identity/class, and clause-by-clause PASS/FAIL/INCONCLUSIVE with citations. Missing evidence means INCONCLUSIVE; any blocking defect means FAIL/HOLD.
6. **Non-self-approval:** qualification does not confer permission to merge, release, waive security findings, extend expired exceptions, or override human/owner approvals required elsewhere.

## Current disposition

The retained 2026-11-02 Codex review is **attempt 1: NO**. It is eligible as automated critical-review evidence but **not** a qualifying PASS. GE-04's reproduced symlink path-scope bypass remains blocking; other clauses were partial. Fresh-clone artifact verification (19 files, zero failures) improves REQ 1 evidence retention, not the REQ 2 verdict. REQ 2, Gate E, and Phase F remain **HOLD** until a separate verifier demonstrates every applicable condition on the fixed exact tree.

This amendment does not retroactively rewrite the reviewer's original statement about human independence; it changes the REQ 2 acceptance contract prospectively while retaining the original review verbatim.
