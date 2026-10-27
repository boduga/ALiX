# Agents

## Purpose

Own model-facing built-in tool names, worker tool policy, and subagent dispatch.

## Ownership

- `tool-manifest.ts` maps canonical `alix_*` names to internal executor IDs.
- `tool-name-resolver.ts` resolves ONLY the exact names offered in the current turn. Executor IDs are never accepted from a caller.
- `tool-policy.ts` applies role-based tool access.
- `subagent-cli.ts` builds and runs worker turns. Its lifecycle appends
  (`subagent.started/completed/failed`) are best-effort: the stdout result is
  authoritative, so a contended EventLog append must never fail the worker.
  **Every child completion appends `model.usage`** from `resp.usage`, via the same
  `buildModelUsageEventPayload` the main loop uses. It did not before: the loop
  consumed only `resp.text`/`resp.toolCalls`, so subagent tokens never entered the
  event log — a silent undercount that excluded delegated (and usually most
  expensive) work from every cost figure. The child has no authoritative caller
  `runId`, so the field is omitted rather than guessed, and the append is
  best-effort: usage telemetry must never fail a worker whose work is done.
  That includes the FAILURE path: in `--output json` the structured failed
  `SubagentResult` is written to **stdout**, because `SubagentManager.spawn`
  parses stdout only. Writing it to stderr makes the parent fall back to the raw
  exit code and reject with a bare error string, discarding `status`, `findings`
  and `error` and misreporting a clean structured failure as a crash (D8-01).
  `--output text` keeps its human failure rendering on stderr so it cannot
  pollute a captured report.
- `subagent-manager.ts` — subagent lifecycle (spawn/cancel/shutdown) and the
  chat-path ownership lease point: write tasks with `ownedPaths` acquire
  durable `src/coordination/ownership/ownership-registry.ts` leases at spawn (workspace root
  captured at construction via the `cwd` option; per-task `task.cwd` wins),
  release them before `spawn` resolves, and renew them while running.
  Coordination tasks (`coordinationRunId`/`assignedAgentId` set) skip
  acquisition — the scheduler pre-claims those leases before dispatch.
  **A subagent result carries the worker's own durable events.** `buildResult`
  reads them via `readDurableEvents(eventLog)` at the call site and emits them
  bounded (`MAX_RESULT_EVENTS` / `MAX_RESULT_EVENT_CHARS`), appending an explicit
  `subagent.events.truncated` marker when a bound is hit. The bound exists because
  the result crosses to the parent as ONE JSON line on stdout. This was previously
  a hardcoded `events: []`, which made a worker's admissibility uninspectable:
  absence of a recorded infrastructure fault could not be distinguished from
  absence of any record. Pinned by `tests/agents/subagent-result-events.vitest.ts`.
  `getRoleModel` resolves the role's model from the canonical `models` object via
  `createModelResolver` (MP-01 reader parity), never from the derived
  `subagents.<tier>` projection that MP-02 retires. Precedence is role `style`
  then `default`; the result is a copy. Pinned by
  `tests/agents/mp-01-reader-parity.vitest.ts`, including a disagreeing-projection
  case that fails if the projection is preferred again.
- `coordination-objective-review.ts` checks worker evidence and persisted outputs against the assigned objective before coordination reports success.
- Collaboration handlers live in `src/capabilities/tools/collaboration-tools.ts` and are exposed to workers through bound tool definitions.

## Local Contracts

- The subagent CLI entry-point comparison uses `pathToFileURL` on the resolved executable path so Windows paths and escaped characters still launch the worker.

- **`SubagentResult.status` is an OWNERSHIP verdict, not a task verdict.**
  `computeSubagentStatus` answers "did the worker stay inside and deliver to its
  owned scope?", which is why `ownedPaths: ["."]` treats any in-cwd change as
  covering ownership. **Coordination workers are still reviewed**: `subagent-cli.ts`
  calls `reviewCoordinationResult` whenever `coordinationRunId` is set, and the
  in-process executor calls `reviewDefaultWorkerResult`. The reachable gap is
  **plain delegate** (eval/chat), which has no `coordinationRunId` and returns
  before the review. Low severity: the parent loop still evaluates the objective.
  Owner: `docs/harness-subagent-status-semantics.md`.


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
- **Review evidence spans attempts, not one invocation.** A worker's mutation evidence is the union of its current attempt's events and the run's DURABLE session log, always restricted to its owned scope. Re-creating identical content emits no mutation event (the router answers `changed: false` before it writes), so without the durable set a correct retry is reviewed with an empty evidence set and fails — the contract "durable progress survives failed retries" applies to the worker review, not only to the session loop. The child worker executor seeds its durable write progress the same way, so a retry is not reported as having made no progress. A worker with no owned scope has NO mutation evidence: a read-only worker never inherits the session's writes.
- `DefaultWorkerExecutor` passes scheduler-owned write scopes through `runTask` and `initAgent` to the `ToolExecutor` policy gate. This context is internal execution state, never prompt or tool input; direct runs omit it and keep their configured policy behavior.
- **The review budget bounds the prompt, never the worker.** `REVIEW_BUDGET_CHARS` (`coordination-objective-review.ts`) caps the reviewer's payload; exceeding it must SEND LESS — the file's evidence-bounding helper keeps the newest tool outputs and marks what it dropped — not reject the worker. It previously fell straight through to `reject`, so a worker that gathered thorough evidence was failed for being thorough — a real coordination run failed with "Evidence exceeds review budget; completion remains unverified" after three attempts because the worker had read a 1000-line log. That bounding helper never empties the evidence set and never clips silently. Both internal review-dispatch sites inside `reviewCoordinationResult` must `await` their review promise: a bare `return <promise>` inside the `try` leaves a provider rejection outside the `catch` and drops the mutation evidence that path exists to preserve.
- **A text deliverable needs no persisted file.** `reviewCoordinationResult` (`coordination-objective-review.ts`) instructs the reviewer to treat a worker's stated finding as the deliverable when the assigned objective asks for a response/answer/summary rather than a file; only file deliverables require the persisted output. A malformed reviewer verdict is re-asked once with a corrective instruction before failing closed.
- **The child worker inherits the configured call budget.** `subagent-cli.ts` builds its provider from the CLI's provider/model flags, so the call budget is read from the config entry that matches that provider/model pair (`models.<tier>.timeoutMs` / `streamIdleTimeoutMs`) and passed to `createProvider`. Without this a child always runs at the provider default (300s for local CPU), and a sized budget — e.g. the eval harness's `--timeout-ms` — can never reach it.

## Work Guidance

The `alix_execution_state_propose` tool is intercepted in
`src/execution/run/event-handlers.ts` before the router. It has no registry entry; its
internal identity is defined in the manifest.

- Subagent behavior flags read through `src/operations/config/subagent-config.ts`
  (`isSubagentsEnabled` / `getSubagentRole`) — never through `ModelResolver`,
  which stays models-only.

- Update the manifest, resolver, worker boundary, prompts, and cutover fixtures together when changing model-facing names.
- Run GitNexus impact analysis before editing functions, classes, or methods; inspect high-risk results before proceeding.

## Verification

- Run the exact-name resolver, MCP cutover/selector/discovery, tool-policy, hallucination-guard, and collaboration-tool tests.
- Run `pnpm typecheck`, `pnpm typecheck:unused`, and the relevant build/test gates for code changes.

## Child DOX Index

No child AGENTS.md files.
