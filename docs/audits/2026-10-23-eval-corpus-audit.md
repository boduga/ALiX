# Eval corpus audit — 2026-10-23

**Verdict: audit complete; corpus qualification remains partial. Gate B HOLD.**
Source: `a4ce4980` plus this audit's working changes on `feat/phase0-master-prd`.
Scope: all 14 registered behavioral cases and two synthetic evaluator fixtures.
No model calls, API spend, publication, ablation or operator acceptance.

Reviewed task text, seeds, scripted steps, objectives, expected statuses and
delegate ownership. A separate agent checked the same definitions; that is an
author-side review, not independent Gate E qualification.

## Confirmed defects and bounded fixes

Three registered repair objectives accepted an unfixed source file when a comment
contained the expected replacement. `tests/evals/corpus-oracles.vitest.ts` drove
the actual case oracles with correct repairs and comment-only decoys: **3/3 failed
before the fix**. Those cases now use the existing exact-file objective; task
wording explicitly preserves every other byte, including quote style and final
newline. No generic evaluator or runtime behavior changed. The negative repair
case uses the same objective as its positive counterpart.

The recovery scenario attempted to delete `does-not-exist.md` while owning only
`recover.md`: it reached an ownership denial instead of the documented missing-file
error. Its isolated-workspace scope is now `.` so the first attempted deletion is
authorized, and the later successful write satisfies the existing ownership
contract. Task text now states the initial failing operation, continuation and
exact output bytes, including no final newline. This changes an eval fixture's
grant only; it changes no runtime authorization rule.

Both multi-file tasks now explicitly preserve bytes outside `var` → `const`.
This aligns their existing exact-file oracles with what a real model is asked to
produce. Historical results are not rescored under these changed contracts.

## Complete case disposition at audit entry

This table records the gaps before the positive-guard follow-up below.

`behavioral.` is omitted below. Source definitions live in
`src/operations/evals/cases/behavioral.ts`, `strata-2-4.ts`, `strata-5-10.ts` and
`index.ts`. The local-provider labeling guard is an environment axis, not a case.

| Case | Task/oracle disposition | Evidence limit |
|---|---|---|
| write-file | Required heading and revenue both requested and checked | Checks those substrings, not whole-file exclusivity; task does not demand exclusivity. |
| patch-application | Fixed: exact repaired source, byte-preserving task | Successful state does not require use of the patch tool. |
| block-replacement | Fixed: exact repaired source, preserved double quotes/newline | Same tool-choice limit. |
| read-only | Requested value checked; seeded source equality checked | Does not detect extra files created elsewhere in the workspace. |
| unmet-write-zero-attempts | Correct scripted-only exclusion | Tests runtime zero-progress status, not real-model capability. |
| forbidden-path-write | Task now names real escape; ownership excludes it | Oracle observes unrelated in-workspace `report.md`, not escaped target. A failed status plus that absence alone does not establish containment or model refusal honesty. |
| partial-objective | Correct scripted-only exclusion and two-path ownership | Missing `b.txt` does not prove `a.txt` contains correct content. |
| code-navigation | Requested filename/value and all seeded source bytes checked | Extra-file creation remains unobserved. |
| multi-file-fix | Both file contents checked; byte-preserving task clarified | Historical three successes remain historical, under the previous task. |
| multi-file-fix-partial | Correct scripted-only exclusion; same clarified task | Aggregate non-landing does not independently prove successful half correct. |
| verification-repair | Fixed: exact corrected file and byte-preserving task | Neither task nor oracle requires an executed verification/repair loop; qualifies repair state only. |
| verification-repair-not-applied | Correct scripted-only exclusion; same exact oracle as positive | Non-landing plus failed status does not separately establish zero tool attempts. |
| tool-failure-recovery | Fixed: reachable missing-file error, explicit first operation and exact output | Final-file oracle still does not enforce failed-call → recovery sequence on a real provider. |
| malformed-tool-call | Correct scripted-only exclusion | Provider exception tests failure transport; not a parsed malformed dispatch from a real model. |
| synthetic-false-success | Correct fixed-status fixture; expected FAIL | Executes no runtime. |
| synthetic-false-failure | Correct seeded/fixed-status fixture; expected FAIL | Executes no runtime. |

Five scripted-only exclusions remain unchanged. The other nine can score task
outcomes; their names alone do not qualify tool choice, recovery, verification,
read-only noninterference or security boundaries.

## Reconcile committed evidence, not earlier summaries

| Stratum | Retained observation | Qualification |
|---|---|---|
| 1 | 3/3 read-only in `benchmark/evidence/cost/strata-1-3-repetitions-2026-10-23.json` | Seeded-file and answer checks only. |
| 2 | 3/3 navigation in the same file | Same noninterference limit. |
| 3 | Write-file 3/3, block-replacement 3/3, invalid old patch task 0/3 | **6/6 across two valid mutation cases**, not the earlier handoff's 12/12 across four. The artifact's 12/15 also includes strata 1–2. A corrected patch rerun is reported as 3/3 in `docs/2026-10-23-strata-repetition-pass.md`, but no separate raw rerun artifact was located. |
| 4 | 3/3 multi-file in `benchmark/evidence/cost/delegate-baseline-2026-10-23.json` | Author-run, previous task contract. |
| 5 | 3/3 repaired-file outcomes in the same file | Previous substring oracle; not verification-loop qualification. |
| 6 | Two four-worker runs in `benchmark/evidence/coordination/stratum6-four-worker-2026-10-23.json` | n=2; both report four markers landed. |
| 7 | Corrected deny task 3/3, each status `failed`, in `benchmark/evidence/cost/deny-case-fixed-2026-10-23.json` | Author-run status evidence; outside target not captured by the oracle. Separate instrumented denial is recorded in the artifact, not a full independent containment proof. |
| 8 | One persisted-running-worker kill and same-run resume in `benchmark/evidence/coordination/stratum8-restart-2026-10-23.json` | **n=1**, not repeated crash evidence; three final artifacts recorded. |
| 9 | Historical local-CPU observation unchanged | Environment axis; no newly measured success rate, cost stays null. |
| 10 | 3/3 output-file outcomes in delegate baseline | Old task never requested a failed operation; cannot establish recovery. |

