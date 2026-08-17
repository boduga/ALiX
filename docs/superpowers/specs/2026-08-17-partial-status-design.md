Partial-Status & Objective-Aware Subagent Completion — Design

Date: 2026-08-17
Branch: "worktree-partial-status"
Issues: follow-up to #567
Related PR: #568 — squash-merged "5be4f263"

---

1. Problem

Issue #567 introduced the rule:

«A subagent is failed iff a write tool failed.»

The implementation reduced completion to:

computeSubagentStatus(
  fatalWriteFailures.length > 0 ? "failed" : "success"
)

A live v3 run exposed a false negative.

The delegated change successfully landed:

verify-scratch.ts
const target = 42;

but the worker ultimately reported:

status: "failed"
exit: 1

because the model continued emitting "patch.apply" calls after the successful mutation, and those later calls failed.

The actual sequence was:

1. patch target=42
   → patch.applied
   → file updated successfully

2. patch with malformed closer
   → No patch changes found

3. patch searching for:
     const target = 1;
   → Search block not found
   → file already contains:
     const target = 42;

4. loop ends
   → fatalWriteFailures = ["patch.apply"]
   → status = failed

There was no ALiX runtime retry involved.

The model simply continued generating tools after the requested mutation had already landed.

Root cause

ALiX currently treats:

«"a later model-generated write failed"»

as equivalent to:

«"the delegated objective failed."»

Those are not equivalent.

A delegated worker may legitimately:

- modify multiple files;
- make several successful mutations;
- continue reasoning after a successful mutation;
- attempt an obsolete patch after the file has already changed;
- make an unsuccessful mutation attempt after the requested objective has already been satisfied.

Therefore, write-attempt failure and objective completion must be tracked independently.

---

2. Design Goal

Replace single-ledger completion accounting with dual, independent tracking:

1. durable write progress;
2. write failures.

The worker then determines completion from the actual filesystem paths successfully affected by writes, rather than from the existence of failed write attempts.

The central invariant is:

«A successful mutation cannot subsequently be converted into "failed" merely because the model emits additional unsuccessful mutations, when the original delegated objective has already been satisfied.»

---

3. Core Data Model

Introduce:

type WriteProgress = {
  successfulPaths: Set<string>;
  fatalWriteFailures: string[];
};

These fields have deliberately different semantics.

"successfulPaths"

Contains canonical paths affected by successful write calls.

It represents durable progress.

"fatalWriteFailures"

Contains names of write tools whose execution failed.

It preserves the existing failure semantics for the no-progress case and for diagnostics.

The two ledgers must not be collapsed into a single status signal.

---

4. Successful-Path Extraction

Every successful write contributes its actual affected paths to "successfulPaths".

The status calculation does not care which write tool performed the mutation.

The path source is:

Tool| Successful-path source
"file.create"| "ToolResult.createdPath", fallback "changedFiles"
"file.delete"| "ToolResult.deletedPath", fallback "changedFiles"
"patch.apply"| "ToolResult.changedFiles"
Other tools| no path credit

The extraction should be centralized in a small pure helper rather than duplicated throughout the tool loop.

Conceptually:

extractSuccessfulPaths(toolName, result): string[]

Required semantics

Only a successful tool result may contribute paths.

A failed write attempt must never receive path credit merely because:

- the attempted path appears in its input;
- the path appears in an error message;
- the tool reports what it tried to modify.

The ledger represents durable mutation evidence, not attempted mutation.

This gives the invariant:

«"successfulPaths" contains only paths actually affected by successful write calls.»

---

5. Objective Definition

For write-mode delegated work, the objective is a deterministic filesystem contract:

«Every explicitly owned path must be covered by at least one path affected by a successful write.»

Let:

ownedPaths: string[]
successfulPaths: Set<string>

Then:

objectiveComplete =
  ownedPaths.length === 0 ||
  ownedPaths.every(owned =>
    successfulPaths.some(sp =>
      sp === canonical(owned) ||
      sp.startsWith(canonical(owned) + "/")
    )
  );

Both sides must be canonicalized before comparison.

---

6. Meaning of Owned-Path Coverage

Coverage has two forms.

Exact path coverage

owned:     verify-scratch.ts
successful:
           /project/verify-scratch.ts

→ complete

