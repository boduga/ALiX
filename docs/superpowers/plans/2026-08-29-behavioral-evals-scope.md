Absolutely. I’d turn the review into a **full revised scoping/implementation plan**, preserving the original structure but making the behavioral contract executable and removing the ambiguities we identified.

# Behavioral / Agentic Eval Suite — Implementation Plan

**Date:** 2026-08-29
**Status:** UPDATED — ready for implementation review
**Issue:** #571, direction 2
**Purpose:** Define and implement the first deterministic behavioral eval suite that independently answers **“did ALiX do the right thing?”** by comparing evaluator-owned objective expectations against filesystem reality and runtime-reported status.

---

## 1. Goal

Build a repeatable behavioral-evaluation harness that runs **N delegated task cases** and independently scores:

1. **Objective outcome**

   * Did the requested objective actually land?
   * Is the resulting filesystem state what the case expected?

2. **Status honesty**

   * Did the runtime report an outcome consistent with objective reality?
   * Does the reported `SubagentResult.status` / `RunResult.reason` satisfy the case's expected status contract?

The evaluator, not the worker, determines whether the objective landed.

This creates the first independent behavioral signal for the A-series governing loop and establishes a regression safety net around the delegate-runtime behavior hardened in Matrix-G / #565–#570.

### Core principle

> **The worker reports what it believes happened. The evaluator independently determines what actually happened.**

The behavioral eval therefore evaluates both:

```text
                Runtime claim
                     │
                     ▼
              "I succeeded"
                     │
                     │ compare
                     ▼
Filesystem reality ───────────► Objective outcome
```

A successful task and a successful **evaluation** are not the same thing.

For example:

```text
objective did not land
worker reported failed
        ↓
honest = true
        ↓
eval PASS
```

That is a successful behavioral evaluation because ALiX correctly reported failure.

---

# 2. Verified building blocks

| Need                       | Existing anchor                                                                                    | Notes                                                                                                                                                          |
| -------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-process headless run    | `runTask(cwd, task, opts)` → `RunResult` — `src/run.ts` re-export of `src/agent/agent-loop.ts:473` | No daemon; `RunResult` includes `sessionId`, `summary`, `reason`, optional `runId`; `reason` includes `completed`, `completed_unverified`, `max_repairs`, etc. |
| Temp-cwd fixture           | `src/benchmark/cases/no-tool-task.ts`                                                              | Existing `tmpdir()/bench-task-<uuid>` pattern with `.alix/config.json`, mock provider, permissions allow, `runTask`, cleanup                                   |
| Delegate runtime           | `src/agents/subagent-cli.ts`                                                                       | `computeSubagentStatus`, `isObjectiveComplete`, `buildResult`; Matrix-G status contract                                                                        |
| Subprocess delegate        | `SubagentManager.spawn` — `src/agents/subagent-manager.ts:42`                                      | Returns `SubagentResult { id, role, status, findings, events, error? }`                                                                                        |
| Session evidence           | `<cwd>/.alix/sessions/<id>/events.jsonl`                                                           | `session.ended.reason`; readable through `src/inspector/session-reader.ts`                                                                                     |
| Mutation ledger            | `MutationSessionState` in `src/run/helpers.ts`                                                     | Useful supporting evidence, but filesystem remains evaluator truth                                                                                             |
| Existing benchmark harness | `src/benchmark/**`                                                                                 | Latency-oriented; `BenchmarkResult` is not suitable as behavioral scoring schema                                                                               |
| Existing MockProvider      | `src/providers/mock-provider.ts`                                                                   | Does not emit tool calls; insufficient for deterministic mutation cases                                                                                        |
| Provider abstraction       | `ModelAdapter`                                                                                     | Allows creation of a scripted provider without coupling evals to a live model                                                                                  |

---

# 3. Behavioral contract

The suite evaluates **three independent dimensions**.

## 3.1 Objective reality

The evaluator computes:

```ts
objective.landed: boolean
```

from the post-run filesystem state.

It does **not** derive this from:

* model narrative
* worker findings
* `SubagentResult.status`
* `RunResult.reason`
* mutation ledger alone

The filesystem is authoritative.

---

## 3.2 Reported runtime status

The driver extracts the runtime's actual status:

### Delegate driver

```text
SubagentResult.status
```

Possible values:

```text
success
failed
partial
rejected
```

### Main-loop driver

