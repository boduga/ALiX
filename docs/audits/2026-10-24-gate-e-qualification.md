# Gate E — execution/security qualification, author-side

**Date:** 2026-10-24
**Artifact:** `ea863a25b5dd0e014d275bc1c4b979b7b7d5afee`
**Record:** [gate-e-qualification-record.json](2026-10-24-gate-e-qualification-record.json)
**Validator:** [`benchmark/evidence/gate-e-qualification-record.mjs`](../../benchmark/evidence/gate-e-qualification-record.mjs)
**Outcome:** **`HOLD` — 0 of 5 clauses qualified.** An independent review rejected the author-side qualification; two clauses are NOT QUALIFIED, three are partial. See §9.

## 1. What the gate asks, and what this does

> "Gate E — Execution/security: F8b, authority, crash/recovery, ownership and
> denied-action negatives qualified independently." — PRD §9

Five clauses. Before this record, Gate E had never been *run* — the acceptance
matrix said "authorized; independence still absent", and the available evidence was
scattered across two test directories, an invariant register and a historical F8b
report. Nothing assembled it, so nothing could contradict a claim either way.

This executes the five clauses and records what each one proves, with the negative
case named. It does **not** close Gate E, because one word in the requirement —
*independently* — is not something an author can supply.

## 2. Clauses, evidence, and what each one actually proves

| # | Clause | What an independent review found | Evidence cited | State |
|---|---|---|---|---|
| GE-01 | **F8b** — child-process approval surface | `WorkerApprovalPort` throws at construction if `resolve`/`revoke`/`invalidate`/`mutate` appear; `recordExecutionOutcome` scoped to the bound `workerId` | `worker-approval-port.vitest.ts` (14 tests) | **partial** — constructor guard is verified by a VACUOUS test; facade narrows an object without confining a process (D6, D7) |
| GE-02 | **Authority** — policy deny survives every mode | Deny stays deny across `ask`/`auto`/`bypass`; no allow is invented; deny-wins when both match; a consumed approval cannot be re-consumed | `pre-r032-non-bypass.vitest.ts`, `policy-gate.test.ts`, `rule-evaluator.test.ts` | **NOT QUALIFIED** — hard deny bypassed by safe-shell dispatch (D1); first-match-wins defeats deny-wins (D11) |
| GE-03 | **Crash/recovery** — claimed-then-crashed approval stays consumed | A pending claim observed on replay is `unverified` and denied without reissuing authority; a legacy approval with no fingerprint fails closed; silence is never success | `approval-crash-recovery.test.ts`, `legacy-approval-single-use.test.ts`, `approval-consumed-propagation.test.ts` | **partial** — ordinary replay is real; coordination replay mints replacement authority (D4); stale-lock takeover (D3) |
| GE-04 | **Ownership** — no write outside declared scope | The owned-path rule decides every declared-scope write; a broader capability permission never widens the grant; `file.create` backstops new files | `path-scope.test.ts` parity table, `ownership-gate.test.ts`, `ownership-registry.test.ts`, `policy-protected-path-parity.vitest.ts` | **NOT QUALIFIED** — `OWNED_WRITE_TOOLS` excludes `shell.run`, so a shell redirect escapes scope (D2) |
| GE-05 | **Denied-action negatives** | Protected paths are not written; a denied command never reaches dispatch; denial produces a deny decision, not an execution | `pre-r032-non-bypass.vitest.ts`, `command-classifier.test.ts`, `policy-protected-path-parity.vitest.ts`, `ownership-gate.test.ts` | **partial** — decision assertions exist; dispatch suppression and absence of effects are not demonstrated |

**Executed:** 282/282 tests passed — 214 via `node --test`, 68 via `vitest run`.
Counts are in the record and checked by the validator: a failing suite, or counts
that do not add up, cannot produce a qualification.

## 3. Declared gaps — preserved, never counted as covered

Five named limitations travel with the record. None is new; each was already in the
invariant register or its acceptance row. The validator requires the list to be
*present* (an absent list usually means gaps were dropped rather than none found),
and reports them as `gaps preserved, NOT covered`.

