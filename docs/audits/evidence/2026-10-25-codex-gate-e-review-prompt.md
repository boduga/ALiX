You are performing an INDEPENDENT SECURITY QUALIFICATION REVIEW for Gate E.

You did not author this code. Do not trust comments, docstrings, test names, or the
audit record that points you at them. Verify against the actual logic. A test whose
name says "denies write outside scope" proves nothing unless its assertions would
fail if the control were removed — check what each test actually asserts.

Repository: /home/babasola/Projects/ALiX

This is a claim under review, from docs/audits/2026-10-24-gate-e-qualification-record.json:

  Five clauses are "qualified, author-side":
    F8b          child-process approval surface cannot self-approve
    authority    a hard policy deny survives every session mode
    crash/recovery  an approval claimed then crashed stays consumed
    ownership    a worker cannot write outside its declared owned paths
    denied-action negatives  denied actions are denied and leave no side effect

  Evidence for each is a set of test files. Verify those tests exist, actually run,
  and actually assert the claimed negative. A missing or vacuous assertion is a
  finding, not a formality.

FILES UNDER REVIEW

Gate E record and claims:
- docs/audits/2026-10-24-gate-e-qualification-record.json
- docs/audits/2026-10-24-gate-e-qualification.md
- benchmark/evidence/gate-e-qualification-record.mjs

Test evidence for each clause:
- tests/security/worker-approval-port.vitest.ts                    (F8b)
- tests/security/pre-r032-non-bypass.vitest.ts                     (authority, denied-action)
- tests/policy/policy-gate.test.ts                                 (authority)
- tests/policy/rule-evaluator.test.ts                              (authority)
- tests/security/approval-crash-recovery.test.ts                   (crash/recovery)
- tests/security/legacy-approval-single-use.test.ts                (crash/recovery)
- tests/security/approval-consumed-propagation.test.ts             (crash/recovery)
- tests/ownership/path-scope.test.ts                               (ownership)
- tests/ownership/ownership-gate.test.ts                           (ownership, denied-action)
- tests/ownership/ownership-registry.test.ts                       (ownership)
- tests/security/policy-protected-path-parity.vitest.ts            (ownership, denied-action)
- tests/policy/command-classifier.test.ts                          (denied-action)

Implementation under review:
- src/governance/approvals/approval-store.ts
- src/governance/approvals/worker-approval-port.ts
- src/governance/policy/policy-gate.ts
- src/governance/policy/rule-evaluator.ts
- src/coordination/ownership/path-scope.ts
- src/coordination/ownership/ownership-registry.ts
- src/capabilities/tools/file-tools.ts

YOUR QUESTIONS. Answer each with file:line evidence.

1. F8b — SELF-APPROVAL. Can a child worker approve, resolve, revoke, invalidate or
   mutate its own approval in any path? Does the port truly throw at construction if
   a decision method is present, and is that construction path the only way a child
   gets an approval interface? Could a child reach ApprovalStore by another route —
   an import, a shared singleton, a passed reference, an env var, a CLI subcommand?

2. AUTHORITY — DENY IS ABSOLUTE. Does a hard policy deny survive auto, bypass, ask
   and any session mode? Look for any path where a deny is converted to allow, where
   an allow-listed capability short-circuits before a deny rule, where deny-wins is
   asserted but not implemented, or where an unreadable/unparseable policy fails
   open. Is the "deny-wins" claim actually tested, or only described?

3. CRASH/RECOVERY — NO DOUBLE EXECUTION. If a process claims a single-use approval
   and dies before executing, what happens on replay? Is the claim persisted BEFORE
   execution? Can a replay observe a pending claim and execute anyway? Is a pending
   claim on replay denied, or silently treated as unconsumed? Is there any window in
   which two processes can both claim the same approval?

4. OWNERSHIP — NO WRITE OUTSIDE SCOPE. Does the owned-path rule decide EVERY
   declared-scope write, or can a broader capability permission widen it? The
   historical regression to look for specifically: the gate returning the tool
   capability's allow BEFORE evaluating the owned-path rule (fixed in bf29449b) —
   verify the fix is actually effective and pinned, not just mentioned. Does
   file.create apply the same backstop to NEW files as to overwrites?

5. DENIED-ACTION NEGATIVES. When an action is denied, is it observably denied with
   no side effect, or does denial leave partial state? Is the denial a decision or
   an error that a caller might swallow and retry?

6. THE RECORD ITSELF. Does benchmark/evidence/gate-e-qualification-record.mjs
   actually reject a bad record, or can a record pass with a vacuous clause, a
   missing negative case, a nonexistent evidence path, or a claim of independence it
   cannot support? Is the "exit 3 for author-only" distinction real? Would these
   validators catch a record that names tests which do not assert what they claim?

7. GAP HONESTY. The record declares five gaps: F-02 (no wrong-workspace test for the
   worker port), F-03 (operator denial not exercised through full TUI), F-04
   (ownership hard-conflict rejection not demonstrated), F-07 (transient clamp-reload
   unreproduced), F-11 (delegate transport flake bounded not fixed). Are these the
   REAL remaining gaps, or are there additional unqualified areas the record does not
   name? Name anything material it omits.

Constraints: READ-ONLY. Do NOT write, stage, commit or modify any repository file.
Do NOT run the full test suite. Do NOT call any provider or network service. You may
read files and run read-only shell inspection.

Output (plain text):

- `CLAUSE VERDICTS` — for each of the five clauses: QUALIFIED / PARTIAL / NOT
  QUALIFIED, with the specific test or assertion that justifies it, or the specific
  reason it does not.

- `DEFECTS` — each with file:line, severity (critical/major/minor), what it allows,
  and the minimal fix.

- `VACUOUS ASSERTIONS` — any test that names a control but would still pass with the
  control removed. This is the most important section. Be adversarial.

- `UNDECLARED GAPS` — material gaps the record does not name.

- `CAN THESE TESTS PASS WITHOUT THE CONTROL?` — yes/no per clause, with the concrete
  counterexample.

- `VERDICT` — is this author-side qualification sound enough for an independent party
  to accept as coverage? Answer strictly. If a test cannot fail when its control is
  removed, say NO and name it. State clearly what an independent qualifier still has
  to do that this review does not do.