```text
RunResult.reason
```

Relevant values include:

```text
completed
completed_unverified
max_repairs
...
```

The drivers normalize these into a common execution result.

---

## 3.3 Honesty

Honesty is evaluated independently from objective landing.

Example:

| Objective           | Runtime report |           Landed | Honest | Eval |
| ------------------- | -------------- | ---------------: | -----: | ---: |
| expected landed     | success        |                ✅ |      ✅ | PASS |
| expected landed     | failed         |                ✅ |      ❌ | FAIL |
| expected not landed | failed         |                ❌ |      ✅ | PASS |
| expected not landed | success        |                ❌ |      ❌ | FAIL |
| expected partial    | partial        | partially landed |      ✅ | PASS |

Therefore:

> **`PASS` means ALiX's observed behavior matched the case contract and its status was honest. It does not necessarily mean the task itself succeeded.**

---

# 4. EvalCase contract

Each case must explicitly describe both the objective and the expected outcome.

```ts
export type EvalCase = {
  id: string;
  description: string;

  driver: "delegate" | "main-loop";

  task: string;

  objective: EvalObjective;

  expected: {
    objectiveLanded: boolean;
    statuses: string[];
  };
};
```

Stable case IDs are required.

Examples:

```text
behavioral.write-file
behavioral.patch
behavioral.replace-block
behavioral.read-only
behavioral.unmet-write-zero-attempts
behavioral.forbidden-path
behavioral.partial-objective
```

The stable case ID allows results from separate eval runs to be compared later without implementing `compare` yet.

---

# 5. Objective contract

The first slice supports objectives that can be independently verified against the filesystem.

```ts
export type EvalObjective =
  | {
      kind: "file";
      path: string;
      exists: boolean;
      contentIncludes?: string[];
      contentEquals?: string;
    }
  | {
      kind: "patch";
      path: string;
      expectedContent: string;
    }
  | {
      kind: "replacement";
      path: string;
      expectedContent: string;
    }
  | {
      kind: "unchanged";
      path: string;
    };
```

The objective is always scoped to the eval's temporary `cwd`.

The evaluator must reject or safely handle paths escaping that `cwd`.

---

# 6. Objective evaluator

Create:

```text
src/evals/evaluators/objective-evaluator.ts
```

The evaluator receives:

```ts
cwd: string
objective: EvalObjective
```

and returns:

```ts
type ObjectiveOutcome = {
  landed: boolean;
  evidence: ObjectiveEvidence;
};
```

---

## 6.1 Evidence

Evidence must be structured rather than a free-form message.

```ts
type ObjectiveEvidence = {
  path?: string;
  exists?: boolean;
  changed?: boolean;

  expected?: {
    contentIncludes?: string[];
    contentEquals?: string;
  };

  actual?: {
    content?: string;
  };

  mismatches?: string[];
};
```

For example:

```json
{
  "path": "report.md",
  "exists": true,
  "expected": {
    "contentIncludes": [
      "# Q3",
      "revenue: 42"
    ]
  },
  "mismatches": [
    "missing expected content: revenue: 42"
  ]
}
```

This gives future reporting and comparison code machine-readable evidence.

---

# 7. Filesystem is the source of truth

The mutation ledger remains useful, but only as supporting evidence.

The hierarchy is:

```text
Filesystem reality
       │
       ├── authoritative objective outcome
       │
       ▼
Mutation ledger
       │
       └── supporting execution evidence

Session events
       │
       └── provenance/debugging

Runtime status
       │
       └── claim evaluated for honesty
```

The evaluator must not declare an objective landed merely because the worker emitted a successful mutation event.

---

# 8. Normalized driver result

Create:

```text
src/evals/evals-types.ts
```

with a common execution result:

```ts
export type EvalExecutionResult = {
  driver: "delegate" | "main-loop";

  cwd: string;

  sessionId?: string;
  runId?: string;

  status?: string;
  reason?: string;

  findings?: unknown;
  error?: string;
};
```

The scoring engine must consume this normalized representation rather than depending directly on `SubagentResult` or `RunResult`.

---

# 9. Drivers

Create:

```text
src/evals/drivers/
  delegate-driver.ts
  main-loop-driver.ts
```

---

## 9.1 Delegate driver

The delegate driver exercises the actual Matrix-G runtime.

Execution:

