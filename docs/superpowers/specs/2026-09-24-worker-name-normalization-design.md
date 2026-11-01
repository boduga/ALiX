# Worker Name Normalization Design

## Problem

A four-worker coordination run supplied exact owned output paths, yet workers spent tokens on invalid calls: `file_create` was not recognized, and a dependent worker read bare `tui.md` and `tests.md` instead of their known producer paths. An output path assignment alone does not identify dependency inputs.

## Contract

- The model may emit documented `alix_*` tool names or a small set of legacy underscore spellings. Resolve these to one existing executor name before dispatch. Keep capability and policy checks on that canonical name. Do not infer arbitrary tool names.
- Every worker prompt includes full workspace-relative output paths already owned by that worker. A dependent worker also receives the full workspace-relative paths of its direct producers' explicit file outputs. No basename guessing, cwd changes, or automatic access to unrelated files.
- Keep the original graph goal as task prose. Add a separate input manifest so the source of each path is explicit. Paths with vague ownership scopes such as `**` are not listed as files.
- Unknown tool names and unresolved paths still fail closed. Existing authorization and ownership rules remain authoritative.

## Acceptance

- `file_create` resolves to `file.create` for a worker; unsupported inventions do not resolve.
- A dependent worker receives `.tmp/.../project.md`, `.tmp/.../tui.md`, and `.tmp/.../tests.md` in its task prompt when those are explicit outputs of its dependencies.
- A worker without explicit producer files receives no fabricated input path.
- Existing coordination planner, subagent, and type checks pass.

## Scope

This change normalizes names at the worker boundary and paths in coordination handoffs. It does not alter Jev, provider routing, file permissions, or arbitrary workspace paths.

## 2026-09-24 amendment: offered-tool gate

Alias resolution must also check the canonical name against tools offered in the current worker iteration. This prevents a guessed alias from bypassing role restrictions or the write-only final phase. Limit new unprefixed aliases to file, search, shell, and patch operations; do not introduce coordination, scheduling, state, or verification aliases.

## 2026-09-24 amendment: structured input paths

The prompt manifest alone cannot prevent a model from calling `file.read` with a basename. Persist the same paths in `WorkerAssignment.inputPaths`, pass them to the subagent process, and expand a bare read/exists path only when its basename uniquely identifies one declared input. Explicit paths and ambiguous basenames remain unchanged. The normal workspace path resolver still checks the resulting path.
