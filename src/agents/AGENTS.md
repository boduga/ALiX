# Agents

## Purpose

Own model-facing built-in tool names, worker tool policy, and subagent dispatch.

## Ownership

- `tool-manifest.ts` maps canonical `alix_*` names to internal executor IDs.
- `tool-name-resolver.ts` resolves only names offered in the current turn, plus the documented-executor alias (below).
- `tool-policy.ts` applies role-based tool access.
- `subagent-cli.ts` builds and runs worker turns.
- Collaboration handlers live in `src/tools/collaboration-tools.ts` and are exposed to workers through bound tool definitions.

## Local Contracts

- Built-in model names come from the manifest; capability and executor IDs stay internal.
- Worker turns accept only exact offered names, including bound collaboration tools.
- MCP model handles are opaque `mcp__*` values scoped to the current discovery/turn registry. Search names may rank tools but never resolve calls.
- **Documented-executor alias.** `resolveExecutableToolName` also accepts the internal executor ID of a tool that was OFFERED this turn (`shell.run` → `alix_shell_run`, and a discovered `mcp.*` executor name → its `mcp__*` handle). This exists because the repo's own DOX and specs name tools by executor ID (~100 backticked mentions of `shell.run` / `file.create` / `patch.apply` / `verify.claim` across `docs/` and `AGENTS.md`), so a model that reads them and calls the executor name is not inventing a capability. The alias is a naming-convention bridge, never a capability grant: authority still comes from the offered surface, and an executor ID whose canonical tool is unoffered still fails closed. Pinned by `tests/agents/exact-tool-name-resolver.vitest.ts` and `tests/run/tool-hallucination-guard.vitest.ts`.
- Unknown, legacy, and unoffered names fail closed. A rejection emits `tool.rejected` with the RAW requested name — the only place that name survives, since `ToolExecutor` records the post-resolution executor. `filterTools` classifies by role category through two hand-maintained sets in `tool-policy.ts` (`NON_WRITE_TOOLS`, `WRITE_TOOLS`) and denies anything unlisted, so every `alix_*` name in `ALIX_BUILTIN_EXECUTORS` must appear in exactly one set or be handled inline — `tests/agents/tool-policy.test.ts` scans for drift. The sets are a role-category classification, NOT a second copy of the manifest: `NON_WRITE_TOOLS` is deliberately not called "read-only" because it contains `alix_shell_run` (arbitrary command execution, separately `ask`-gated) and the coordination/state readers. The `alix_collaboration_*` tools are in neither set on purpose — they reach a worker only as bound tools, which bypass `filterTools` entirely.

## Work Guidance

- Update the manifest, resolver, worker boundary, prompts, and cutover fixtures together when changing model-facing names.
- Run GitNexus impact analysis before editing functions, classes, or methods; inspect high-risk results before proceeding.

## Verification

- Run the exact-name resolver, MCP cutover/selector/discovery, tool-policy, hallucination-guard, and collaboration-tool tests.
- Run `pnpm typecheck`, `pnpm typecheck:unused`, and the relevant build/test gates for code changes.

## Child DOX Index

No child AGENTS.md files.