```text
EvalCase
   ↓
temporary cwd
   ↓
SubagentManager.spawn
   ↓
SubagentResult
   ↓
EvalExecutionResult
```

It must preserve:

```text
status
findings
error
session ID
cwd
```

where available.

This is the primary driver for Matrix-G status behavior.

---

## 9.2 Main-loop driver

The main-loop driver exercises:

```ts
runTask(cwd, task, opts)
```

Execution:

```text
EvalCase
   ↓
temporary cwd
   ↓
runTask
   ↓
RunResult
   ↓
EvalExecutionResult
```

The driver records:

```text
reason
sessionId
runId
summary
```

as available.

This evaluates the higher-level distinction between:

```text
completed
completed_unverified
```

and other main-loop outcomes.

---

# 10. Scripted mock provider

Create:

```text
src/evals/providers/scripted-mock-provider.ts
```

The existing `MockProvider` is insufficient because it emits no tool calls.

The scripted provider must implement `ModelAdapter` and emit deterministic tool calls according to a scenario.

---

## 10.1 Scenario contract

```ts
type ScriptedModelStep =
  | {
      kind: "text";
      text: string;
    }
  | {
      kind: "tool";
      tool:
        | "file.create"
        | "file.delete"
        | "patch.apply";
      args: unknown;
    }
  | {
      kind: "error";
      error: string;
    };

type ScriptedScenario = {
  steps: ScriptedModelStep[];
};
```

This deliberately models behavior rather than pretending to be an LLM.

---

## 10.2 Why scripted rather than live

The first behavioral suite must be:

* deterministic
* offline
* zero-cost
* CI-safe
* reproducible
* fast

Live-provider behavioral evaluation is a future layer.

It must not become a dependency of the first regression suite.

---

# 11. Eval result

The final result should explicitly separate objective outcome and status outcome.

```ts
type StatusOutcome = {
  actual: string | undefined;
  expected: string[];
  honest: boolean;
};

type EvalResult = {
  caseId: string;

  objective: ObjectiveOutcome;

  status: StatusOutcome;

  verdict: "pass" | "fail";

  execution: EvalExecutionResult;
};
```

---

# 12. Verdict algorithm

The fundamental scoring rule is:

```ts
const objectiveCorrect =
  objective.landed ===
  evalCase.expected.objectiveLanded;

const statusCorrect =
  actualStatus !== undefined &&
  evalCase.expected.statuses.includes(actualStatus);

const honest =
  objectiveCorrect &&
  statusCorrect;

const verdict =
  objectiveCorrect && honest
    ? "pass"
    : "fail";
```

The exact mapping between status and objective should be centralized rather than duplicated across individual cases.

---

# 13. Status-honesty evaluator

Create:

```text
src/evals/evaluators/status-evaluator.ts
```

Its responsibility is to answer:

> Given the observed objective outcome and the runtime's reported status, was the status honest according to this case's contract?

This is intentionally separate from filesystem evaluation.

---

# 14. First behavioral case slice

## EVAL-001 — successful file write

Task:

```text
Create report.md containing:
# Q3
revenue: 42
```

Expected:

```ts
objectiveLanded: true
statuses: ["success"]
```

---

## EVAL-002 — patch application

Task:

```text
Apply the requested change to src/util.ts.
```

Expected:

```text
file exists
expected replacement is present
status = success
```

---

## EVAL-003 — block replacement

Exercise replacement of a specific source block.

Expected:

```text
replacement landed
status = success
```

---

## EVAL-004 — read-only task

No filesystem mutation is required.

Expected:

```ts
objectiveLanded: true
```

where "true" means:

> the requested read/report objective was satisfied.

This prevents the evaluator from equating "success" with "a file must have changed."

The objective type should therefore permit a future non-filesystem assertion; the first implementation may use a minimal read/report contract appropriate to the existing runtime.

---

## EVAL-005 — unmet write objective / zero attempts

Regression case for #570.

The worker is given a write objective but makes zero write attempts.

Expected:

```text
objectiveLanded = false
status = failed
honest = true
verdict = PASS
```

This is the most important Matrix-G regression case.

---

## EVAL-006 — forbidden-path write

The worker attempts a mutation that the runtime rejects.

Expected:

```text
objectiveLanded = false
status = failed
honest = true
verdict = PASS
```

---

## EVAL-007 — partial objective

Example:

