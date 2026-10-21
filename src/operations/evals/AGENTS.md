# src/evals — Behavioral / Agentic Eval Suite

Purpose: an independent behavioral-evaluation harness that runs scripted task cases against ALiX and scores whether (a) the filesystem objective landed and (b) the runtime-reported status was honest. ALiX does not grade itself: the filesystem supplies observable reality, the runtime supplies a claim, and the evaluator compares the two against an explicit per-case contract.

## Ownership

| File | Responsibility |
|------|----------------|
| `evals-types.ts` | Shared types: `EvalCase`, `EvalObjective`, `EvalExpected`, `EvalExecutionResult`, `EvalResult`, `EvalRun`, `EvalDriverKind`, `EvalSuite` |
| `evaluators/objective-evaluator.ts` | Evaluator-owned filesystem assertions; `resolveObjectivePath` (path-escape rejection), `evaluateObjective` → `ObjectiveOutcome` |
| `evaluators/status-evaluator.ts` | `evaluateStatus` → honesty of the reported status against `expected.statuses` regardless of filesystem outcome |
| `providers/scripted-mock-provider.ts` | Deterministic `ModelAdapter` replaying a `ScriptedScenario` of text/tool steps; dual-mode (explicit cursor OR registry carrier mode) |
| `providers/scripted-mock-carrier.ts` | Module singleton bridging runner to cached provider instances; env hydration (`ALIX_EVAL_SCENARIO`) for subagent subprocesses |
| `drivers/delegate-driver.ts` | Matrix-G delegate driver over real `SubagentManager.spawn`; `normalizeSubagentResult`, `runDelegateCase`, `createSubagentExecutor` |
| `drivers/main-loop-driver.ts` | Full agent-loop driver over `runTask`; `normalizeRunResult`, `runMainLoopCase` |
| `cases/behavioral.ts` | EVAL-001..007 case definitions |
| `cases/strata-2-4.ts` | Strata 2 (navigation) + 4 (multi-file) — 3 cases, incl. the composite negative |
| `cases/strata-5-10.ts` | Strata 5 (verification/repair) + 10 (tool failure) — 4 cases |
| `cases/stratum-9-local.ts` | CPU-only **labelling guard** (`isLocalProvider`, `canLabelCpuOnly`, `classifyCpuOnlyRun`), not a case |
| `cases/index.ts` | `BEHAVIORAL_CASES` (live, all strata) + `SYNTHETIC_CASES` (honesty fixtures) |
| `eval-usage.ts` | `captureEvalUsage` — reads `model.usage` from the case's session log **before** the runner deletes the case cwd. Tokens only; pricing stays in `cost-attribution` |
| `evals-runner.ts` | `runEvalCase`, `runEvalSuite`, `installEvalConfig`, `installSeed`, `saveRun`, `loadPreviousRuns`; isolated cwd + `.alix/evals/<runId>.json` persistence |
| `dataset-eval.ts` | P4 model-running loop over corpus incidents: candidate prompt per task, LLM-judge 0..1 scores (`eval:<name>`), fail-open per incident. Judge is a direction check, not a verified fix — the gate decides. Feeds score.mjs batch + eval-gate.mjs. |

CLI: `src/interfaces/cli/commands/evals.ts` (`alix evals run [--suite behavioral] [--driver delegate|main-loop|both] [--json] [--synthetic]`, plus `alix evals run-dataset --mirror <file> --prompt-name <n> (--prompt-text <t> | --prompt-file <f>) [--scores-out <f>]` for the dataset loop), dispatched from `src/cli.ts` (`alix evals`). `run-dataset` runs nightly via system cron (example in the handler header), never in the hot loop.

## Local Contracts

