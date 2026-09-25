# Exact Tool Names Implementation Plan

**Spec:** [2026-09-24-exact-tool-names-design.md](../specs/2026-09-24-exact-tool-names-design.md)

**Goal:** Enforce exact `alix_*` and `mcp__*` model tool names across main, worker, and dynamic MCP paths.

**Architecture:** A static manifest owns built-in model names and their internal executor IDs. A per-turn resolver accepts only offered exact names; MCP handles are registered from discovered tools. Internal capability IDs and policy keys are retained.

**Tech Stack:** TypeScript, Node test runner, Vitest, GitNexus.

## Tasks

- [x] Add failing tests for canonical built-ins, old-name rejection, dynamic MCP errors, and worker offered-tool checks.
- [x] Implement manifest and exact resolver; remove `tool-name-map.ts` and migrate main/worker call sites.
- [x] Change MCP names to `mcp__*` opaque registered handles; test collisions and rejected legacy names.
- [x] Canonicalize live state-proposal and collaboration tools; remove phantom policy/scoping names.
- [x] Sweep model-facing prompts and fixtures while preserving capability IDs and internal executor IDs.
- [x] Update nearest DOX contracts; run focused tests, typecheck, unused-code gate, and runtime smoke test.
- [x] Run GitNexus `detect_changes` and review affected flows before commit.

## Deployment

Stop active sessions before activating this branch. Use fresh worktree-local `.alix` state for smoke tests. Do not wipe shared conversational history or user config. Start new sessions under the new manifest and distinguish post-cutover traces by commit/version metadata.