| ID | Gap | Why it stays open |
|---|---|---|
| F-02 | No explicit wrong-workspace test for the worker port | The failure mode cannot be constructed through the port (no user-supplied workspace path), but the test does not exist |
| F-03 | Tool-level operator denial not exercised through the full TUI scenario | Denial proven at port and dispatch level only |
| F-04 | Ownership **hard-conflict** rejection not demonstrated | Prior evidence shows dependency *serialization*, not rejection of an unsynchronized conflict |
| F-07 | Transient clamp-reload observation unresolved | Possible timing fragility; one unreproduced observation |
| F-11 | D4-04 delegate transport flake bounded, not fixed | 42 consecutive passes, zero reproduction; standing hypothesis unproven |

GE-05 was recorded as "qualified" for the paths it tested, with **F-03 as the reason
that is not "all denied actions"**.

> **Superseded by §9.** The verdicts in this table are the author-side claim. An
> independent review rejected them: 0 of 5 clauses qualified, 2 NOT QUALIFIED. The
> table is retained as the claim under review, not as the finding.

## 4. Independence was obtainable, and I was wrong that it was not

I originally wrote here that independence was absent because no second party could
produce it. That was too strong. This repository already had precedent —
model-independent review by a different model family, on a pinned commit, with the
prompt and verbatim output committed — and it was used for Gate B.

So it was used here too (§9). The reviewer returned **NO**.

The lesson is worth stating plainly: independence was not a formality to be
satisfied after the tests were green. It was the step that revealed the tests were
green without establishing their controls. Had it been treated as available from
the start, the record would never have claimed 5/5.

## 5. Two validator decisions worth stating

**Exit `3`, not `0`.** A sound author-only record exits `3`. If it exited `0`, a CI
step would read "the record validates" as "Gate E closed".

**And a third the review had to teach me (D10).** That distinction only covered the
author-only path: a well-formed record with one `partial` clause returned `ok: true`
and `HOLD`, and exited **0** from the `ok` branch. A HOLD read as a pass. HOLD now
always exits non-zero, and `independence.qualifier` must cite an existing artifact
that names the qualifier (D9) — a record can no longer declare its own independence
from free text.

**`pathBase` is required.** The record declares whether its citations resolve beside
the record file or from the repository root. Both are legitimate; guessing is not.
A silent default either rejects valid citations or accepts nonexistent ones, and
either way the path check becomes decorative. (Both Gate B's and Gate F's validators
learned this the same way — by failing on a real record.)

## 6. Computed state

```
valid: true
gate E: HOLD
clauses: 5/5 recorded (qualified 0, partial 3, unqualified 2)
independence: model-independent
declared gaps: 5
note: observed: 282/282 tests passed in this run
note: gaps preserved, NOT covered: F-02, F-03, F-04, F-07, F-11
```

Exit code **1**. The 282 tests still pass; they do not establish the controls they
are named after. See §9.

## 6.1 Suite repair found while verifying this record

Running the full suite to confirm the record's numbers surfaced 20 failures that
had nothing to do with Gate E, and they were **pre-existing**: both suites fail
identically at parent commit `ea863a25` in a clean worktree.

The cause was a fixture defect, not a product defect. Two fixtures configured model
tiers under `subagents.<tier>`, but `createModelResolver` reads `config.models[tier]`.
So `getRoleModel` threw "Subagent tier is unconfigured" and every assertion
downstream of `spawn()` observed that error instead of the behaviour it was written
to check.

Type-checking could not catch it: §2.8.1/§2.8.4 made `subagents.<tier>` a
loader-derived compatibility projection — genuinely part of the type, never
persisted, never the source. The fixtures kept the projection and lost the source.

| Suite | Before | After |
|---|---|---|
| `subagent-manager.test.ts` | 3/19 | **19/19** |
| `subagent-worker-executor.test.ts` | 9/13 | **13/13** |

Node lane after repair: **8915 pass, 0 fail**. Both are recorded in the Gate E
record under `suiteRepair`. They are **not** Gate E evidence — the five clauses cite
different files — but a suite reporting 20 failures cannot be read as green, so the
repair is written down rather than left implicit.

Two tests were *cancelled*, not failed, by resource contention in the parallel run:
`cli-discover.test.js` spent 48 minutes under contention and passes in 11s
standalone, and `ContextCompiler.warm()` timed out at 120s but passes in 2s
standalone. Cancellation is recorded as cancellation.

## 7. Reproduce