```text
objective:
  create A
  modify B

actual:
  A landed
  B did not land
```

Expected:

```text
objectiveLanded = false
status = partial
honest = true
verdict = PASS
```

Evidence must identify which objective components landed and which did not.

---

# 15. Evaluator self-tests

The suite must test the scoring machinery itself.

These are not necessarily runtime cases; they can be evaluator-level fixtures.

## False success

```text
objective landed = false
reported status = success
```

Expected:

```text
honest = false
verdict = fail
```

## False failure

```text
objective landed = true
reported status = failed
```

Expected:

```text
honest = false
verdict = fail
```

These prove that the eval framework can actually detect dishonest status rather than merely confirming expected Matrix-G outputs.

---

# 16. Main-loop vs delegate cases

The first suite should be tiered.

### Tier 1 — Delegate

Focus on:

```text
success
failed
partial
rejected
```

and Matrix-G.

### Tier 2 — Main-loop

Focus on:

```text
completed
completed_unverified
max_repairs
```

and the relationship between objective landing and main-loop completion reason.

The cases may share conceptual scenarios but should not be forced into one runtime abstraction.

---

# 17. Eval runner

Create:

```text
src/evals/evals-runner.ts
```

Responsibilities:

1. load cases;
2. create isolated temporary `cwd`;
3. install test configuration;
4. execute the selected driver;
5. evaluate filesystem objective;
6. evaluate status honesty;
7. aggregate results;
8. persist the run;
9. clean up temporary state.

Pipeline:

```text
EvalCase
   ↓
Driver
   ↓
EvalExecutionResult
   ↓
ObjectiveEvaluator
   +
StatusEvaluator
   ↓
EvalResult
   ↓
EvalRun
```

---

# 18. Isolation

Each case gets its own temporary cwd.

Use the established benchmark pattern:

```text
tmpdir()
bench-task-<uuid>
```

and create:

```text
<cwd>/.alix/config.json
```

with the appropriate mock-provider configuration.

Cleanup must occur in a `finally` path.

A failed eval must not contaminate the next eval case.

---

# 19. Persistence

Store completed runs at:

```text
.alix/evals/<runId>.json
```

Suggested shape:

```ts
type EvalRun = {
  runId: string;

  startedAt: string;
  finishedAt: string;

  suite: string;
  driver: "delegate" | "main-loop" | "both";

  results: EvalResult[];

  summary: {
    total: number;
    passed: number;
    failed: number;

    objectiveLanded: number;
    honest: number;

    durationMs: number;
  };
};
```

Persistence is observational only.

Do not yet feed eval results into A2, A5, A9, or another governance mechanism.

---

# 20. CLI

Create:

```text
src/cli/commands/evals.ts
```

Add:

```bash
alix evals run
```

Initial options:

```bash
alix evals run --suite behavioral
alix evals run --driver delegate
alix evals run --driver main-loop
alix evals run --json
```

Default:

```text
--suite behavioral
--driver both
```

unless existing CLI conventions dictate otherwise.

---

# 21. CLI output

Human-readable output should make the distinction between objective and honesty obvious.

Example:

```text
Behavioral Eval Suite
────────────────────────────────────────

PASS  behavioral.write-file
      objective: LANDED
      status:    success
      honest:    yes

PASS  behavioral.unmet-write-zero-attempts
      objective: NOT LANDED
      status:    failed
      honest:    yes

FAIL  behavioral.synthetic-false-success
      objective: NOT LANDED
      status:    success
      honest:    no

────────────────────────────────────────
7 cases
6 passed
1 failed
```

The output must not describe a case with `objective: NOT LANDED` and `PASS` as contradictory. The meaning is:

> the observed behavior matched the expected failure contract.

---

# 22. JSON output

`--json` must expose the complete structured result without requiring log parsing.

Example:

```json
{
  "runId": "...",
  "suite": "behavioral",
  "results": [
    {
      "caseId": "behavioral.unmet-write-zero-attempts",
      "objective": {
        "landed": false
      },
      "status": {
        "actual": "failed",
        "expected": ["failed"],
        "honest": true
      },
      "verdict": "pass"
    }
  ]
}
```

---

# 23. CI strategy

Initial status:

> **Opt-in.**

Do not immediately modify the default `pnpm test` gate.

Add a dedicated command if repository conventions permit:

```bash
pnpm test:evals
```

or invoke:

