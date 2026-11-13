# TUI Command Helpers

## Overview
Pure display/decision helpers shared by the TUI command surface. The current member is the `/policy` handler, which reads and switches the session policy mode on a caller-supplied config object and returns the lines the TUI prints. It performs no I/O and emits no TUI output itself ([policy-commands.ts:handlePolicyCommand] file doc).

## Interface
- `PolicyConfig` — minimal structural view: `permissions?: { sessionMode?: string }` ([policy-commands.ts:PolicyConfig])
- `handlePolicyCommand(config, args)` — returns `string[]` display lines; switches mode for `bypass`/`ask`/`auto`, reports state for empty/`show`/`status`, and prints usage otherwise ([policy-commands.ts:handlePolicyCommand])

## Invariants
- The effective current mode defaults to `"bypass"` when `config.permissions.sessionMode` is absent or falsy ([policy-commands.ts:handlePolicyCommand]).
- Arguments are trimmed and lowercased before matching, so `ASK` and ` ask ` select the same branch ([policy-commands.ts:handlePolicyCommand]).
- An unrecognized argument never changes the mode; it returns only usage lines ([policy-commands.ts:handlePolicyCommand]).
- The mode setter branches (`bypass`, `ask`, `auto`) assign exactly the literal mode string they matched ([policy-commands.ts:handlePolicyCommand]).
- `handlePolicyCommand` always returns at least one line — every branch appends display text ([policy-commands.ts:handlePolicyCommand]).

## Side Effects
- Mutates the caller's `config` object in memory: `config.permissions` is created when missing (`??=`) on every call, and `config.permissions.sessionMode` is assigned on a mode switch ([policy-commands.ts:handlePolicyCommand]).
- No file, network, clock, or event effects ([policy-commands.ts:handlePolicyCommand] file doc).

## Verification
- Run: `pnpm test`