```sh
node --test dist/tests/security/legacy-approval-single-use.test.js \
  dist/tests/security/approval-crash-recovery.test.js \
  dist/tests/security/approval-consumed-propagation.test.js \
  dist/tests/ownership/path-scope.test.js \
  dist/tests/ownership/ownership-gate.test.js \
  dist/tests/ownership/ownership-registry.test.js \
  dist/tests/policy/policy-gate.test.js \
  dist/tests/policy/rule-evaluator.test.js \
  dist/tests/policy/command-classifier.test.js
npx vitest run --config vitest.config.mts tests/security/worker-approval-port.vitest.ts \
  tests/security/policy-protected-path-parity.vitest.ts \
  tests/security/pre-r032-non-bypass.vitest.ts \
  tests/security/pre-r024-isolation-qualification.vitest.ts \
  tests/security/approval-event-dedup.vitest.ts
node benchmark/evidence/gate-e-qualification-record.mjs docs/audits/2026-10-24-gate-e-qualification-record.json
node --test benchmark/evidence/gate-e-qualification-record.test.mjs
```

The record command exits `3` today. That is the correct result and it will keep
being correct until a second party qualifies the five clauses.

## 8. What this does not claim

- Not independent qualification. Author-side only, labelled everywhere.
- Not a Gate E clearance. The gate stays open on the word it names.
- Not "all denied actions are caught" — F-03 and F-04 bound that claim.
- Not F8b release clearance. P0-G remains a separate security track (PRD §5, P0-G).
- Not Gate F clearance. Independent clearance and the maintainer decision remain
  absent, and [`release-clearance-record.mjs`](../../benchmark/evidence/release-clearance-record.mjs)
  computes `HOLD`.

## 9. Independent review — and it said NO

You were right that "no agent can measure this" was too strong. A second party
**does** exist, and using one was the correct move: this repository already has
precedent for model-independent review (Codex, different model family, different
harness, pinned commit, committed prompt and verbatim output).

Reviewer: `Codex / gpt-6.1-sol`, codex-cli 0.164.0, `--sandbox read-only`.

| Item | Value |
|---|---|
| Prompt | `docs/audits/evidence/2026-10-25-codex-gate-e-review-prompt.md`, SHA-256 `d7b67e71…` |
| Verbatim output | `docs/audits/evidence/2026-10-25-codex-gate-e-review.txt`, SHA-256 `b70d8ef0…` |
| Verdict | **NO** |

### 9.1 What it found

It downgraded **all five** clauses. The author-side record claimed 5/5 qualified;
the honest count is **0 qualified, 3 partial, 2 not qualified**.

| Clause | Author claim | Review | Decisive finding |
|---|---|---|---|
| F8b | qualified | **partial** | The constructor guard is verified by a **vacuous** test; the facade narrows an object but does not confine a process (D6, D7) |
| Authority | qualified | **NOT QUALIFIED** | Hard deny bypassed: `executor.ts:513` dispatches safe-shell commands **before** authorization in ask mode (D1); `rule-evaluator` returns the **first** matching rule, so an allow preceding a deny wins (D11) |
| Crash/recovery | qualified | **partial** | Ordinary replay is genuinely asserted; coordination replay **mints replacement authority** instead of denying uncertainty (D4); stale-lock takeover admits two claimants (D3) |
| Ownership | qualified | **NOT QUALIFIED** | `OWNED_WRITE_TOOLS` covers only `file.create`/`file.delete`/`patch.apply`, so `shell.run` can never trigger owned-path enforcement — a redirect to `outside.txt` returns **allow** (D2) |
| Denied-action | qualified | **partial** | Decision assertions exist, but no dispatch suppression or absence-of-effects proof |

### 9.2 Defects in my own validator

Two of the eleven defects were in the Gate E validator itself, and both let a
**worse** record look better than a real one:

- **D9 — independence by typing.** Changing `class` to `declared-independent` plus a
  note of "trust me" produced `QUALIFIED-INDEPENDENT`. The strongest label in the
  vocabulary was reachable by assertion. Fixed: a non-author-only class now requires
  `independence.qualifier {ref, identity, reviewedAt}`, the ref must exist, and it
  must **name** the qualifier — the same rule Gate B's waiver and Gate F's approval
  already enforced. I had applied that rule twice and not to my own strongest label.