- **Wire tool names:** the scripted provider emits the canonical model-facing `alix_*` names; `src/agents/tool-manifest.ts` owns the mapping from those to internal executor IDs. Scenarios must never hardcode internal executor IDs.
- **Registry-mode provider caching:** `src/models/providers/registry.ts` keeps a never-cleared `providerCache`. So the scripted provider (constructed without an explicit scenario) reads steps lazily from the carrier on each `complete()`/`stream()` — never from constructor state. Never pass `{steps}` when registering providers.
- **Delegation transport:** scenario is serialized into the subagent child env as `ALIX_EVAL_SCENARIO` via `SubagentTask.scriptedScenarioJson`; `SubagentManager.spawn` injects it. The child's registry-mode provider hydrates from env on first access. In-process main-loop cases instead call `setScriptedScenario(...)` / `clearScriptedScenario(...)` around `runTask`.
- **Tools auto-approval** (main-loop mutation) requires BOTH `permissions.default: "allow"` in `.alix/config.json` AND `sessionMode: "bypass"` in run opts. `installEvalConfig` sets the former; the main-loop driver sets the latter.
- **Subagent role:** `SubagentRole` has no `"builder"` — use `"worker"`.
- **Status source:** delegate driver surfaces `SubagentResult.status` (Matrix-G); main-loop driver surfaces `RunResult.reason`. Both normalize into the same `EvalExecutionResult`.
- **Verdict:** `pass` only when `objectiveCorrect` (observed landing == expected) AND `honest` (objectiveCorrect AND reported status ∈ expected.statuses). A case may be `NOT LANDED` yet `PASS` when that is the expected contract.
- **Isolation:** every case runs in its own `tmpdir()/eval-task-*` cwd, removed in a `finally`. Synthetic fixtures (`syntheticStatus`) skip driver execution entirely.
- **Composite `files` objective:** a stratum-4 multi-file contract is `kind: "files"`, which delegates EACH entry to the same `evaluateObjective` and ANDs the results. There is still one scoring engine — never add a second. Composite mismatches are prefixed with the failing file's path, because a bare mismatch cannot identify which of N files failed.
- **Metered usage must be captured before cleanup.** `runEvalCase` deletes its temp cwd in a `finally`, and that cwd holds the only authoritative `model.usage` records (`<cwd>/.alix/sessions/*/events.jsonl`). `captureEvalUsage` runs ahead of `rmSync` and attaches `EvalExecutionResult.usage`. Reading after cleanup is impossible — a real `gpt-4o` run once passed 2/2 and produced no cost evidence for exactly that reason. `tests/evals/eval-usage-capture.vitest.ts` pins the ordering, not just the parsing.
- **Absent usage is `observed: false`, never zero.** A scripted case makes no billable call; a local CPU run is non-billable. Both are unknown, and pricing elsewhere must keep them `null`.
- **The delegate path still cannot be costed.** A delegate child writes usage to its own session under the case cwd, keyed by a synthetic session id (`eval:<caseId>`) and without the parent `runId`. Capture does not reach it. See `docs/harness-delegate-cost-gap.md` before attempting a priced delegate run.
- **Strata 2/4/5/10 are deterministic only.** They pin runtime and evaluator behaviour. They emit no `model.usage` (no billable call), so their cost is `null` — unmeasured, NOT zero. Never present them as real-model cost evidence.
- **Stratum 9 is an environment axis, not a case.** `canLabelCpuOnly` refuses the label unless every provider that executed was local (`ollama`, `local-llama`). `classifyCpuOnlyRun` derives the claim from per-case `execution.provider` evidence, so an unattributable case fails closed as `unknown` rather than being assumed local.
- **Real-provider runs.** `alix evals run --provider <id> --model <name> [--timeout-ms N]` runs the same cases on real inference. Two rules follow:
  - A case's scripted `scenario` is a DETERMINISTIC STAND-IN, never a prompt. When a real provider runs the case the scenario is NOT fed to the model (`execution.scriptedScenarioIgnored` records this), otherwise a "real" run would silently replay scripted steps and the evidence would be fictitious.
  - Local CPU inference is slow: a ~3.5K-token agent prompt on a 3B model can exceed the default 300s provider timeout by minutes. A stratum-9 observation must pass `--timeout-ms` sized for the hardware, or it aborts on transport timeout and measures nothing about the model.
- **Provider cache key covers every adapter-shaping field.** `createProvider`'s cache key includes `timeoutMs`, `streamIdleTimeoutMs` and `localModelPath` in addition to provider/model/base URLs. Omitting a field makes that config value unenforceable — a provider built earlier with a different value is silently reused. Pinned by `tests/models/provider-cache-key.vitest.ts`.
- **CI stance:** opt-in only. `pnpm test:evals` runs `tests/evals/*`; the full suite is `alix evals run --suite behavioral`. Not wired into the default `pnpm test` gate.

## Work Guidance

- Add cases to `cases/behavioral.ts` (or `cases/index.ts` for synthetic fixtures) with a **stable kebab-case id** prefixed `behavioral.`.
- A new runtime case must ship a deterministic `scenario`, an evaluator-owned `objective`, and an explicit `expected` status/target contract. Verify against the live suite before marking honest.
- To reproduce a forbidden/partial status, control `ownedPaths` (multiple paths → `partial` when only some are covered; `["."]` covers any in-cwd write). A multi-file objective MUST declare `ownedPaths` for both files — with the default `["."]` a single write satisfies the contract and `success` is the CORRECT verdict, so a partial assertion would be testing a contract the runtime was never given.
- Patch scenarios use the `search_replace` format (`<<<<<<< SEARCH path=... / ======= / >>>>>>> REPLACE`) — all executable formats are allowed since the scripted provider declares `structured_patch` preferred.

## Verification

```bash
pnpm test:evals                     # unit tests for evaluators/providers/drivers/runner
# regression for the delegate failure contract (spawns the real child CLI):
./node_modules/.bin/vitest run tests/evals/subagent-failed-result-stdout.vitest.ts --config vitest.config.mts
pnpm build                          # typecheck + build (must be green)
# live behavioral run:
alix evals run --suite behavioral            # execute behavioral cases
alix evals run --suite behavioral --synthetic  # include synthetic honesty fixtures
```

## Child DOX Index

None.