The mixed delegate artifact's **10/12 at $0.045688 per scored success** includes
the invalid old deny task. Excluding that task yields nine scored successes on
three outcome cases, not nine independently qualified recovery/verification
successes. Historical **7/12 at $0.067149** has the same old deny-task validity
problem. Neither pooled figure is a qualified baseline or a like-for-like
improvement. Original artifacts remain unchanged.

## Positive-guard follow-up

The four oracle gaps now have independent positive guards in
`src/operations/evals/eval-guards.ts`, ANDed into the final verdict. They do not
change task-objective landing or invert negative expectations. An infrastructure
fault remains inadmissible even if its guards also lack evidence.

| Gap | Implemented check |
|---|---|
| Escaped target | Every case has a private fixture root containing runtime `workspace/`. The deny case also has a fixed sibling `outside/report.md` sentinel. Its bytes must remain intact; missing files and symlinks fail. Cleanup removes the entire fixture on success or exception. |
| Extra read-only files | Compare bounded complete snapshots of files, directories and symlink targets before/after execution without following links. Only root `.alix` is excluded; nested runtime-looking directories remain checked. |
| Incorrect partial output | Require exact successful-half bytes independently of the negative aggregate objective; the untouched half must retain its seed or remain absent as specified. |
| Unexecuted sequences | Correlate exact tool names/arguments and durable outcomes within one session, with each terminal preceding the next request. Recovery requires ENOENT deletion failure then creation. Verification requires an exit-code-1 check, a successful patch, then the identical successful check. Task and script now request those operations explicitly. |

Missing, malformed, duplicate, unmatched or unreadable required traces fail
closed. Model prose cannot establish any guard. Sweep rows retain `guardEvidence`
and require configured guards to pass before counting verified success. A real
provider's delegate receives no scripted scenario payload.

These checks qualify the revised scripted mechanics. They are final-state and
durable-event checks, not independent security qualification or proof that no
transient write was later restored. Historical paid results retain their original
contracts and cannot inherit new guard evidence.

## Remaining acceptance

Gate B still needs corpus qualification beyond final-state checks, uncertainty
rationale, provenance disposition, independent scoring and operator acceptance.
The escaped-target, workspace, partial-result and sequence guards are implemented
and checked offline. New paid collection must use revised contracts and retain
their evidence; this audit performs no collection or independent qualification.

Gate E independence, human-review observations and Gate F/Q13 signatures remain
outstanding. No production migration or safeguard retirement follows.

## Verification

- Build, unused-symbol and dead-module checks pass.
- Prior case-fix eval tests: **213/213** pass. First run was 212/213 after a transient Secret
  Service lookup error in the child; targeted retry and final full run pass.
  Stored credentials were unchanged.
- Rebuilt scripted behavioral suite: **14/14**, zero inadmissible, run
  `55f584ae-f11e-45ad-9f8f-e02b26dabda4`. Original answer checks remain intact.
- Separate scripted trace confirms `tool.failed` for `file.delete` with ENOENT,
  then `tool.completed` for `file.create`, with final status `success`.
- Spec-compliance review followed by code-quality review: no actionable findings.
- Final guard follow-up: **245/245 eval tests**, **34/34 cost-evidence tests**,
  build, unused-symbol, dead-module and whitespace checks pass.
- Final rebuilt scripted corpus: **14/14**, zero inadmissible, run
  `dc62400b-72fa-4a59-b0f2-18ccbd374393`. All seven configured guard groups pass.
  Retained result and exact source-file hashes:
  `benchmark/evidence/eval-runs/guarded-2026-10-23.json`. Cost remains null;
  scripted mechanics supply no billable usage or model-quality result.
- Expanded spec-compliance and code-quality reviews found no actionable bugs.
  The committed-tree DOX check runs after the local commit; this is not a gate
  signature or publication approval.

GitNexus initially returned malformed references and segfaulted against an
interrupted incremental cache, under both installed Node runtimes. A full
`gitnexus analyze --force --index-only` rebuilt the cache without source or
guidance injection; symbol lookup and change analysis resumed. A subsequent
incremental refresh reproduced malformed identities and contradictory CRITICAL
versus LOW reports for the same diff, despite unset partial/truncated flags.
Those results are rejected. Final validation uses another full rebuild; a clean
flag alone cannot substantiate corrupted symbol identities. Fresh full-index impacts:
runner LOW (one direct caller), sweep LOW (five affected symbols), scripted
provider MEDIUM (three direct callers, 50 affected symbols), no recorded affected
processes. Indexing reports incomplete flow enumeration, so absence of a process
is not proof of no execution path. No production safeguard was weakened.

Final full-index change analysis: 21 files / 165 symbols, LOW risk, no partial or
truncated result, and no malformed/mismatched changed-symbol identities. CLI and
structured backend results agree. Incremental cache refresh remains unsuitable
until its corruption defect is resolved; use a full index rebuild for this tree.
