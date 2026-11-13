# GE-04 A.03 — Independent human security review handoff

**Gate: BLOCKED / CHANGES REQUIRED. SECURITY HOLD ACTIVE.** This is an author-side handoff, **not** a human review, approval, or release authorization. The GE-04 A.02 production-integration sequence must not begin until A.03 acceptance is documented under the governing process.

## Review baseline and scope

- Independent findings: `tmp/ge04-a03-independent-review/opencode-findings.md` (author-visible local review evidence, not human signoff).
- Original reviewed source revision: `d6e22669`. The current worktree contains **uncommitted remediation**, so a final immutable review revision and source hashes have **not** been established.
- Draft PR #1100 is not authorized for merge.
- Historical 63 omitted sensitive lines across 18 files are **not individually reconciled**. The 297 broad lexical candidates and the 109 current lexical candidates are **not** a reviewed semantic call graph.
- Review inventory: `ge04-b1a-sensitive-api-review-inventory.json`; review queue: `ge04-b1a-sensitive-api-triage.json`; historical queue: `ge04-b1a-broad-omission-triage.json`; author-side destructive and privilege assessment: `ge04-b1a-destructive-privilege-controlflow-review.md`.

## Required reviewer decisions (each must be evidenced)

1. Reconstruct and reconcile the **63 historical omissions individually**, including line, operation, source revision and disposition. Do not treat per-file totals as line-level evidence.
2. Establish a semantic, bidirectional per-translation-unit authority-operation inventory across **all 53 native/ge04 C/Python files**; include multiline invocations, macros, aliases, indirect/wrapper calls and non-call authority references (e.g., `SCM_RIGHTS`, `CLONE_INTO_CGROUP`). Exclude declarations and quoted text with a documented rationale.
3. For each relevant site, review authorization, identity, custody, race windows, failure propagation, rollback/cleanup, replay, and test evidence. Record human reviewer, date, exact source hash, evidence, finding severity, verdict and exception owner if any.
4. Re-evaluate HIGH-1/HIGH-2, MEDIUM-1, MEDIUM-2 and other outstanding findings from the independent review, including privileged-only and concurrency negatives that cannot be demonstrated under the hold.
5. Require a regression gate that detects additions/removals of reviewed authority call sites at the **final source revision**, not merely token matches. Validate exact source hashes and final test outcomes.
6. Issue an explicit human security decision: **ACCEPT**, **CHANGES REQUIRED**, or **RISK ACCEPTANCE WITH APPROVED EXCEPTIONS**, referencing the review evidence. Until then the default is **HOLD**.

## Current author-side test scope

`tests/agents/test_ge04_sensitive_api_inventory.py` checks candidate drift, source-pinned AST evidence and C invocation syntax. `tests/agents/test_ge04_destructive_privilege_guards.py` tests selected guard ordering by source shape. `tests/agents/test_ge04_worker_sweep_admission.py` exercises unprivileged admission predicates. None proves protected execution, root behavior, race freedom, or independent human acceptance.

## Execution sequence after A.03 acceptance (not started)

A.02 production supervisor integration and durable admission -> authenticated IPC, credential custody and distinct-UID isolation -> crash recovery, revocation, receipts and kernel containment -> independent end-to-end qualification. Each step requires its own evidence and applicable authorization. Do not infer that A.03 acceptance alone permits privileged execution.

## Additional author-side remediation

- MEDIUM-3: matrix textual test-reference counts now include Python and TypeScript tests; `scripts/check-ge04-source-test-references.py` checks all 53 rows. Textual references are not coverage.
- MEDIUM-4: nonexistent attempt-fence test citation corrected to the existing native-journal test; untracked log expressly non-authoritative.
- MEDIUM-5: `ge04-b1a-cross-tu-candidates.json` records **28 unique-name C cross-translation-unit candidate resolutions**, checked by `scripts/check-ge04-cross-tu-candidates.py`. **Not linker-verified; MEDIUM-5 remains open** pending compilation/link closure and Python cross-module edges.
- MEDIUM-5 Python counterpart: `ge04-b1a-python-cross-module-candidates.json` contains **39 AST-derived direct imported-call candidates** across native Python modules; all 39 have matching top-level target declarations. `scripts/check-ge04-python-import-calls.py` regenerates and compares the evidence. The graph remains **candidate-only**, with dynamic/indirect calls and runtime linkage unresolved; do not mark MEDIUM-5 accepted.

### MEDIUM-6 — Author-side remediation

The read-only phase, approval and kernel observers now call a shared `unprivileged_observer.require_unprivileged()` at their public entrypoints. It refuses root real/effective UID or GID, and non-Linux execution before opening files, launching subprocesses or querying the system bus. The phase controller guards construction and each `accept` (including identity changes after construction). The isolated worker returns refusal code 77 when the shared guard rejects it. `tests/agents/test_ge04_observer_root_refusal.py` tests all four identity dimensions and the public entrypoints with file-open/subprocess spies. **Author-side fixed, independent human review pending; not proof of all privileged paths.**
- MEDIUM-2 C-side candidate coverage: `ge04-b1a-c-compiler-call-inventory.json` captures GCC 13 original-tree name candidates from **30/30 successfully compiled C files** (1,165 unique per-file lexical matches in lowered output), drift-checked by `scripts/check-ge04-c-compiler-calls.py`. This is **not a C AST semantic call graph** and does not reconcile the original 63 reviewer omissions or establish human security verdicts.
- MEDIUM-2 site-context evidence: `ge04-b1a-sensitive-site-context.json` now provides per-site source context and checklists for all **109 current lexical candidates** (80 C lexical, 21 Python AST calls, 8 Python noncall/reference). `ge04-b1a-python-noncall-disposition.json` contains explicit author-side syntax adjudication for the eight Python noncalls, retaining the `SCM_RIGHTS` comparison as descriptor-transfer authority. These do **not** replace independent semantic review or resolve the original 63 omissions.
- MEDIUM-2 C source syntax: `ge04-b1a-c-sensitive-disposition.json` classifies all **80 current C lexical candidates** (42 direct call syntax, 2 syscall-number dispatches, 6 authority-relevant references, 30 noncall lexical references). All remain pending independent security verdicts; indirect calls and historical omissions remain open.
- Additional source hardening: launcher now checks effective GID after privilege drop; C syntax and unprivileged source-shape tests pass. No privileged drop was exercised.
- MEDIUM-2 semantic review worklist: `ge04-b1a-c-authority-review-queue.json` pins source context and category-specific authorization, identity, TOCTOU, error and replay questions for **50 C authority-relevant sites** (14 destructive, 17 process lifecycle, 8 custody/locking, 4 privilege, 4 descriptor transfer, 3 bus). This is an **unadjudicated review queue**; all 50 remain pending independent security verdicts.
