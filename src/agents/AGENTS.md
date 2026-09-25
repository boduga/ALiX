# Agents

## Purpose

Own model-facing built-in tool names, worker tool policy, and subagent dispatch.

## Ownership

- `tool-manifest.ts` maps canonical `alix_*` names to internal executor IDs.
- `tool-name-resolver.ts` resolves only names offered in the current turn.
- `tool-policy.ts` applies role-based tool access.
- `subagent-cli.ts` builds and runs worker turns.
- Collaboration handlers live in `src/tools/collaboration-tools.ts` and are exposed to workers through bound tool definitions.

## Local Contracts

- Built-in model names come from the manifest; capability and executor IDs stay internal.
- Worker turns accept only exact offered names, including bound collaboration tools.
- MCP model handles are opaque `mcp__*` values scoped to the current discovery/turn registry. Search names may rank tools but never resolve calls.
- Unknown, legacy, and unoffered names fail closed.

## Work Guidance

- Update the manifest, resolver, worker boundary, prompts, and cutover fixtures together when changing model-facing names.
- Run GitNexus impact analysis before editing functions, classes, or methods; inspect high-risk results before proceeding.

## Verification

- Run the exact-name resolver, MCP cutover/selector/discovery, tool-policy, hallucination-guard, and collaboration-tool tests.
- Run `pnpm typecheck`, `pnpm typecheck:unused`, and the relevant build/test gates for code changes.

## Child DOX Index

No child AGENTS.md files.