Directory coverage

owned:     src/
successful:
           /project/src/foo.ts

→ complete

This is intentional.

The comparison is:

successfulPath === ownedPath

or:

successfulPath startsWith ownedPath + "/"

The separator is important.

For example:

owned: src/
successful: src/foo.ts
→ covered

but:

owned: src/foo.ts
successful: src/foo.ts.bak
→ NOT covered

This avoids accidental prefix matches.

---

7. Path Canonicalization

Both owned paths and successful mutation paths must use the same canonicalization semantics before coverage is evaluated.

The canonical form is conceptually:

function canonical(cwd: string, path: string): string {
  return path.startsWith("/") ? path : resolve(cwd, path);
}

However, do not introduce a second independent canonicalization implementation.

The existing:

resolvePolicyPath(cwd, path)

in:

src/policy/policy-gate.ts:71

already defines the relevant policy-path semantics.

Required change

Export "resolvePolicyPath()" from "policy-gate.ts".

The completion evaluator must import and reuse it.

This guarantees that policy approval and completion coverage use the same path representation.

---

8. Policy/Completion Consistency

The existing policy containment rule is:

isWithinOwned(...)

with equality-or-direct-child semantics.

Completion coverage must use the same comparison shape.

Therefore:

policy approval semantics
        +
completion coverage semantics
        ↓
same canonical path representation

This prevents a class of inconsistencies where:

- the policy gate says a path is owned;
- but completion accounting says the same path is not covered.

There must be exactly one canonical path normalization implementation for this purpose.

---

9. Canonical Working Directory

The worker's project root is:

process.cwd()

This is the canonical "cwd" passed to "resolvePolicyPath()" during objective evaluation.

Owned paths arrive as project-relative values, for example:

--owned-paths verify-scratch.ts

Successful mutation paths may be:

- relative;
- absolute;
- relative to the path supplied by the model;
- absolute paths returned by "resolvePatchPath()".

Mixed forms are expected.

Canonicalization is therefore mandatory.

---

10. Status Determination

Status must be calculated from durable progress + objective coverage, not from the failure ledger alone.

The algorithm should be explicit:

if (successfulPaths.size === 0) {
  return fatalWriteFailures.length > 0
    ? "failed"
    : "success";
}

if (ownedPaths.length === 0) {
  return "success";
}

if (objectiveComplete) {
  return "success";
}

return "partial";

This produces the following matrix:

Successful paths| Fatal write failures| Coverage| Status
0| 0| —| "success"
0| >0| —| "failed"
>0| 0| complete| "success"
>0| >0| complete| "success"
>0| 0| incomplete| "partial"
>0| >0| incomplete| "partial"

Critical rule

Once durable progress exists:

successfulPaths.size > 0

"failed" is no longer a reachable status.

The only remaining distinction is:

objective complete → success
objective incomplete → partial

This is the core correction to #567.

---

11. Interpretation of "fatalWriteFailures"

"fatalWriteFailures" retains its existing semantics as an observation of failed write calls.

However:

«Fatal write failures do not independently determine failure once durable progress exists.»

They are therefore relevant primarily for:

- determining "failed" when there is no durable progress;
- diagnostic output;
- explaining a "partial" result.

They cannot demote a completed objective to "failed".

---

12. The v3 Regression Case

Given:

ownedPaths:
  verify-scratch.ts

successfulPaths:
  verify-scratch.ts

fatalWriteFailures:
  patch.apply
  patch.apply

Canonicalization gives:

owned:
  /project/verify-scratch.ts

successful:
  /project/verify-scratch.ts

Therefore:

objectiveComplete = true

and:

status = success

The later failed patch attempts are diagnostic noise with respect to completion.

The expected result is:

status: success
exit: 0

This is the primary regression test for the design.

---

13. Partial Completion

"partial" means:

«Durable write progress exists, but the delegated filesystem objective is not fully covered.»

It does not require a failed write.

For example:

owned:
  foo.ts
  bar.ts

successful:
  foo.ts

fatalWriteFailures:
  []

The worker has made real progress, but:

bar.ts

is not covered.

Therefore:

status = partial

This is intentional.

The model may simply have stopped before completing all requested work.

---

14. Example: One Write Failed

Given:

owned:
  foo.ts
  bar.ts