- **D10 — HOLD exited 0.** A well-formed record with one `partial` clause returned
  `ok: true` and `HOLD`, and the CLI exited **0** from the `ok` branch. A pipeline
  would have read a HOLD as a pass. Fixed: HOLD always exits non-zero.

Both are reproduced by probe in the test suite (23 tests now, 5 added by this review).

### 9.3 What I verified myself rather than accepting

Reviewer output is data, not authority. Each claim below was re-checked directly:

| Claim | Check | Result |
|---|---|---|
| Constructor guard test is vacuous | **Deleted the guard** and re-ran | **14/14 still pass** — confirmed vacuous |
| `shell.run` escapes owned scope | Read `OWNED_WRITE_TOOLS` at `policy-gate.ts:94` | Confirmed: three file tools only |
| Safe-shell dispatch precedes authorization | Read `executor.ts:505–534` | Confirmed: dispatch at `:513`, authorization at `:534` |
| Deny-wins is first-match | Read `rule-evaluator.ts:39` | Confirmed: returns first matching rule |
| D9 forged independence | Replayed the probe against my validator | Confirmed, then fixed |
| D10 HOLD exits 0 | Replayed the probe | Confirmed, then fixed |

The guard test was the most damaging: it named a control and would pass with the
control **removed**. That is worse than a missing test, because a missing test is
visible in a coverage gap while a vacuous one reads as coverage.

### 9.4 Why this changes the conclusion

My earlier claim — "gate E's clauses are executed; only a second party is missing" —
was half right and half wrong. The second party was obtainable, and having obtained
it, the answer was **no**. The tests passed 282/282 and still did not establish the
controls they were named after.

This is the case for independence in one artifact: the author ran the suite, saw
green, and wrote a record. A reviewer who had not written the tests asked whether
they could *fail*, and five of them could not.

### 9.5 Current honest state

```
valid: true
gate E: HOLD
clauses: 5/5 recorded (qualified 0, partial 3, unqualified 2)
independence: model-independent
declared gaps: 5
```

Gate E is **HOLD**, not qualified even author-side. Independent review is not the
same as a clearance — here it is the opposite of one: it is the reason the gate
stayed closed.

### 9.6 What would move it

The defects are real and fixable. In priority order:

1. **D1 (hard-deny bypass)** — evaluate mandatory denies before the safe-shell
   bypass. This is a live authority hole, not a documentation issue.
2. **D11 (first-match)** — implement deny-wins precedence and test overlapping rules
   in both orders.
3. **D2 (shell ownership)** — deny unscopable mutation channels for scoped workers.
4. **D3/D4/D5** — atomic approved→consumed CAS, deny consumed coordination bindings
   instead of minting replacements, retain the approval id on both consumption routes.
5. **Vacuous tests** — replace each with one that fails when its control is removed.
6. **D6/D7** — either bound the F8b threat model explicitly or move decision
   authority behind parent-owned IPC.

Each needs mutation-checked proof before the clause count moves. Nothing above is
claimed as fixed.

### 9.7 What this does not claim

- Not a Gate E clearance. It is a HOLD with two clauses worse than partial.
- Not human independence. The reviewer was a model, labelled `model-independent`.
- Not that the 282 passing tests are worthless — the ordinary replay and the
  blanket-allow ownership regression would fail if their controls were removed.
- Not that remediating the six items closes the gate: each needs its own
  mutation-checked evidence, and F8b release clearance remains a separate track.

## 10. Remediation — D1 and D2 fixed

Both authority holes are repaired, each with a test that fails when the control
is removed. Gate E stays `HOLD`; the clause count has not moved.

### 10.1 D2 — shell writes escaped declared ownership

`OWNED_WRITE_TOOLS` listed only `file.create`, `file.delete` and `patch.apply`, so
`hasOwnedWriteScope` was false for a shell command and the owned-path rule never
ran. The capability's blanket `allow` then short-circuited. A worker owning
`inside.txt` was permitted `printf x > outside.txt`.

Fix: a new hard-deny rule at policy step **1.5**, before the permissive branches:

```
if (isUnscopableMutationWithinScope({ capability, ownedPaths })) -> deny
  matchedRuleId: "unscopable-mutation-rule"
```

