# Platform State Directory Resolution

## Overview
Resolves the platform-appropriate base directory for ALiX Inspector auth state, persistent data, and configuration. It exposes deterministic test overrides but leaves directory creation, restrictive permissions, and symlink safety to the caller.

## Interface
- `UserStatePaths` — the `authStateDir`, `dataDir`, and `configDir` returned to callers `[user-state-paths.ts:UserStatePaths]`.
- `getUserStatePaths()` — resolves the platform base directory and appends `auth`, `data`, and `config` segments `[user-state-paths.ts:getUserStatePaths]`.
- `setStateDirOverride(dir)` / `clearStateDirOverride()` — install or clear a process-wide deterministic test override `[user-state-paths.ts:setStateDirOverride]` `[user-state-paths.ts:clearStateDirOverride]`.

## Invariants
- A non-null test override takes precedence over every platform-specific resolution branch `[user-state-paths.ts:resolveBaseStateDir]`.
- Linux resolves under `$XDG_STATE_HOME/alix-inspector` or `~/.local/state/alix-inspector`; macOS under `~/Library/Application Support/alix-inspector`; Windows under `%LOCALAPPDATA%/alix-inspector` or the `AppData/Local` fallback `[user-state-paths.ts:resolveBaseStateDir]`.
- Unknown platforms fall back to `~/.alix-inspector` `[user-state-paths.ts:resolveBaseStateDir]`.
- Directory creation and restrictive permissions are explicitly the caller's responsibility, not this module's guarantee `[user-state-paths.ts:getUserStatePaths]`.

## Side Effects
- Reads `process.platform`, `XDG_STATE_HOME`, and `LOCALAPPDATA` on each resolution `[user-state-paths.ts:resolveBaseStateDir]`.
- Mutates module-level `overrideDir` through the override functions `[user-state-paths.ts:overrideDir]`.
- No disk writes, network access, or locks are performed by this module.

## Verification
- Run: `pnpm test`