successful:
  foo.ts

fatalWriteFailures:
  patch.apply

The result remains:

partial

not:

failed

because durable progress exists.

The failure is useful diagnostic information, but it does not erase the mutation that successfully landed.

---

15. Example: No Progress + Failed Write

Given:

owned:
  foo.ts

successful:
  []

fatalWriteFailures:
  patch.apply

There is no durable progress and a write failed.

Therefore:

status = failed

This preserves the useful part of the #567 semantics.

---

16. Example: Clean Completion

Given:

owned:
  foo.ts
  bar.ts

successful:
  foo.ts
  bar.ts

fatalWriteFailures:
  []

The objective is complete:

status = success

---

17. Empty Owned-Path Set

If:

ownedPaths.length === 0

the objective is considered complete.

Therefore:

ownedPaths = []
successfulPaths = []
fatalWriteFailures = []
→ success

and:

ownedPaths = []
successfulPaths = [foo.ts]
fatalWriteFailures = [patch.apply]
→ success

This preserves the explicit contract that an empty owned-path set imposes no filesystem coverage requirement.

---

18. No Hard Stop After the First Write

The worker must not stop after the first successful write.

This is explicitly a non-goal.

Legitimate delegated tasks can require:

write foo.ts
write bar.ts
write baz.ts

The model must remain free to continue emitting tools.

The completion algorithm therefore evaluates the entire tool loop rather than treating the first successful mutation as implicit completion.

The system is objective-aware, not first-write-aware.

---

19. "SubagentResult.status"

Update:

src/config/schema.ts:271

to include:

"partial"

The resulting status contract is:

"success" | "failed" | "rejected" | "partial"

"rejected" remains unchanged.

Nothing in the subagent path currently emits "rejected"; it belongs to the adaptation/proposal domain.

---

20. Worker Exit Codes

Process-level exit codes remain binary.

Required mapping:

Status| Exit code
"success"| 0
"failed"| 1
"rejected"| 1
"partial"| 1

"partial" is therefore not a clean process-level success.

This distinction is intentional:

- "SubagentResult.status" communicates semantic completion;
- the worker exit code communicates that the delegated operation did not fully satisfy its contract.

The parent manager must therefore rely on the parsed result status rather than assuming:

exit 1 === failed

---

21. "SubagentManager"

Update:

src/agents/subagent-manager.ts:127

to include:

partial

in the parsed-status whitelist.

The manager must preserve the child-reported status.

It must not collapse:

partial

into:

failed

because the child process exited with code 1.

Both variants must be accepted:

child status = partial
exit = 1

and, for compatibility/defensive parsing:

child status = partial
exit = 0

The latter is not the intended worker behavior, but the manager should preserve the explicit child status rather than deriving semantics from the exit code.

---

22. "delegate-tool" Mapping

The delegate layer must preserve the binary "ToolResult" contract.

Do not add:

kind: "partial"

The existing contract remains:

ToolResult.kind =
  success | error

This avoids the approximately ten downstream "kind"-narrowing changes across:

- executor;
- route execution;
- event handlers;
- continuation manager;
- related result consumers.

---

23. Partial → Tool Success

A child-reported:

status = partial

must map to:

ToolResult.kind = "success"

with explicit partial details in the output.

This is critical.

A partial delegated result is not a retryable tool error.

If it were mapped to:

kind: "error"

the parent model could interpret the result as:

«"The delegated mutation failed; retry the operation."»

That could cause already-landed mutations to be repeated and recreate the original class of bug.

The parent should instead receive:

«"The operation made durable progress, but part of the objective remains incomplete."»

---

24. Partial Delegate Output

The output should explicitly identify:

1. what changed;
2. what remains untouched;
3. write failures, if any.

For example:

[partial] delegated objective incomplete
Changed: foo.ts
Untouched: bar.ts
Write failures: patch.apply

When there were no write failures:

[partial] delegated objective incomplete
Changed: foo.ts
Untouched: bar.ts
Write failures: none

The exact presentation may follow existing delegate formatting conventions, but the output must contain the "[partial]" marker and explicit incomplete-path information.

---

25. Completed Objective With Later Write Noise

When the objective is already complete, the delegate must return:

ToolResult.kind = success

even if the worker reports:

