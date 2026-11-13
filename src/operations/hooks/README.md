# Task Hooks

## Overview

Project-scoped lifecycle hooks. `discoverHooks` reads a single `<root>/.alix/hooks.json` file and returns the parsed `pre_task`, `post_task`, and `on_change` hook lists; `runHook` executes one hook command through `/bin/sh -c` and reports whether it exited zero. Hooks are supplied entirely by that JSON file — this module defines the shape and the runner, and never synthesizes hook entries itself.

## Interface

- `Hook` is `{ command, reason, env? }`; `env` is a string map merged into the child environment `[discover.ts:Hook]`.
- `HookConfig` is the optional keyed collection `pre_task`, `post_task`, and `on_change`, each an array of `Hook` `[discover.ts:HookConfig]`.
- `discoverHooks(root)` returns the `HookConfig` for a project root `[discover.ts:discoverHooks]`.
- `runHook(hook, cwd, extraEnv = {})` executes one hook and resolves `{ passed, output, exitCode }` `[runner.ts:runHook]`.
- `buildChildEnv` is the shared child-environment builder the runner uses; it keeps only an allowlist of ambient variables plus explicit overrides `[../../runtime-state/runtime/child-env.ts:buildChildEnv]`.

## Invariants

- The hook file path is exactly `join(root, ".alix", "hooks.json")`; no other location is consulted `[discover.ts:discoverHooks]`.
- A missing hooks file returns `{}` before any read is attempted `[discover.ts:discoverHooks]`.
- A read or JSON-parse failure is swallowed and also returns `{}`; discovery never throws for malformed content `[discover.ts:discoverHooks]`.
- The parsed JSON is cast directly to `HookConfig` with no schema validation, so unrecognized fields survive and malformed entries are not rejected at discovery time `[discover.ts:discoverHooks]`.
- The command is always invoked as `/bin/sh -c <hook.command>`; the hook string is interpreted by the shell rather than split into argv `[runner.ts:runHook]`.
- The child's working directory is the `cwd` argument passed to `runHook` `[runner.ts:runHook]`.
- The child environment is built by `buildChildEnv(undefined, { ...extraEnv, ...hook.env })`, so `hook.env` overrides caller `extraEnv` on key collisions `[runner.ts:runHook]`.
- `buildChildEnv` retains only the ambient `PATH`, `HOME`, `SHELL`, `TMPDIR`, `TMP`, `TEMP`, `SystemRoot`, `COMSPEC`, and `PATHEXT` entries, then spreads overrides; other ambient variables are not propagated `[../../runtime-state/runtime/child-env.ts:buildChildEnv]`.
- `stdout` and `stderr` are concatenated into the single `output` string in arrival order; they are not separated `[runner.ts:runHook]`.
- `passed` is true only when the close code is exactly `0` `[runner.ts:runHook]`.
- A null close code is reported as `exitCode: -1` `[runner.ts:runHook]`.
- A spawn error resolves `{ passed: false, output: "", exitCode: -1 }` instead of rejecting `[runner.ts:runHook]`.

## Side Effects

- `discoverHooks` reads `<root>/.alix/hooks.json` from disk `[discover.ts:discoverHooks]`.
- `runHook` spawns a `/bin/sh` child process `[runner.ts:runHook]`.
- The spawned shell executes whatever command text the hook configuration contains, with the restricted child environment described above `[runner.ts:runHook]`.

## Verification

- Run: `pnpm test`
