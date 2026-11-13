# GE-04 A.03 MEDIUM-2 — Historical omission reconciliation (author-side)

**Disposition: PARTIAL; independent review required; GE-04 SECURITY HOLD ACTIVE.**

The independent review reported **63 omitted non-comment sensitive lines across 18 files** in the historical matrix. The review provides per-file counts and selected examples, **not the complete set of 63 line identities**. Therefore a 63-of-63 reconciliation cannot honestly be claimed from the available report. Current worker source line numbers have shifted; matching below uses source API names, not historical line numbers.

## Historical reported omissions versus current candidate-site coverage

| Source | Historical omitted lines | Current inventoried candidate lines | Verdict |
|---|---:|---:|---|
| `cgroup-worker-qualification.c` | 15 | 15 | Unreviewed; counts not directly comparable |
| `cgroup-runtime-view-qualification.c` | 13 | 19 | Unreviewed; counts not directly comparable |
| `isolated-worker-launcher.c` | 4 | 4 | Unreviewed; counts not directly comparable |
| `protected-cgroup-custody.c` | 4 | 1 | Unreviewed; counts not directly comparable |
| `worker-stream.c` | 4 | 3 | Unreviewed; counts not directly comparable |
| `systemd_job_signal_observer.py` | 3 | 5 | Unreviewed; counts not directly comparable |
| `unit_kernel_observer.py` | 3 | 9 | Unreviewed; counts not directly comparable |
| `bootstrap_publisher.py` | 2 | 2 | Unreviewed; counts not directly comparable |
| `bootstrap_receiver.py` | 2 | 3 | Unreviewed; counts not directly comparable |
| `pidfd-lifecycle-qualification.c` | 2 | 7 | Unreviewed; counts not directly comparable |
| `protected-attempt-fence.c` | 2 | 2 | Unreviewed; counts not directly comparable |
| `protected-dispatch-intent.c` | 2 | 3 | Unreviewed; counts not directly comparable |
| `protected-prebirth-journal.c` | 2 | 2 | Unreviewed; counts not directly comparable |
| `bootstrap_binding.py` | 1 | 1 | Unreviewed; counts not directly comparable |
| `bounded_job_signal_observer.py` | 1 | 1 | Unreviewed; counts not directly comparable |
| `bounded_phase_observer.py` | 1 | 2 | Unreviewed; counts not directly comparable |
| `broker-peer-probe.c` | 1 | 1 | Unreviewed; counts not directly comparable |
| `cgroup-leaf-ownership-qualification.c` | 1 | 1 | Unreviewed; counts not directly comparable |

**Historical total: 63.** Current lexical inventory: **109 candidate lines across 30 files**; it includes existing inventory entries as well as previously missed API families. These are not 63 independently confirmed recoveries.

## Explicit reviewer examples — relocated by API name

| File | API / operation | Current matching line(s) | Status |
|---|---|---|---|
| `systemd_job_signal_observer.py` | `add_signal_receiver` | 100 | Candidate captured; unreviewed |
| `systemd_job_signal_observer.py` | `Subscribe` | 24, 31, 106 | Candidate captured; unreviewed |
| `systemd_job_signal_observer.py` | `Unsubscribe` | 137 | Candidate captured; unreviewed |
| `bootstrap_receiver.py` | `SCM_RIGHTS` | 3, 73 | Candidate captured; unreviewed |
| `bootstrap_publisher.py` | `memfd_create` | 108, 123 | Candidate captured; unreviewed |
| `bootstrap_binding.py` | `pread` | 113 | Candidate captured; unreviewed |
| `isolated-worker-launcher.c` | `setgroups` | 116 | Candidate captured; unreviewed |
| `isolated-worker-launcher.c` | `setresgid` | 116 | Candidate captured; unreviewed |
| `isolated-worker-launcher.c` | `setresuid` | 117 | Candidate captured; unreviewed |
| `cgroup-worker-qualification.c` | `setgroups` | 307 | Candidate captured; unreviewed |
| `cgroup-worker-qualification.c` | `setresgid` | 308 | Candidate captured; unreviewed |
| `cgroup-worker-qualification.c` | `setresuid` | 308 | Candidate captured; unreviewed |
| `cgroup-worker-qualification.c` | `unlinkat` | 329, 351, 426, 436 | Candidate captured; unreviewed |
| `cgroup-runtime-view-qualification.c` | `unlinkat` | 531, 538, 585, 675 | Candidate captured; unreviewed |
| `cgroup-runtime-view-qualification.c` | `waitpid` | 354, 568, 683 | Candidate captured; unreviewed |
| `cgroup-runtime-view-qualification.c` | `SYS_clone3` | 445 | Candidate captured; unreviewed |
| `cgroup-runtime-view-qualification.c` | `CLONE_INTO_CGROUP` | 443 | Candidate captured; unreviewed |
| `cgroup-runtime-view-qualification.c` | `flock` | 601 | Candidate captured; unreviewed |
| `broker-peer-probe.c` | `accept4` | 31 | Candidate captured; unreviewed |
| `worker-stream.c` | `accept4` | 170 | Candidate captured; unreviewed |
| `worker-stream.c` | `SCM_RIGHTS` | 189 | Candidate captured; unreviewed |
| `unit_kernel_observer.py` | `_mount` | 57, 121, 165 | Candidate captured; unreviewed |
| `cgroup-leaf-ownership-qualification.c` | `mkdirat` | 58 | Candidate captured; unreviewed |