fatalWriteFailures.length > 0

The output may include those failures as diagnostic information, but must not present the result as a retryable failure.

For the v3 case, conceptually:

success
Changed: verify-scratch.ts
Write failures: patch.apply, patch.apply

The important semantic fact is that the requested owned path was successfully covered.

---

26. Failed Delegate Mapping

The existing failed mapping remains unchanged.

When:

status = failed

the delegate continues to return:

kind: "error"

This preserves the existing failure behavior.

Thus:

failed  → ToolResult error
partial → ToolResult success
success → ToolResult success

---

27. Result Contract Validator

Update:

result-contract-validator.ts

so that "partial" is treated like "success" for finding-based validation.

This means "partial" should participate in the existing:

- expected-output checks;
- no-findings warnings;
- finding-based validation behavior.

There should otherwise be no behavioral change.

The validator must not reinterpret "partial" as a generic failure.

---

28. Formatting

Update:

src/agents/subagent-cli.ts

"formatSubagentResult" so that "partial" is rendered as findings plus an explicit:

[partial]

note.

The output should communicate that:

- durable work landed;
- the objective is incomplete;
- the untouched portion remains identifiable.

This is particularly important because the delegate layer consumes this output as the human/LLM-facing explanation of the result.

---

29. Implementation Structure

The worker changes should remain localized to:

src/agents/subagent-cli.ts

The implementation should introduce:

type WriteProgress = {
  successfulPaths: Set<string>;
  fatalWriteFailures: string[];
};

and a pure status evaluator:

computeSubagentStatus(
  progress,
  ownedPaths,
  cwd
)

The worker tool loop should:

1. execute a tool;
2. inspect the result;
3. if it is a successful write, extract affected paths;
4. canonicalize and add those paths to "successfulPaths";
5. if it is a failed write, add its tool name to "fatalWriteFailures";
6. continue the loop normally;
7. calculate final status after the loop.

There is no first-write termination rule.

---

30. Suggested Pure Helpers

To keep the logic testable and prevent tool-loop complexity from leaking into status determination, use small pure helpers.

Path extraction

Conceptually:

extractSuccessfulPaths(toolName, result): string[]

Coverage

Conceptually:

isObjectiveComplete(
  successfulPaths,
  ownedPaths,
  cwd
): boolean

Status

Conceptually:

computeSubagentStatus(
  progress,
  ownedPaths,
  cwd
): SubagentResult["status"]

The status function should not execute tools, inspect model messages, or perform filesystem writes.

It should operate only on recorded progress and the declared objective.

---

31. Important Invariants

INV-1 — Durable progress is monotonic

Once a path has been successfully credited:

successfulPaths contains path

later failed operations cannot remove that credit.

---

INV-2 — Failed writes cannot create durable progress

A failed write cannot add a path to:

successfulPaths

---

INV-3 — Completion is objective-aware

Status depends on whether the declared owned-path objective is covered.

It does not depend solely on whether a write attempt failed.

---

INV-4 — Completed objectives cannot regress

If:

objectiveComplete = true

the final status must be:

success

regardless of subsequent failed write attempts.

---

INV-5 — Partial requires durable progress

"partial" is only reachable when:

successfulPaths.size > 0

and:

objectiveComplete = false

---

INV-6 — Partial does not require a write failure

This must remain valid:

successfulPaths > 0
fatalWriteFailures = []
objectiveComplete = false
→ partial

---

INV-7 — Failed requires no durable progress

The worker may return:

failed

only when:

successfulPaths.size === 0

and:

fatalWriteFailures.length > 0

---

INV-8 — ToolResult remains binary

No third "ToolResult.kind" is introduced.

---

INV-9 — Partial is not retryable

A partial delegated result must never be exposed to the parent as a retryable tool error.

---

INV-10 — No first-write stop

Successful writes do not terminate the tool loop.

---

INV-11 — One canonical path semantic

Completion coverage must reuse:

resolvePolicyPath()

rather than introducing an independent path normalization implementation.

---

INV-12 — Only successful writes receive path credit

Attempted paths from failed tool calls cannot contribute to objective completion.

---

32. Testing

32.1 Status Matrix

Add unit tests in:

tests/agents/subagent-cli.test.ts

for the complete status matrix.

Test A — v3 regression

