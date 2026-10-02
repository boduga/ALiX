# Agents

## Purpose

Own model-facing built-in tool names, worker tool policy, and subagent dispatch.

## Ownership

- `tool-manifest.ts` maps canonical `alix_*` names to internal executor IDs.
- `tool-name-resolver.ts` resolves ONLY the exact names offered in the current turn. Executor IDs are never accepted from a caller.
- `tool-policy.ts` applies role-based tool access.
- `subagent-cli.ts` builds and runs worker turns.
- Collaboration handlers live in `src/tools/collaboration-tools.ts` and are exposed to workers through bound tool definitions.

## Local Contracts

- Built-in model names come from the manifest; capability and executor IDs stay internal, and `pnpm check:dox` fails CI if a model-facing contract bullet names one (`scripts/check-dox-claims.mjs`). Prose describing code may still name an executor — that is correct. One tool is its own exception: the state-proposal entry maps model-facing name to the identical executor id, so it has no separation between the two vocabularies. It is intercepted in `src/run/event-handlers.ts` and never routed, so the collision is inert; it is the only such entry and a second one is a defect.
- Worker turns accept only exact offered names, including bound collaboration tools.
- MCP model handles are opaque `mcp__*` values scoped to the current discovery/turn registry. Search names may rank tools but never resolve calls.
- **ONE vocabulary for tool names.** A tool has exactly one callable name: the `alix_*` form offered this turn. Executor IDs are the code's internal dispatch identity and are NEVER accepted from a caller — `resolveExecutableToolName` rejects them even when that tool was offered. It previously carried a documented-executor alias bridging the two; the alias was removed once every model-facing contract bullet named the `alix_*` tool, because it no longer bridged anything real and only widened the accepted surface. MCP handles are the one exception, and it is not a naming choice: they are minted per turn and cannot be pre-declared, so a discovered `mcp.*` executor name stays an accepted equivalent spelling, still gated on an `mcp__`-named, `mcp.`-executing offered entry. A wrong name costs one turn and is self-correcting — the rejection message names the callable options — so the narrow surface is the intended failure mode, not a defect. Pinned by `tests/agents/exact-tool-name-resolver.vitest.ts` (which asserts every built-in executor ID is rejected even when offered) and `tests/run/tool-hallucination-guard.vitest.ts`.
- Unknown, legacy, and unoffered names fail closed. A rejection emits `tool.rejected` with the RAW requested name — the only place that name survives, since `ToolExecutor` records the post-resolution executor. `filterTools` classifies by role category through two hand-maintained sets in `tool-policy.ts` (`NON_WRITE_TOOLS`, `WRITE_TOOLS`) and denies anything unlisted, so every `alix_*` name in `ALIX_BUILTIN_EXECUTORS` must appear in exactly one set or be handled inline — `tests/agents/tool-policy.test.ts` scans for drift. The sets are a role-category classification, NOT a second copy of the manifest: `NON_WRITE_TOOLS` is deliberately not called "read-only" because it contains `alix_shell_run` (arbitrary command execution, separately `ask`-gated) and the coordination/state readers. The `alix_collaboration_*` tools are in neither set on purpose — they reach a worker only as bound tools, which bypass `filterTools` entirely.

## Work Guidance

- Update the manifest, resolver, worker boundary, prompts, and cutover fixtures together when changing model-facing names.
- Run GitNexus impact analysis before editing functions, classes, or methods; inspect high-risk results before proceeding.

## Verification

- Run the exact-name resolver, MCP cutover/selector/discovery, tool-policy, hallucination-guard, and collaboration-tool tests.
- Run `pnpm typecheck`, `pnpm typecheck:unused`, and the relevant build/test gates for code changes.

## Child DOX Index

No child AGENTS.md files.
