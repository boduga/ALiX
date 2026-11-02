You are performing an INDEPENDENT REVIEW for D9 Phase F, requirement 2.

Do not trust this prompt. Do not trust comments, docstrings, test names, prior
review records, or remediation claims in the repo. Verify against the actual code
and the actual assertions. A test whose name says "denies write outside scope"
proves nothing unless its assertions would FAIL if the control were removed.

Repository: /home/babasola/Projects/ALiX

## Why you are being asked

D9 Phase F requirement 2 reads, verbatim:

  "Independently review code and evidence with separate verifier/critic
   authority; no author self-certification."

The author-side work is done and evidence exists, but self-certification is
explicitly disallowed, so an outside reviewer is required. You are that reviewer.

This is a RE-REVIEW. A previous independent review (Codex, 2026-10-25) examined
five clauses and returned NO: 2 unqualified, 3 partial. Since then the author
claims remediation. Your job is to determine whether the remediation actually
closed those findings, or only appeared to.

## The previous findings — verify each is genuinely fixed

Read `docs/audits/2026-10-24-gate-e-qualification-record.json` (field
`independentReview` and each component's `note`) and
`docs/audits/evidence/2026-10-25-codex-gate-e-review.txt`.

The previous review downgraded or refused:

- **GE-01 [partial]** F8b — child-process approval surface cannot self-approve.
  Finding: the constructor guard was verified by a VACUOUS test, and the facade
  narrows an object without confining a process — a child can reopen
  `ApprovalStore` via import or the approval CLI. Treated as narrowing, not an
  authority boundary.
- **GE-02 [unqualified]** authority — a hard policy deny survives every session
  mode. Defects D1 (ask-mode safe-shell bypass bypassed a deny) and D11
  (deny > ask > allow precedence).
- **GE-03 [partial]** crash/recovery — an approval claimed then crashed stays
  consumed. Defects D3, D4: ordinary replay asserted, but coordination replay
  creates a REPLACEMENT approval instead of denying uncertain consumption.
- **GE-04 [unqualified]** ownership — a worker cannot write outside its declared
  owned paths. Defect D2: a declared owned scope must deny unscopable mutation
  channels.
- **GE-05 [partial]** denied-action negatives.

## Files to review

Claims and the record's own honesty:
- `docs/audits/2026-10-24-gate-e-qualification-record.json`
- `docs/audits/2026-10-24-gate-e-qualification.md`
- `benchmark/evidence/gate-e-qualification-record.mjs`

Implementation (read the logic, not the comments):
- `src/governance/approvals/approval-store.ts`
- `src/governance/approvals/worker-approval-port.ts`
- `src/governance/policy/policy-gate.ts`
- `src/governance/policy/rule-evaluator.ts`
- `src/coordination/ownership/path-scope.ts`
- `src/coordination/ownership/ownership-registry.ts`
- `src/coordination/ownership/owned-scope-channels.ts`
- `src/capabilities/tools/file-tools.ts`
- `src/capabilities/tools/executor.ts`
- `src/execution/run/helpers.ts` (`buildReadOnlyToolFilter`)

Test evidence, by clause:
- F8b: `tests/security/worker-approval-port.vitest.ts`
- authority: `tests/security/pre-r032-non-bypass.vitest.ts`,
  `tests/policy/policy-gate.test.ts`, `tests/policy/rule-evaluator.test.ts`
- crash/recovery: `tests/security/approval-crash-recovery.test.ts`,
  `tests/security/legacy-approval-single-use.test.ts`,
  `tests/security/approval-consumed-propagation.test.ts`
- ownership: `tests/ownership/path-scope.test.ts`,
  `tests/ownership/ownership-gate.test.ts`,
  `tests/ownership/ownership-registry.test.ts`,
  `tests/security/policy-protected-path-parity.vitest.ts`
- denied-action: `tests/security/pre-r032-non-bypass.vitest.ts`,
  `tests/security/policy-protected-path-parity.vitest.ts`,
  `tests/ownership/ownership-gate.test.ts`, `tests/executor.test.ts`

Author-side execution evidence produced 2026-11-02 (this is what REQ 1 asked
for; treat it as CLAIMED, not verified):
- `docs/prd/evidence/lean-01/D9-phase-f-req1-x86-64-qualification-2026-11-02.md`
- `docs/prd/evidence/lean-01/evidence/d9-x86-64-2026-11-02/`

## Questions — answer each with file:line evidence

1. **F8b — SELF-APPROVAL.** Can a child worker approve, resolve, revoke,
   invalidate or mutate its own approval in ANY path? Does the port actually throw
   at construction when a decision method is present, and is that test
   non-vacuous — would it fail if the guard were deleted? Can a child reach
   `ApprovalStore` another way: import, singleton, passed reference, env var, CLI
   subcommand?

2. **AUTHORITY — DENY IS ABSOLUTE.** Does a hard deny survive auto, bypass, ask
   and every session mode? Look for a deny converted to allow, an allow-listed
   capability short-circuiting before the deny rule, deny-wins asserted but not
   implemented, or unparseable policy failing open. Is deny-wins actually tested,
   or only described?

3. **CRASH/RECOVERY — NO DOUBLE EXECUTION.** If a process claims a single-use
   approval and dies before executing, what happens on replay? Is the claim
   persisted BEFORE execution? Can a replay observe a pending claim and execute
   anyway? Is the coordination-replay replacement-approval path (previous D3/D4)
   fixed — does it now deny rather than mint a substitute?

4. **OWNERSHIP — NO WRITE OUTSIDE SCOPE.** Does the owned-path rule decide EVERY
   declared-scope write, or can a broader capability permission widen it? Verify
   `owned-scope-channels.ts` is genuinely an allowlist and that shell / mcp /
   dynamic MCP / skill.create / agent.delegate / hook.create / coordination.run /
   schedule.propose are all denied for scoped workers. Does `file.create` apply
   the same backstop to NEW files as to overwrites? Is there a mutation-checked
   test, or only a passing one?

5. **DENIED-ACTION NEGATIVES.** When denied, is the action observably denied with
   no side effect, or is partial state left? Is denial a decision or an error a
   caller might swallow and retry?

6. **THE RECORD'S OWN VALIDATOR.** Does
   `benchmark/evidence/gate-e-qualification-record.mjs` actually reject a bad
   record? Can a record pass with a vacuous clause, a missing negative case, a
   nonexistent evidence path, or an unsupportable independence claim? Is the
   "exit 3 for author-only" distinction real? Would it catch a record naming
   tests that do not assert what they claim?

7. **GAP HONESTY.** The record declares gaps F-02, F-03, F-04, F-07, F-11. Are
   those the REAL remaining gaps, or are there additional unqualified areas the
   record omits? Name anything material it does not name.

8. **EVIDENCE SUFFICIENCY.** The 2026-11-02 x86-64 evidence claims 58 passing
   negative checks. Does it actually establish what REQ 1 asked, or does it
   overclaim? Does the retained artefact set let you re-derive the claims, or
   must you take them on trust?

## Constraints

- **READ-ONLY.** Do NOT write, stage, commit or modify any repository file.
- Do NOT run the full test suite.
- Do NOT call any provider or network service.
- You may read files and run read-only shell inspection (`git log`, `grep`,
  `git diff` are fine; `pnpm install`, `git commit`, file writes are not).

## Output (plain text, no preamble)

- `CLAUSE VERDICTS` — per clause (GE-01..GE-05): QUALIFIED / PARTIAL / NOT
  QUALIFIED, with the specific test or assertion that justifies it, or the
  specific reason it does not.

- `PREVIOUS FINDINGS` — for each of the five prior findings: CLOSED / STILL OPEN /
  PARTIALLY ADDRESSED, with file:line.

- `DEFECTS` — each with file:line, severity (critical/major/minor), what it
  allows, and the minimal fix.

- `VACUOUS ASSERTIONS` — any test naming a control that would still pass with the
  control removed. Most important section. Be adversarial.

- `UNDECLARED GAPS` — material gaps the record does not name.

- `CAN THESE TESTS PASS WITHOUT THE CONTROL?` — yes/no per clause with the
  concrete counterexample.

- `EVIDENCE VERDICT` — does the retained 2026-11-02 evidence support its own
  claims?

- `VERDICT` — is this author-side work sound enough for an independent party to
  accept as coverage of REQ 2? Answer strictly. If a test cannot fail when its
  control is removed, say NO and name it. State clearly what an independent HUMAN
  qualifier must still do that this review does not do, and whether your own
  verdict may be cited as human independence (it may not — say so).