owned:
  verify-scratch.ts

successful:
  verify-scratch.ts

fatal:
  patch.apply
  patch.apply

expected:
  success

This is the primary regression test.

---

Test B — Complete with no failures

owned:
  foo.ts
  bar.ts

successful:
  foo.ts
  bar.ts

fatal:
  []

expected:
  success

---

Test C — Complete despite failed later writes

owned:
  foo.ts
  bar.ts

successful:
  foo.ts
  bar.ts

fatal:
  patch.apply

expected:
  success

---

Test D — Partial without failures

owned:
  foo.ts
  bar.ts

successful:
  foo.ts

fatal:
  []

expected:
  partial

This protects the rule that partial does not require a write failure.

---

Test E — Partial with write failure

owned:
  foo.ts
  bar.ts

successful:
  foo.ts

fatal:
  patch.apply

expected:
  partial

---

Test F — No progress + failed write

owned:
  foo.ts

successful:
  []

fatal:
  patch.apply

expected:
  failed

---

Test G — Clean/no progress

owned:
  foo.ts

successful:
  []

fatal:
  []

expected:
  success

This preserves the existing semantics for a worker that makes no writes and encounters no write failure.

---

Test H — Empty owned paths

owned:
  []

successful:
  []

fatal:
  []

expected:
  success

---

Test I — Empty owned paths with write failure

owned:
  []

successful:
  foo.ts

fatal:
  patch.apply

expected:
  success

This verifies that an empty explicit objective is considered complete.

---

33. Path Normalization Tests

Add tests covering relative and absolute representations.

Example:

owned:
  src/foo.ts

successful:
  /project/src/foo.ts

expected:
  complete

And:

owned:
  /project/src/foo.ts

successful:
  src/foo.ts

expected:
  complete

The tests must demonstrate that both representations canonicalize to the same path.

---

34. Directory Coverage Tests

Test:

owned:
  src/

successful:
  src/foo.ts

expected:
  complete

Also test that unrelated prefixes do not count:

owned:
  src/foo.ts

successful:
  src/foo.ts.bak

expected:
  incomplete

And:

owned:
  src/foo.ts

successful:
  src/bar.ts

expected:
  incomplete

---

35. Path Extraction Tests

Add tests for every supported write tool.

"patch.apply"

ToolResult.changedFiles

must produce successful path credits.

"file.create"

Prefer:

createdPath

and fallback to:

changedFiles

when "createdPath" is absent.

"file.delete"

Prefer:

deletedPath

and fallback to:

changedFiles

when "deletedPath" is absent.

Successful write with no path

A successful write that provides no recognized path must contribute:

[]

It must not receive speculative credit.

---

36. Delegate Tests

Add tests in:

tests/agents/delegate-tool.test.ts

Partial mapping

Child result:

status = partial

must produce:

kind: "success"

and output containing:

[partial]

The output must identify the untouched path.

---

Failed mapping

Child result:

status = failed

must continue to produce:

kind: "error"

No change to existing failed semantics.

---

37. Manager Tests

Add tests in:

tests/agents/subagent-manager.test.ts

Verify that:

partial + exit 1

is preserved as:

partial

rather than converted to:

failed

Also verify defensive handling of:

partial + exit 0

where the explicit child-reported status is still preserved.

---

38. Integration Verification

After unit tests pass, perform the existing v3 worker invocation manually on the desktop with the keyring unlocked.

The expected behavior is:

requested:
  verify-scratch.ts

successful:
  verify-scratch.ts

later failed patches:
  yes

final:
  status = success
  exit = 0

This confirms that the real model/tool interaction reproduces the regression scenario and that objective-aware completion fixes it.

---

39. Synthetic Partial Integration Test

Run a synthetic two-path delegated task:

owned:
  foo.ts
  bar.ts

Have the worker successfully modify:

foo.ts

while:

bar.ts

remains untouched.

Expected result:

status = partial
exit = 1

The delegate layer must expose:

kind = success

with explicit partial details.

This verifies the entire contract:

worker
  ↓
partial SubagentResult
  ↓
manager preserves partial
  ↓
delegate maps partial → ToolResult success
  ↓
parent sees durable progress + remaining work

---

40. Files to Change

