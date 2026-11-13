# Runtime Self-Extension

## Overview
Provides in-process registration and model-facing tools for adding skills and hooks at runtime. Extensions live only in a module-level registry during the current process; this package does not persist them to disk.

## Interface
- `InProcessExtension`, `registerInProcess()`, `unregisterInProcess()`, `listInProcess()`, and `getInProcess()` — the process-local extension registry keyed by `type::name` `[registry.ts:InProcessExtension]` `[registry.ts:registerInProcess]` `[registry.ts:getInProcess]`.
- `createSkillTool()` — the `skill.create` tool, which validates a lowercase hyphenated name and registers a version `1.0.0` skill manifest `[create-skill.ts:createSkillTool]`.
- `createHookTool(runner)` — the `hook.create` tool, which compiles the supplied body and registers it on a `HookRunner` trigger `[create-hook.ts:createHookTool]`.
- `parseTrigger()` / `buildHook()` — natural-language trigger mapping and hook-function construction `[generate-hook.ts:parseTrigger]` `[generate-hook.ts:buildHook]`.
- `inspectExtensionTool()` — returns one in-process extension's manifest and registration metadata `[inspect-extension.ts:inspectExtensionTool]`.
- `listExtensionsTool()` — groups loaded extensions into skills, hooks, MCP servers, recipes, and subagents `[list-extensions.ts:listExtensionsTool]`.

## Invariants
- Registry keys are exactly `${type}::${name}`, and registering an existing key throws `Extension already exists` `[registry.ts:key]` `[registry.ts:registerInProcess]`.
- Skill names must be non-empty and match `^[a-z0-9-]+$`; description, trigger, and body are required `[create-skill.ts:createSkillTool]`.
- A hook body that is empty after trimming is rejected `[create-hook.ts:createHookTool]`.
- `parseTrigger()` performs lowercase substring matching in declaration order and defaults to `on_pre_tool` when no phrase matches `[generate-hook.ts:parseTrigger]`.
- `_clearInProcessForTesting()` is the only bulk-clear operation `[registry.ts:_clearInProcessForTesting]`.
- Registered state is process-local and ephemeral; no persistence path is defined here `[registry.ts:store]`.

## Side Effects
- Mutates the module-level extension registry on registration, unregistration, and test clearing `[registry.ts:store]`.
- Registers hook functions into a shared `HookRunner` `[create-hook.ts:createHookTool]`.
- Executes generated hook code through the JavaScript `Function` constructor with `data` and `console`; this is arbitrary in-process code execution, not a sandbox `[create-hook.ts:createHookTool]` `[generate-hook.ts:buildHook]`.
- Writes `[hook] Error:` diagnostics to the console when a generated hook throws `[generate-hook.ts:buildHook]`.

## Verification
- Run: `pnpm test`
