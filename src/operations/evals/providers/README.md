# Eval Scripted Providers

## Overview
Deterministic `ModelAdapter` used by the behavioral eval suite so cases can drive real
mutations (`file.create`, `patch.apply`, `file.delete`, `shell.run`) without an LLM,
network, or cost. The provider replays a fixed `ScriptedScenario` one step per
`complete()` call, and a module-level carrier bridges the provider registry (which
constructs providers with no scenario) to the runner, including across subagent
subprocesses via `ALIX_EVAL_SCENARIO`.

## Interface
- `ScriptedMockProvider` — `ModelAdapter` replaying scripted steps; `id = "scripted-mock"` [scripted-mock-provider.ts:ScriptedMockProvider]
- `ScriptedModelStep` — `text` | `tool` (`file.create` | `file.delete` | `patch.apply` | `shell.run`) | `error` [scripted-mock-provider.ts:ScriptedModelStep]
- `ScriptedScenario` / `ScriptedMockProviderConfig` — scenario shape and dual explicit/registry construction [scripted-mock-provider.ts:ScriptedScenario]
- `complete`, `stream`, `negotiate`, `reset` — replay, chunked streaming, capability negotiation, cursor reset [scripted-mock-provider.ts:ScriptedMockProvider]
- `TOOL_NAMES` — fixture labels translated to exact wire names `alix_file_create`, `alix_file_delete`, `alix_patch_apply`, `alix_shell_run` [scripted-mock-provider.ts:TOOL_NAMES]
- `scriptedMockCarrier` / `ScriptedCarrier` — process-global `{ current, calls }` step carrier [scripted-mock-carrier.ts:scriptedMockCarrier]
- `setScriptedScenario`, `clearScriptedScenario`, `advanceScriptedStep` — set/clear the active scenario and consume the next unconsumed step [scripted-mock-carrier.ts:setScriptedScenario]
- `withScriptedScenario` — `AsyncLocalStorage` scope isolating a script to one async worker invocation [scripted-mock-carrier.ts:withScriptedScenario]
- `scriptedScenarioFromEnv`, `traceScriptedEval` — env-hydrated scenario reader and opt-in diagnostics writer [scripted-mock-carrier.ts:scriptedScenarioFromEnv]

## Invariants
- Exactly one step is consumed per `complete()`; steps are replayed in declaration order [scripted-mock-provider.ts:ScriptedMockProvider]
- An exhausted or absent scenario yields `{ text: "Done.", toolCalls: [] }` rather than throwing [scripted-mock-provider.ts:ScriptedMockProvider]
- `error` steps throw the scripted message [scripted-mock-provider.ts:ScriptedMockProvider]
- An invocation-scoped scenario takes precedence over the global carrier; the invocation cursor never mutates carrier state [scripted-mock-carrier.ts:advanceScriptedStep]
- Scenario hydration from `ALIX_EVAL_SCENARIO` happens at most once and only when no scenario is already set [scripted-mock-carrier.ts:hydrateFromEnv]
- Malformed or non-object env scenarios are ignored, including the no-steps array shape [scripted-mock-carrier.ts:hydrateFromEnv]
- Explicit-mode providers keep a private cursor; `reset()` restores it [scripted-mock-provider.ts:ScriptedMockProvider]
- Capabilities are fixed and copied per instance: 32k input, 4k output, tools/streaming/structured output on, vision off, no parallel tool calls [scripted-mock-provider.ts:DEFAULT_CAPABILITIES]
- Diagnostics never record prompts, tool arguments, or scenario contents, and never change execution or approval outcomes [scripted-mock-carrier.ts:traceScriptedEval]

## Side Effects
- Appends JSONL diagnostic lines to `process.env.ALIX_EVAL_TRACE_FILE` when `ALIX_EVAL_TRACE === "1"`, swallowing write errors [scripted-mock-carrier.ts:traceScriptedEval]
- Writes per-step diagnostics to `process.stderr` when tracing is enabled [scripted-mock-carrier.ts:advanceScriptedStep]
- Reads and hydrates `process.env.ALIX_EVAL_SCENARIO` [scripted-mock-carrier.ts:hydrateFromEnv]
- Mutates module-level `scriptedMockCarrier` state (`current`, `calls`, `hydratedFromEnv`) [scripted-mock-carrier.ts:scriptedMockCarrier]
- Generates tool-call ids from `Date.now()` and `Math.random()` [scripted-mock-provider.ts:ScriptedMockProvider]

## Verification
- Run: `pnpm test`
