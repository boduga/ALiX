# GE-04 B1-A.03 — Sensitive API candidate-site inventory (author-side)

**Disposition: UNREVIEWED CANDIDATES / SECURITY HOLD ACTIVE.** This supplements, but does not supersede, the historical source-authority matrix or constitute human security acceptance.

`ge04-b1a-sensitive-api-review-inventory.json` records **109 lexical candidate lines in 30 of 53 directly enumerated C/Python files** under `native/ge04`, keyed by file, line, source text, and matched API names. Every entry is marked `UNREVIEWED`; no authorization, custody, negative-path, or TOCTOU verdict is asserted. The explicit API vocabulary includes `Subscribe`, `Unsubscribe`, `add_signal_receiver`, `SCM_RIGHTS`, `memfd_create`, `pread`, `setgroups`, `setresgid`, `setresuid`, `unlinkat`, `clone3`, `CLONE_INTO_CGROUP`, `flock`, `accept4`, `mkdirat`, `waitpid`, `SYS_clone3`, `_mount`, and other privileged/process APIs. This inventory deliberately captures previously omitted authority surfaces; it is **not** a verified reconstruction of the review's historical 63 omissions.

`tests/agents/test_ge04_sensitive_api_inventory.py` recomputes candidate sites and enforces bidirectional exact equality, so newly introduced matching lines fail the test until inventoried. The gate is a lexical drift check, **not a reviewed API allowlist**: comments, aliases, indirect calls, macros, dynamic dispatch, other sensitive APIs, and multi-line expressions can escape it. The review must still establish a complete API/authority inventory, classify every call site, reconcile the historical 63 omissions, and obtain independent human verdicts. Do not promote the `UNREVIEWED` field to acceptance on the basis of this test.

No root execution, systemd dispatch, worker admission, protected ACK, or release of the GE-04 hold is authorized.

The historical 63-line omission report is reconciled at the per-file and explicit-example level in `ge04-b1a-sensitive-api-reconciliation.md`; full 63-site identity reconciliation remains open.

## Per-file author-side review queue

The JSON inventory now contains `per_file_api_allowlist` for each of the 30 files with recognized candidates. `ge04-b1a-sensitive-api-triage.json` supplies a review queue for all 109 recorded candidate lines, mapping recognized APIs to six **review categories** (bus authority, descriptor transfer, privilege transition, destructive mutation, process lifecycle, custody/locking) and category-specific questions. A site may belong to multiple categories. **These are triage classifications, not verified security properties.** All 109 sites explicitly retain `PENDING_INDEPENDENT_HUMAN_REVIEW`.

The drift tests require the per-file vocabulary and candidate sites to match current source, and require the review queue to cover all inventoried sites and their categories. This does not make the API vocabulary exhaustive or automatically adjudicate security. The current inventory can include mentions in strings, declarations, and checks rather than executed calls; a human must distinguish these and review actual execution edges. Sites with no recognized API are invisible to this gate. The full 63 historical omissions and any indirect/macro authority paths remain unresolved.