File| Change
"src/config/schema.ts:271"| Add ""partial"" to "SubagentResult.status"
"src/policy/policy-gate.ts:71"| Export "resolvePolicyPath"
"src/agents/subagent-cli.ts"| Add "WriteProgress"; collect successful paths; compute objective-aware status; thread progress through result construction; partial exit code; partial formatting
"src/agents/subagent-manager.ts:127"| Add ""partial"" to parsed-status whitelist
"src/agents/delegate-tool.ts:46"| Map "partial" → "kind: "success"" with explicit partial details
"result-contract-validator.ts"| Treat "partial" like "success" for finding-based validation
"tests/agents/subagent-cli.test.ts"| Status matrix, normalization, coverage, path extraction
"tests/agents/subagent-manager.test.ts"| Preserve child-reported "partial"
"tests/agents/delegate-tool.test.ts"| Partial → success-with-warning

No other executor/event/continuation changes should be introduced.

---

41. Non-Goals

This change explicitly does not include:

- introducing a third "ToolResult.kind";
- changing the binary "success | error" tool-result protocol;
- stopping the worker after the first successful write;
- adding an LLM judge;
- relying on a "done" tool for objective determination;
- changing retry semantics;
- changing the meaning of "retryable";
- adding runtime retries;
- changing "rejected";
- changing policy approval semantics;
- introducing a second path canonicalization mechanism;
- changing legitimate multi-file worker behavior.

---

42. Architectural Rationale

The fundamental distinction is:

write failure
    ≠
objective failure

A write failure is an event associated with one tool invocation.

Objective completion is a property of the aggregate durable state produced by the worker.

Therefore the worker needs two independent dimensions:

                    ┌─────────────────────┐
                    │   Worker execution   │
                    └──────────┬──────────┘
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
                 ▼                           ▼
       Durable write progress       Write failure observations
       successfulPaths              fatalWriteFailures
                 │                           │
                 └─────────────┬─────────────┘
                               │
                               ▼
                     Objective evaluation
                               │
                 ┌─────────────┴─────────────┐
                 │                           │
             complete                    incomplete
                 │                           │
                 ▼                           ▼
              success                     partial

"failed" is reserved for the distinct case where there is no durable progress and a write actually failed.

This model reflects what the system can deterministically know.

---

43. Final Status Contract

The complete semantic contract is:

success
  = no blocking write failure with no-progress,
    OR objective is complete.

failed
  = no durable write progress
    AND at least one fatal write failure.

partial
  = durable write progress exists
    AND the owned-path objective remains incomplete.

rejected
  = unchanged; outside this subagent execution path.

More formally:

successfulPaths = ∅
    + fatal failures
        → failed

successfulPaths = ∅
    + no fatal failures
        → success

successfulPaths ≠ ∅
    + objective complete
        → success

successfulPaths ≠ ∅
    + objective incomplete
        → partial

The number of subsequent failed write attempts does not change these rules once durable progress exists.

---

44. Final Invariant

The most important regression invariant is:

«Once the delegated filesystem objective is covered by successful mutations, later unsuccessful model-generated writes cannot demote the subagent result from "success" to "failed".»

For the original v3 failure:

patch target=42
        ↓
successful mutation
        ↓
verify-scratch.ts covered
        ↓
objective complete
        ↓
model emits two bad patches
        ↓
write failures recorded for diagnostics
        ↓
FINAL = success

For an incomplete multi-file task:

foo.ts successfully changed
        ↓
bar.ts remains uncovered
        ↓
FINAL = partial

For a completely unsuccessful write task:

no durable mutation
        ↓
patch fails
        ↓
FINAL = failed

This preserves the useful failure signal from #567 while eliminating its false-negative behavior.

---

45. Implementation Verdict

READY TO IMPLEMENT.

The implementation should remain narrowly scoped to the identified files.

The architectural rule to preserve throughout implementation is:

«Write failures are observations; owned-path coverage determines delegated objective completion.»

That rule should be reflected directly in the tests so that future simplification cannot regress the implementation back to:

fatalWriteFailures.length > 0
  ? "failed"
  : "success";

The new model is intentionally monotonic with respect to durable progress:

no progress + failure → failed
progress + incomplete objective → partial
progress + complete objective → success

and, critically:

complete objective + later write noise → success

This is the required correction for #567/#568.