# Agents

## Purpose

Own model-facing built-in tool names, worker tool policy, and subagent dispatch.

## Ownership

- `tool-manifest.ts` maps canonical `alix_*` names to internal executor IDs.
- `tool-name-resolver.ts` resolves ONLY the exact names offered in the current turn. Executor IDs are never accepted from a caller.
- `tool-policy.ts` applies role-based tool access.
- `subagent-cli.ts` builds and runs worker turns.
- `subagent-manager.ts` — subagent lifecycle (spawn/cancel/shutdown) and the
  chat-path ownership lease point: write tasks with `ownedPaths` acquire
  durable `src/ownership/ownership-registry.ts` leases at spawn (workspace root
  captured at construction via the `cwd` option; per-task `task.cwd` wins),
  release them before `spawn` resolves, and renew them while running.
  Coordination tasks (`coordinationRunId`/`assignedAgentId` set) skip
  acquisition — the scheduler pre-claims those leases before dispatch.
- `coordination-objective-review.ts` checks worker evidence and persisted outputs against the assigned objective before coordination reports success.
- Collaboration handlers live in `src/tools/collaboration-tools.ts` and are exposed to workers through bound tool definitions.

## Local Contracts

- Built-in callable names come from `ALIX_BUILTIN_EXECUTORS`; capability and
  executor IDs stay internal. Every built-in has distinct callable and dispatch
  names. `pnpm check:dox` checks model-facing contract vocabulary.
- Main and worker turns accept exact names offered in the current turn,
  including bound collaboration tools; unknown, legacy, executor, and unoffered
  names fail closed. Rejections emit the raw requested name in `tool.rejected`;
  executor telemetry records the resolved identity.
- MCP callable handles are opaque per-turn `mcp__*` values from discovery.
  Search names rank tools but do not resolve calls. The exact offered handle
  is the authoritative model-facing name. Never accept its discovered executor
  as an alias, even when the corresponding handle is offered.
- `filterTools` classifies roles through `NON_WRITE_TOOLS` and `WRITE_TOOLS`
  and denies unlisted entries. Every manifest name must occur in exactly one
  set or have explicit inline handling; `tests/agents/tool-policy.test.ts`
  checks drift. The non-write category includes approval-gated arbitrary shell
  execution and is not a read-only permission guarantee.
- Bound `alix_collaboration_*` definitions bypass `filterTools` and deliberately
  belong to neither role set.
- Worker findings preserve substantive model text plus bounded, explicitly untrusted executed tool evidence. All result payload families use `toolResultText`; preliminary commentary must not discard retrieved facts or URLs.
- Coordinated workers treat ownership scopes as permission limits. Write workers must demonstrate a mutation, but need not write every permitted file. Completion review checks requested deliverables against executed evidence and persisted output content, including confirmed deletions. Invalid, unsupported, or failed reviews preserve mutation evidence and return partial/failure rather than success. Review summaries precede raw evidence so downstream budgets retain the substantive answer.

## Work Guidance

The `alix_execution_state_propose` tool is intercepted in
`src/run/event-handlers.ts` before the router. It has no registry entry; its
internal identity is defined in the manifest.

- Update the manifest, resolver, worker boundary, prompts, and cutover fixtures together when changing model-facing names.
- Run GitNexus impact analysis before editing functions, classes, or methods; inspect high-risk results before proceeding.

## Verification

- Run the exact-name resolver, MCP cutover/selector/discovery, tool-policy, hallucination-guard, and collaboration-tool tests.
- Run `pnpm typecheck`, `pnpm typecheck:unused`, and the relevant build/test gates for code changes.

## Child DOX Index

No child AGENTS.md files.