Placed with the other denies rather than later, because a rule reachable only
after a permissive branch is not a rule. The set is `shell.run`, `mcp.invoke`,
`dynamictool.invoke` — channels whose targets `mutationTargets()` cannot
enumerate. Deny is the only safe answer: the gate cannot prove the command stays
inside the declared paths.

Scope of the narrowing: **scoped workers only.** Unscoped workers are unaffected,
and in-scope file writes still take the `owned-path-rule` allow. Both are asserted,
so the fix narrows rather than removes.

### 10.2 D1 — safe-shell bypass was a deny bypass

The ask-mode bypass existed to skip the *approval* gate for read-only commands. It
returned before authorization entirely, so a command in `denyCommands` executed as
long as `isSafeShellCommand` accepted it. `ls` is both safe and deniable — the
exact overlap.

Fix: the bypass now asks for a **mandatory deny** first and returns an error
result when one applies.

One subtlety worth recording: the first version of this probe treated *any* `deny`
as mandatory, including `approval-store-missing`, which broke a legitimate safe
command in an executor without a store. That is an absent dependency, not a verdict
on the command, so it is excluded. The probe now answers only genuine policy
denies — it can refuse, never widen.

### 10.3 Mutation evidence

A passing test proves nothing here; the Gate E review established that. Each fix
was verified by disabling it:

| Fix | Control disabled | Result |
|---|---|---|
| D2 | `if (false && isUnscopableMutationInScope(...))` | **2 tests fail** |
| D1 | `const mandatoryDeny = null` | **1 test fails** |

Both restored, suites green: `policy-gate` 43/43, `executor` 12/12, and 622 node +
140 vitest across security/ownership/policy/tools.

### 10.4 What is still open

D11 is next and is the reason **authority** stays `NOT QUALIFIED`: `rule-evaluator`
returns the *first* matching rule, so an `allow` listed before a `deny` still wins.
That is a precedence bug rather than a bypass of the gate, but a deny-wins claim
that depends on file order is not deny-wins.

Also open: D3 (approval CAS race), D4 (coordination replay mints replacements),
D5 (lost receipts on preconsumed approvals), D6/D7 (F8b is an object boundary, not
a process boundary), D8 (corrupt authority files fall open), and the vacuous tests
the review named.

Gate E remains `HOLD` at **0 of 5 clauses qualified**. Two holes closed; the gate is
not closed.

## 11. Remediation — D11 deny-wins

Fixed. `RuleEvaluator` was **first-match-wins**, so a deny held only when no
permissive rule appeared before it in file order. File order granted authority.

The hole existed **without anyone editing a rule file**: the shipped defaults
declare `allow-file-read` (match: `capability`) before `deny-critical-risk`
(match: `riskLevel`). A critical-risk file read matched the allow first and was
permitted. Verified through the CLI:

```
$ alix policy eval --capability filesystem.read --risk critical
Before: Decision: allow   Rule: allow-file-read
After:  Decision: deny    Rule: deny-critical-risk
```

### 11.1 The rule

Precedence is now `deny > ask > allow` over **all** matching rules. Two properties
follow, and they are what the tests assert:

- file order cannot grant authority; only an absence of stricter matches can
- adding a deny anywhere in the file takes effect immediately

The reported rule is the strictest match, and the **earliest among equals** — so
the decision never depends on order, while the audit line stays stable across
runs. `matchedRuleId` is audit-only (no consumer branches on it), and
`detect-changes` rated this change LOW risk: 7 symbols, 0 execution processes.

### 11.2 Mutation evidence

Reverting to first-match-wins fails **5 of 21** tests, including the
shipped-defaults case:

| Reverted | Failing |
|---|---|
| `deny > ask > allow` precedent | 5 |
| restore | 0 |

### 11.3 Where the gate now stands

| Clause | Before | Now |
|---|---|---|
| Authority | NOT QUALIFIED | NOT QUALIFIED — D1 and D11 both fixed, but the clause cannot be claimed until the fixes are re-reviewed |
| Ownership | NOT QUALIFIED | NOT QUALIFIED — D2 fixed, router backstop evidence still uncited |

Three of the review's major defects are now closed with mutation-checked tests.
Gate E remains **HOLD** at **0 of 5**: the honest reading is that three holes are
shut and the remaining ones (D3–D8, plus the vacuous tests) are still open. A
re-review decides the clause verdicts, not the author.