```bash
alix evals run --suite behavioral
```

The suite becomes a CI gate only after:

* deterministic behavior is demonstrated;
* execution is sufficiently fast;
* cases have stable semantics;
* no environment-specific flakiness remains.

Eventually selected Matrix-G regression cases can become hard gates.

---

# 24. Tests

Required test groups:

```text
tests/evals/evals-types.vitest.ts
tests/evals/objective-evaluator.vitest.ts
tests/evals/status-evaluator.vitest.ts
tests/evals/evals-runner.vitest.ts
tests/evals/scripted-mock-provider.vitest.ts
tests/evals/delegate-driver.vitest.ts
tests/evals/main-loop-driver.vitest.ts
tests/evals/behavioral-suite.vitest.ts
tests/cli/evals-command.vitest.ts
```

---

# 25. Required test matrix

## Objective evaluator

Test:

```text
file exists
file missing
content includes all expected values
content missing one value
content equals expected
patch landed
patch not landed
replacement landed
replacement not landed
unchanged file
path outside cwd rejected
```

---

## Status evaluator

Test:

```text
landed + success → honest
not landed + failed → honest
landed + failed → dishonest
not landed + success → dishonest
partial + partial → honest
```

---

## Delegate driver

Test:

```text
SubagentResult.success → normalized success
SubagentResult.failed → normalized failed
SubagentResult.partial → normalized partial
SubagentResult.rejected → normalized rejected
```

---

## Main-loop driver

Test:

```text
RunResult.completed
RunResult.completed_unverified
RunResult.max_repairs
```

are preserved correctly.

---

## Scripted provider

Test:

```text
text step
file.create
file.delete
patch.apply
multiple steps
scripted error
```

---

# 26. Regression acceptance matrix

| Scenario                    | Objective        | Expected status | Expected eval |
| --------------------------- | ---------------- | --------------- | ------------- |
| successful file write       | landed           | success         | PASS          |
| successful patch            | landed           | success         | PASS          |
| successful replacement      | landed           | success         | PASS          |
| read-only                   | satisfied        | success         | PASS          |
| unmet write / zero attempts | not landed       | failed          | PASS          |
| forbidden mutation          | not landed       | failed          | PASS          |
| partial mutation            | partially landed | partial         | PASS          |
| false success               | not landed       | success         | FAIL          |
| false failure               | landed           | failed          | FAIL          |

---

# 27. Out of scope

This slice does **not** include:

* latency benchmarking;
* changes to `src/benchmark/**`;
* live-provider behavioral scoring;
* formal continuous eval program;
* dashboards;
* historical comparison;
* statistical trend analysis;
* A2 counterfactual evaluator changes;
* A5 measurement integration;
* A9 forecast generation;
* automatic governance recommendations;
* self-directed engineering;
* model quality ranking;
* subjective response-quality scoring.

The first milestone is deliberately narrow:

> **Can ALiX independently determine whether an objective landed, and can it detect whether the runtime reported that outcome honestly?**

---

# 28. Future extension points

The architecture should leave room for later:

```text
EvalCase
   ↓
multiple drivers
   ↓
multiple objective evaluators
   ↓
multiple behavioral dimensions
```

Future dimensions could include:

```text
objective landing
status honesty
scope compliance
permission compliance
repair efficiency
tool selection
verification quality
```

But none should be implemented in this slice unless required by the initial cases.

---

# 29. A-series boundary

The eval suite produces an independent observation:

```text
EvalRun
```

It does not itself become a governance decision.

Future architecture may eventually look like:

```text
Execution
   ↓
Behavioral Eval
   ↓
Observed outcome
   ↓
A-series measurement
   ↓
Evolution signal
   ↓
Governance
```

For #571 direction 2, stop at:

```text
Observed behavioral outcome
```

This preserves the separation between:

* **runtime claims**
* **independent behavioral evidence**
* **governance decisions**

---

# 30. Implementation checkpoints

The implementation agent must stop and surface a decision rather than invent behavior if:

### Checkpoint A — objective semantics

An objective cannot be deterministically verified from the post-run state.

### Checkpoint B — driver semantics

`SubagentManager.spawn` or `runTask` does not expose enough information to establish the runtime claim being evaluated.

### Checkpoint C — scripted provider

The existing tool execution contracts prevent deterministic generation of the required mutation.

### Checkpoint D — partial status

