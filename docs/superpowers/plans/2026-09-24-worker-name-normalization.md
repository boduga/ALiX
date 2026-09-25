# Worker Name Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the tool-name and dependency-path mistakes observed in the four-worker coordination session.

**Status:** Implemented and verified locally on 2026-09-24 (136 focused tests, build, unused-code typecheck, and GitNexus change review).

**Spec:** `2026-09-24-worker-name-normalization-design.md`

**Architecture:** Extend the existing tool-name map with exact safe aliases, and require each resolved name to match a tool offered in the current iteration. Add explicit producer file paths to dependent worker prompts after graph dependencies have been mapped. Preserve existing executor and path resolution rules.

**Tech Stack:** TypeScript, Node test runner, GitNexus impact and change detection.

## Global Constraints

- Existing policy, ownership, and workspace containment checks remain authoritative.
- Do not rewrite unknown names or ambiguous file paths.
- Keep the change limited to worker tool mapping and coordination task prompts.

---

### Task 1: Tool name normalization

**Files:** `tests/agents/subagent-cli.test.ts`, `src/agents/tool-name-map.ts`

**Interfaces:** Add exact `file_create` compatibility to `TOOL_NAME_MAP`. `resolveOfferedToolName(name, iterationTools)` returns a canonical executor name only if the tool was offered.

- [x] Add a test that resolves `file_create` to `file.create` and leaves an unknown spelling unresolved.
- [x] Run the focused test and verify its expected failure.
- [x] Add the exact alias to `TOOL_NAME_MAP`.
- [x] Gate aliases and canonical spellings against current iteration tools before executor dispatch.
- [x] Run the focused test and verify success.

### Task 2: Dependency input paths

**Files:** `tests/kernel/coordination-planner.test.ts`, `src/kernel/coordination-planner.ts`, `src/kernel/AGENTS.md`

**Interfaces:** After mapping graph dependencies to worker IDs, append an `Input paths:` manifest from direct producer workers with one explicit file ownership path.

- [x] Add a planner test with three explicit producer outputs and one dependent report; assert the report prompt names all three full paths.
- [x] Add a planner test that vague producer ownership is omitted from the manifest.
- [x] Run tests and verify expected failures.
- [x] Append deduplicated explicit paths from direct dependencies to the dependent prompt.
- [x] Run focused planner tests and verify success.
- [x] Update kernel DOX contract for dependency input manifests.

### Task 3: Verification

**Files:** No additional implementation files.

- [x] Run focused subagent and coordination planner tests.
- [x] Run `pnpm build` and `pnpm typecheck:unused`.
- [x] Run GitNexus `detect_changes()` and inspect changed scope.
- [x] Re-check the DOX chain and git status before closeout.
