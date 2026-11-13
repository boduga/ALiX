# Extension Store

## Overview
Discovers, installs, and uninstalls filesystem-backed extensions described by `EXTENSION.yaml` manifests. An extension is one of five kinds — skill, hook, MCP server, recipe, or subagent — and the registry classifies each installed directory by its `type-name` prefix. `loadExtensions` groups a registry's contents into a runtime bundle, while `SkillLoader` separately loads Markdown skill bodies with `{{variable}}` substitution.

## Interface
- `ExtensionManifest` and its five variants `SkillExtension`, `HookExtension`, `McpExtension`, `RecipeExtension`, `SubagentExtension` — the manifest union `[manifest.ts:ExtensionManifest]` `[manifest.ts:SkillExtension]` `[manifest.ts:HookExtension]` `[manifest.ts:McpExtension]` `[manifest.ts:RecipeExtension]` `[manifest.ts:SubagentExtension]`.
- `parseExtensionManifest(yamlStr, type)` — YAML to manifest conversion; returns `null` when `name`/`description` are missing or the hook trigger or MCP transport is invalid `[manifest.ts:parseExtensionManifest]`.
- `getExtensionId(manifest)` — stable `type/name` identity `[manifest.ts:getExtensionId]`; `isCoreExtension(manifest)` — core-protection predicate `[manifest.ts:isCoreExtension]`.
- `EXTENSION_TYPES` and `HOOK_TRIGGERS` — closed sets `[manifest.ts:EXTENSION_TYPES]` `[manifest.ts:HOOK_TRIGGERS]`.
- `ExtensionRegistry` — install, uninstall, list, inspect, and update extensions in a store directory `[registry.ts:ExtensionRegistry]`; `LoadedExtension`, `VersionInfo`, and `ListOptions` are its data shapes `[registry.ts:LoadedExtension]` `[registry.ts:VersionInfo]` `[registry.ts:ListOptions]`.
- `loadExtensions(registry)` — groups skills by trigger/name, hooks by trigger, and MCP/recipes/subagents by name into an `ExtensionBundle` `[lifecycle.ts:loadExtensions]` `[lifecycle.ts:ExtensionBundle]`.
- `HookRunner` — ordered in-process hook dispatch with abort propagation `[hook-runner.ts:HookRunner]`; `HookEvent`, `HookResult`, and `HookFn` are its contracts `[hook-runner.ts:HookEvent]` `[hook-runner.ts:HookResult]` `[hook-runner.ts:HookFn]`.
- `HOOK_TYPES` — documented hook-name constants from `on_pre_tool` through `on_session_end` `[hook-runner.ts:HOOK_TYPES]`.
- `SkillLoader` — loads `<skillsDir>/<skillId>.md`, extracts the first `#` heading as its name, and injects context variables `[skill-loader.ts:SkillLoader]` `[skill-loader.ts:LoadedSkill]`.
- `getDefaultExtensionStore()` — default store is `~/.alix/extensions`, enabled `[index.ts:getDefaultExtensionStore]`.

## Invariants
- Manifests without both `name` and `description` are rejected, and an unknown hook trigger or MCP transport yields `null` `[manifest.ts:parseExtensionManifest]`.
- Extension identity is always `${type}/${name}` `[manifest.ts:getExtensionId]`.
- Store directories are classified by the prefix before the first `-`; anything unrecognized defaults to `skill` `[registry.ts:inferType]`.
- Registry load skips non-directories, directories without `EXTENSION.yaml`, unparseable manifests, and any entry that throws `[registry.ts:load]`.
- Core extensions cannot be uninstalled or version-updated `[registry.ts:uninstall]` `[registry.ts:updateVersion]`.
- A failed install copy removes the partially copied target directory and returns `null` `[registry.ts:install]`.
- `loadExtensions` pre-seeds the hook map with every `HOOK_TRIGGERS` key so absent triggers still resolve to an empty list `[lifecycle.ts:loadExtensions]`.
- Hook execution stops after the first handler that returns `abort: true`; a throwing handler is reported and skipped rather than aborting the run `[hook-runner.ts:execute]`.
- Skill variable extraction defaults to `/\{\{(\w+)\}\}/g` and ignores caller context when none is supplied `[skill-loader.ts:SkillLoader]` `[skill-loader.ts:injectContext]`.

## Side Effects
- `ExtensionRegistry` reads and writes the store directory: it copies files on install, recursively deletes on uninstall, and rewrites `EXTENSION.yaml` for version updates `[registry.ts:install]` `[registry.ts:uninstall]` `[registry.ts:updateVersion]`.
- `updateVersion` edits only a top-level, unindented `version:` line and then reloads the registry `[registry.ts:updateVersion]`.
- `HookRunner` writes handler failures to `console.error` and invokes an optional error callback `[hook-runner.ts:execute]`.
- `SkillLoader` performs filesystem reads of the skills directory; it never writes `[skill-loader.ts:load]` `[skill-loader.ts:list]`.
- `getDefaultExtensionStore` reads the OS home directory `[index.ts:getDefaultExtensionStore]`.

## Verification
- Run: `pnpm test`