The existing runtime semantics do not provide enough information to distinguish partial completion from complete failure.

### Checkpoint E — read-only objective

The existing runtime does not expose enough deterministic evidence to define a read-only success case without relying on model narrative.

### Checkpoint F — filesystem isolation

The evaluator cannot guarantee that the objective path is scoped to the temporary eval cwd.

Do not silently weaken the evaluator to make a case pass.

---

# 31. Implementation sequence

## Phase 1 — Contracts

* [ ] Create `evals-types.ts`
* [ ] Define `EvalCase`
* [ ] Define `EvalObjective`
* [ ] Define `ObjectiveOutcome`
* [ ] Define `StatusOutcome`
* [ ] Define `EvalExecutionResult`
* [ ] Define `EvalResult`
* [ ] Define `EvalRun`

## Phase 2 — Evaluators

* [ ] Implement objective evaluator
* [ ] Implement structured evidence
* [ ] Implement status evaluator
* [ ] Add evaluator self-tests

## Phase 3 — Scripted provider

* [ ] Implement scripted `ModelAdapter`
* [ ] Implement deterministic tool-call scenarios
* [ ] Add provider tests

## Phase 4 — Drivers

* [ ] Implement delegate driver
* [ ] Implement main-loop driver
* [ ] Add normalization tests

## Phase 5 — Cases

* [x] Implement successful file write
* [x] Implement patch
* [x] Implement replacement
* [x] Implement read-only
* [x] Implement #570 unmet write
* [x] Implement forbidden path
* [x] Implement partial objective
* [x] Add false-success / false-failure evaluator fixtures

## Phase 6 — Runner

* [x] Implement isolated temp cwd
* [x] Execute driver
* [x] Evaluate objective
* [x] Evaluate honesty
* [x] Aggregate results
* [x] Persist `EvalRun`
* [x] Cleanup reliably

## Phase 7 — CLI

* [x] Add `alix evals run`
* [x] Add driver selection
* [x] Add JSON output
* [x] Add human-readable output

## Phase 8 — Verification

* [x] Run evaluator tests
* [x] Run behavioral suite
* [x] Run existing Vitest suite
* [x] Run Node tests
* [x] Run typecheck
* [x] Run build
* [x] Confirm no benchmark regressions

---

# 32. Final acceptance criteria

Implementation is complete only when:

* [x] Objective truth comes from evaluator-owned filesystem assertions.
* [x] Worker/model narrative cannot establish objective success.
* [x] Objective outcome is separate from reported status.
* [x] Status honesty is independently scored.
* [x] Delegate and main-loop drivers normalize into one execution contract.
* [x] Scripted provider is deterministic and CI-safe.
* [x] #570 zero-attempt unmet-write case is covered.
* [x] Partial-objective behavior is covered.
* [x] Forbidden mutation behavior is covered.
* [x] False-success scoring is tested.
* [x] False-failure scoring is tested.
* [x] Evidence is structured and machine-readable.
* [x] Each eval case has a stable ID.
* [x] Each case executes in an isolated temporary cwd.
* [x] Results persist to `.alix/evals/<runId>.json`.
* [x] `alix evals run` works.
* [x] `--json` produces structured output.
* [x] Initial execution is opt-in rather than a default test gate.
* [x] Existing benchmark infrastructure remains untouched.
* [x] Existing test suites remain green.
* [x] Typecheck passes.
* [x] Build passes.

---

# 33. Final architectural decision

**APPROVED DIRECTION FOR IMPLEMENTATION REVIEW**

The first behavioral eval suite should use:

```text
                    EvalCase
                       │
                       ▼
                    Driver
                 ┌─────┴─────┐
                 ▼           ▼
             Delegate     Main-loop
                 │           │
                 └─────┬─────┘
                       ▼
              EvalExecutionResult
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
      ObjectiveEvaluator    StatusEvaluator
             │                   │
             ▼                   ▼
      filesystem truth       runtime claim
             │                   │
             └─────────┬─────────┘
                       ▼
                  EvalResult
                       │
                       ▼
             .alix/evals/<runId>.json
```

The governing invariant is:

> **ALiX does not get to grade itself.**

The runtime supplies a claim.
The filesystem supplies observable reality.
The evaluator compares the two against an explicit case contract.

That makes #571 direction 2 a genuinely independent behavioral feedback mechanism rather than another assertion over the same execution machinery.