## Unresolved reconciliation and acceptance work

1. Recover or reconstruct the **complete historical 63-line omission list** from the original reviewer scan; the report alone supplies only counts and selected examples. Compare against current source by operation semantics, not historical line numbers.
2. Establish a **reviewed per-translation-unit authority/API allowlist**. The present vocabulary is explicit but global and lexical; it does not detect unknown APIs, indirect dispatch, aliasing, macro expansion, or all multiline calls.
3. Classify each candidate operation for authority, authorization, custody, TOCTOU, error propagation, cleanup, replay, and negative paths. Every JSON entry remains `UNREVIEWED`.
4. Obtain independent human signoff before treating MEDIUM-2 as closed. Passing inventory drift tests is not an acceptance verdict.

## Independent broad scan against the exact historical revision

A second, intentionally broader lexical scan compares **historical native source at commit `d6e22669`** against the historical matrix's recorded line numbers. The reproducible candidate report is `ge04-b1a-broad-omission-candidates.json`. It finds **297 additional token-matching source lines across 42 files**, of which **220 are in the 18 files** cited by the reviewer. The extra lines include benign reads, declarations, and other lexical false positives; these **do not equal the original reviewer's 63 confirmed omissions**. They are a conservative author-side review queue, not a reconstruction of the reviewer's unpublished scanner or a claim of 297 security defects. `test_ge04_sensitive_api_inventory.py` independently replays the historical comparison against the pinned commit and matrix.

**Important:** The historical matrix records 36 detailed sections for 53 source files. Unlisted sections are treated as having zero recorded sensitive-site lines, not as having no authority. Historical worker citations are evaluated against the pinned historical source, not against the changed current worker source. Full semantic adjudication and exact identity-level reconciliation of the reviewer's 63-line result still require the original scanner/list or an independently approved replacement audit.

## Broad-candidate syntax triage (not security adjudication)

`ge04-b1a-broad-omission-triage.json` retains all **297 historical broad-scan candidate lines** with source evidence and four author-side syntax buckets: **70 direct-call candidates**, **65 authority-reference candidates**, **62 likely nonexecuting lexical matches**, and **100 general/ambiguous matches**. All 297 remain `PENDING_HUMAN_SECURITY_REVIEW`. These categories are not mutually exclusive with real authority effects: for example, a line tagged `DIRECT_CALL_CANDIDATE` may still be a harmless method or false positive, and a declaration or macro may hide a real operation. A one-line syntax heuristic cannot replace semantic call-graph review.

The triage regression test checks preservation of all historical candidates, pending review state, and selected high-risk call sites. It **does not** prove that the 63 reviewer-identified omissions are all individually identified, or that the scan is exhaustive. No A.03 acceptance or GE-04 hold release follows from this triage.

## Python AST call-expression validation (historical source)

The Python portion of the 297-candidate queue is now checked against Python `ast.Call` nodes at the pinned `d6e22669` revision, recording the actual callee expression (`os.pread`, `os.memfd_create`, `bus.add_signal_receiver`, `manager.Subscribe`, `manager.Unsubscribe`, `_mount`, etc.). The AST identifies **14 token-matching Python call expressions**, including **7 ambiguous-authority calls** such as `window.accept` and `os.stat`. A method named `accept` is not assumed to be a socket accept. AST evidence improves call-versus-text discrimination, but is **not** authorization review, and indirect/dynamic calls can still escape it. The C entries remain lexical/syntax triage pending semantic review. All 297 retain pending human security verdicts.

## Historical C invocation-syntax validation

The **64 C direct-call candidates** now include a source-pinned, independently rechecked `c_invocation_syntax` map for each named API and the adjacent source lines. The seventh regression test verifies that every candidate has invocation syntax at the exact `d6e22669` source line and that its context matches. **This is not a C parser, control-flow proof, or semantic security review.** All 64 have `c_authority_effect: NOT_ADJUDICATED`. It is unsafe to infer successful authorization or cleanup from syntax alone, particularly in multiline Boolean chains, preprocessor branches, and wrapper calls.
