# Gate E — execution/security qualification, author-side

**Date:** 2026-10-24
**Artifact:** `ea863a25b5dd0e014d275bc1c4b979b7b7d5afee`
**Record:** [gate-e-qualification-record.json](2026-10-24-gate-e-qualification-record.json)
**Validator:** [`benchmark/evidence/gate-e-qualification-record.mjs`](../../benchmark/evidence/gate-e-qualification-record.mjs)
**Outcome:** `QUALIFIED-AUTHOR-ONLY` — **the gate is not cleared.**

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

| # | Clause | Negative case that would catch a regression | Evidence | State |
|---|---|---|---|---|
| GE-01 | **F8b** — child-process approval surface | `WorkerApprovalPort` throws at construction if `resolve`/`revoke`/`invalidate`/`mutate` appear; `recordExecutionOutcome` scoped to the bound `workerId` | `worker-approval-port.vitest.ts` (14 tests, red-checked both ways) | qualified |
| GE-02 | **Authority** — policy deny survives every mode | Deny stays deny across `ask`/`auto`/`bypass`; no allow is invented; deny-wins when both match; a consumed approval cannot be re-consumed | `pre-r032-non-bypass.vitest.ts`, `policy-gate.test.ts`, `rule-evaluator.test.ts` | qualified |
| GE-03 | **Crash/recovery** — claimed-then-crashed approval stays consumed | A pending claim observed on replay is `unverified` and denied without reissuing authority; a legacy approval with no fingerprint fails closed; silence is never success | `approval-crash-recovery.test.ts`, `legacy-approval-single-use.test.ts`, `approval-consumed-propagation.test.ts` | qualified |
| GE-04 | **Ownership** — no write outside declared scope | The owned-path rule decides every declared-scope write; a broader capability permission never widens the grant; `file.create` backstops new files | `path-scope.test.ts` parity table, `ownership-gate.test.ts`, `ownership-registry.test.ts`, `policy-protected-path-parity.vitest.ts` | qualified |
| GE-05 | **Denied-action negatives** | Protected paths are not written; a denied command never reaches dispatch; denial produces a deny decision, not an execution | `pre-r032-non-bypass.vitest.ts`, `command-classifier.test.ts`, `policy-protected-path-parity.vitest.ts`, `ownership-gate.test.ts` | qualified |

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

GE-05 is therefore "qualified" for the paths it does test and **F-03 is the reason
that is not the same as "all denied actions"**. The record says both.

## 4. Why the label is `QUALIFIED-AUTHOR-ONLY`

Gate E's word is *independently*. The tests were authored alongside the code, so
they encode the author's model of the invariant — including the author's blind
spots. This is not a measurement defect to be repaired by more tests; it is the
thing independence names.

The honest dispositions:

1. **Independent qualification (best).** A second party runs the five clauses and
   arrives at its own verdict. Converts the label to `QUALIFIED-INDEPENDENT`.
2. **Model-independent review (weaker, labelled).** A different model family, own
   verdict, pinned commit — the same class already labelled throughout Gate B. It
   is not a person, and the record has a distinct value for it rather than
   overloading "independent".
3. **Author-only (this record).** Coverage is real and executable; independence is
   absent.

An operator waiver records acceptance of author-only testing. It does not create a
second party, and this record claims none.

## 5. Two validator decisions worth stating

**Exit `3`, not `0`.** A sound author-only record exits `3`. If it exited `0`, a CI
step would read "the record validates" as "Gate E closed" — the two questions are
different, and the exit code now says so.

**`pathBase` is required.** The record declares whether its citations resolve beside
the record file or from the repository root. Both are legitimate; guessing is not.
A silent default either rejects valid citations or accepts nonexistent ones, and
either way the path check becomes decorative. (Both Gate B's and Gate F's validators
learned this the same way — by failing on a real record.)

## 6. Computed state

```
valid: true
gate E: QUALIFIED-AUTHOR-ONLY
clauses: 5/5 (qualified 5, partial 0, unqualified 0)
independence: author-only
declared gaps: 5
note: observed: 282/282 tests passed in this run
note: gaps preserved, NOT covered: F-02, F-03, F-04, F-07, F-11
note: author-side qualification only: Gate E requires independent qualification
note: this does not clear Gate E; it records the coverage an independent qualifier would review
```

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
