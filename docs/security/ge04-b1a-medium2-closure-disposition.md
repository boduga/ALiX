# GE-04 B1-A.03 MEDIUM-2 — Closure disposition

**Decision: NOT CLOSED. Author-side remediation prepared; independent human security acceptance required. GE-04 SECURITY HOLD ACTIVE.**

## Evidence delivered

- `ge04-b1a-sensitive-api-review-inventory.json`: 109 lexical candidate lines in 30 files, explicit per-file API vocabularies; every site marked `UNREVIEWED`.
- `ge04-b1a-sensitive-api-triage.json`: 109 candidate review records across six authority categories, each marked `PENDING_INDEPENDENT_HUMAN_REVIEW`.
- `ge04-b1a-sensitive-api-reconciliation.md`: all 18 historical file-level omission counts and 23 reviewer-specified API examples traced to current source, without asserting 63/63 line identity reconciliation.
- `tests/agents/test_ge04_sensitive_api_inventory.py`: fail-on-drift checks for the candidate vocabulary, file/line/text sites, and review queue.

## Blocking closure criteria

- [ ] Recover/reconstruct and reconcile all **63 individually omitted lines** in the original review; per-file counts and 23 API examples are not equivalent.
- [ ] Perform semantic call-site inventory for **all 53 native/ge04 C/Python files**, including indirect calls, aliases, macros, multiline operations, and API families omitted by the lexical vocabulary. Resolve declaration/string/comment false positives.
- [ ] Independently adjudicate **every authority-relevant operation** for authorization, identity/custody, TOCTOU, error propagation, cleanup, and replay/negative paths. Record reviewer identity, evidence, verdict, and disposition; no `UNREVIEWED` or `PENDING_INDEPENDENT_HUMAN_REVIEW` authority sites may be silently treated as accepted.
- [ ] Confirm the reviewed allowlist and its regression gate match the final source revision; record the pinned source hashes.
- [ ] Obtain independent **human** security acceptance of MEDIUM-2, or explicit human risk acceptance of remaining exceptions under the governing A.03 process.

## Invariants

This disposition cannot be promoted to `CLOSED` by the author-side lexical tests, source-shape tests, or an AI review. It does not authorize root/privileged execution, worker admission, systemd dispatch, protected ACK, release of the GE-04 hold, or merging PR #1100. Keep MEDIUM-2 open in the A.03 review queue until the above evidence is supplied and accepted.

### Historical-revision cross-check (additional author evidence)

`ge04-b1a-broad-omission-candidates.json` records **297 broad lexical candidate lines absent from the original matrix at the exact `d6e22669` revision**, across 42 files (220 candidates in the reviewer's 18 cited files). The regression test reproduces the baseline comparison. This intentionally overinclusive candidate set **does not prove the 63 reviewer omissions are individually recovered or reviewed**; it expands the review queue and preserves source-level evidence without silently declaring closure.

### Python AST call-site evidence

The 297-site broad triage now records AST-confirmed Python callee expressions and distinguishes ambiguous method names from verified syscall names. Six regression tests cover the inventory, historical reconstruction, triage preservation, and Python AST reproducibility. **No C semantic adjudication or independent human acceptance is implied.**

### Cross-module review aids (author evidence only)

`ge04-b1a-cross-tu-candidates.json` and `ge04-b1a-python-cross-module-candidates.json` record 28 C unique-name and 39 Python direct-import call candidates, respectively. Their drift checks do not prove semantic completeness, link closure, or authority; they do not close MEDIUM-2 or MEDIUM-5.

### Current Python AST call-expression coverage

`ge04-b1a-python-ast-call-inventory.json` and `scripts/check-ge04-python-authority-ast.py` capture **every syntactic Python `ast.Call` expression** in the current `native/ge04` Python files, including multiline calls. This broadens the review queue beyond the 33-name lexical vocabulary but **does not classify authority or resolve runtime dispatch**. C call expressions, aliasing, macros and all 63 historical reviewer omissions remain open.

### Current C compiler-lowered candidate inventory

`scripts/check-ge04-c-compiler-calls.py` compiles **all 30 C translation units** without executing them and records GCC 13 `-fdump-tree-original` lowered name candidates in `ge04-b1a-c-compiler-call-inventory.json`. At this source state, **30/30 compile, 0 failures, 1,165 unique per-file name candidates**. This is a broad compiler-derived queue, **not 1,165 confirmed calls or security defects**: it includes declaration/control-syntax matches, loses source-site and macro provenance, and cannot prove indirect calls or authorization semantics. The original 63 omitted reviewer lines remain incompletely identified and all sensitive-site verdicts remain pending human review.

### Current sensitive-site source context and Python noncall disposition

`scripts/check-ge04-sensitive-site-context.py` creates a bidirectional, drift-checked contextual record for **all 109 current lexical sensitive-site candidates**: 80 C source-lexical candidates, 21 Python `ast.Call` sites, and 8 Python reference/noncall sites. Each record pins exact source, nearby lines, a scope candidate, review categories and required checks. C scopes are approximations and must not be treated as a C semantic parse. `scripts/check-ge04-python-noncall-disposition.py` explicitly classifies the 8 Python noncall sites: 5 docstring mentions, 1 declaration, 1 protocol-string comparison and 1 descriptor-transfer constant comparison (see JSON for individual records). **The `socket.SCM_RIGHTS` comparison remains authority-relevant** even though it is not a call. The classification is author-side syntax triage only; no independent security verdict has been assigned. The C sites, 21 Python call sites and the historical 63 omissions still require semantic review.

### C sensitive-site token-specific syntax disposition

`scripts/check-ge04-c-sensitive-disposition.py` records an explicit, drift-checked author syntax disposition for **all 80 current C lexical candidates** in `ge04-b1a-c-sensitive-disposition.json`: **42 direct C call-syntax sites**, **2 syscall-number dispatch sites**, **6 authority-relevant noncall/flag/method sites**, and **30 noncall lexical references** (such as the local `kill` fd variable, diagnostic strings, and `cgroup.kill` filenames). The six authority-relevant references are retained for review, not discarded as harmless. The classification is **not a C AST, full function call graph, authorization proof, or independent security verdict**. All 80 remain pending human security review; the 63 historical omissions remain incompletely reconciled.

`isolated-worker-launcher.c` now explicitly checks effective GID after `setresgid`/`setresuid`, in addition to real GID and real/effective UID. This closes a source-level post-drop identity-check gap, but actual privileged execution and saved-ID behavior remain untested.

### Authority-relevant C source review queue (50 current sites)

`scripts/check-ge04-c-authority-review-queue.py` produces `ge04-b1a-c-authority-review-queue.json` with exact source lines, surrounding context, and category-specific control-flow/negative-path questions for **all 50 current C authority-relevant lexical sites** (42 direct calls, 2 syscall dispatches, 6 flags/method/descriptor references). The categories partition into 14 destructive mutation, 17 process lifecycle, 8 custody/locking, 4 privilege transition, 4 descriptor transfer, and 3 bus authority. These are **review tasks, not 50 individually completed semantic reviews**. Existing `ge04-b1a-destructive-privilege-controlflow-review.md` contains partial source-level analysis of 12 destructive/privilege operation groups. In particular, name-based `unlinkat` after a prior identity check has a TOCTOU window unless directory custody and write exclusion are independently proven; this remains a blocker. No author-generated queue can replace independent security acceptance or resolve the historical 63 omitted lines.
