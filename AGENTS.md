<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ALiX** (35795 symbols, 81161 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/ALiX/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ALiX/clusters` | All functional areas |
| `gitnexus://repo/ALiX/processes` | All execution flows |
| `gitnexus://repo/ALiX/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# DOX — Durable Operating Contract

DOX is a hierarchical AGENTS.md framework. Every agent must follow DOX instructions across any edit.

## Core Contract

- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it.

## Read Before Editing

1. Read the root AGENTS.md.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every AGENTS.md found along each route.
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there.
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index.
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index.
- Each parent explains what its direct children cover and what stays owned by the parent.
- The closer a doc is to the work, the more specific and practical it must be.

## Child Doc Shape

Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards.

Default section order:

1. **Purpose** — what this subsystem does
2. **Ownership** — key files and their responsibilities
3. **Local Contracts** — conventions, invariants, design decisions
4. **Work Guidance** — how to work in this area
5. **Verification** — how to test changes
6. **Child DOX Index** — list of child AGENTS.md files

## Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist.

## Closeout

- Re-check changed paths against the DOX chain.
- Update nearest owning docs and any affected parents or children.
- Refresh every affected Child DOX Index.
- Remove stale or contradictory text.
- Run existing verification when relevant.
- Report any docs intentionally left unchanged and why.

## User Preferences

- When the user requests a durable behavior change, record it here or in the relevant child AGENTS.md.
- **Unlimited agent lifetime + progress-based liveness (durable).** Agent turns have NO wall-clock deadline. A run may last minutes or hours until it reaches a terminal state or the operator cancels. Do not introduce wall-clock timeouts on agent execution (TUI `dispatchToSession`, task loop, run CLI). Liveness = time since last progress mark (`AgentLiveness` in `src/agent/agent-liveness.ts`), surfaced as `agent.liveness.warning`/`agent.liveness.recovered`/`agent.liveness.stalled` events and the agent tab's RUNNING/⚠ line — never auto-termination. Provider streaming stays idle-timeout-only (silence = failure, long healthy streams = fine); `complete()` keeps its total timeout. For short-lived RPC-style calls (e.g. the chat tab's `processChat`), short deadlines remain acceptable.
- **Store-only API key resolution (durable).** Provider API keys are resolved exclusively from the user config / credential store (`~/.config/alix/config.json` `apiKeys` — literals or `cred://<provider>/<keyLabel>` references). Environment variables are NOT consulted at any key-resolution site: `getApiKey` (cli/helpers/api-keys.ts), `agent.ts apiKeyFor`, `skills/factory.ts`, `tools/web-search.ts` (Brave), and `cli/commands/tui.ts`. The config loader still injects resolved store secrets into `process.env` at load time (ephemeral in-memory only) so provider SDKs keep working — this is injection, not env-first resolution. Tests that previously set `*_API_KEY` env vars now write a user-config file via `writeApiKeyConfig`.
- **Operator cancellation is first-class (durable).** An explicit user cancel (Escape in the TUI while an agent turn runs → `AgentSession.cancelActiveTurn`) is a NORMAL terminal outcome, never a failure and never a timeout. It flips a per-turn `CancellationToken` (`src/runtime/cancellation-token.ts`) checked at loop safe points (iteration top AND immediately before each tool dispatch — a cancel never launches a NEW tool) and aborts a paired `AbortSignal` raced against the in-flight provider request/stream and threaded into in-flight tools (`ToolCallRequest.signal` → `spawnCommand`), so an operator cancel KILLS a running shell.run child and unwinds as an `ExecutionCancelledError` — never as a tool failure / `tool.failed` (no new wall-clock deadlines; transport idle/timeout bounds and tool `timeoutMs`/`commandTimeoutMs` safety limits are untouched). Cancelled invocations are classified via `isCancellationError` (session.ts): counted `agent_invocation_cancelled_total` (never `agent_invocation_failed_total`), activity transitions `cancelling` ("Cancelling…") → `cancelled`, the TUI summary reads "Cancelled after Ns" (`getLastCancelSummary`), and the graph/workflow are marked `cancelled` — never `failed`. A provider-level abort (e.g. `ApiError` 408) is NOT a user cancel and stays a failure.
- **Workspace containment applies to approval-free shell reads (durable).** Safe-shell admission only classifies command shape; it never grants path authority. Every filesystem operand accepted by the safe-shell grammar must pass `WorkspacePathResolver`, including lexical traversal, absolute paths, protected paths, and symlink targets. A failed safe-shell process is a failed tool result, not successful output. Tool-result failure detection must use the result envelope/prefix, never keywords found anywhere in successful file content.
- **Shell exclusion predicates are not path access (durable).** A static, quoted `find -not -path`/`find ! -path` predicate may name a protected path solely to exclude it from traversal and must not be rejected as an access attempt. Positive predicates, dynamic/expanded exclusions, and any additional sensitive-path reference remain fail-closed.
- **Network policy applies to shell clients (durable).** `shell.run` must enforce the same domain allowlist, DNS resolution, and private/link-local destination rejection as `web_fetch` for explicit URLs and known network clients. A model may not bypass SSRF controls by falling back to `curl`, `wget`, `nc`, SSH-family tools, `telnet`, or `ping`; destinations that cannot be validated fail closed.
- **Completion requires executed evidence (durable).** For current-turn objectives that explicitly require workspace mutation or post-change verification, model prose and `done` calls are insufficient. Only successful mutation tool results count as mutation evidence, and verification must succeed after the mutation. Missing evidence yields `completed_unverified` with the exact gap instead of a false completion claim.
- **Durable progress survives failed retries (durable).** Once a mutation tool succeeds, a later failed retry may be reported but must not erase the successful changed-file evidence or replace the final result with a bare tool error.
- **Patch syntax is authoritative (durable).** `patch.apply` must normalize unmistakable patch syntax before selecting its parser. In particular, simplified Aider/Codex `*** Begin Patch` update hunks with bare `@@` markers are applied as exact search/replace blocks even when the model labels them `search_replace` or `unified_diff`; numbered unified diffs retain the unified parser. Never report a patch as changed when it contained no applicable hunks.
- **Automatic verification is bounded and change-aware (durable).** Repository verification discovery may auto-run only the explicit non-interactive `typecheck`/`type-check`/`lint`, `build`/`compile`, and `test`/`test:unit`/`test:integration` package scripts. Never infer arbitrary scripts as tests or auto-run manual, eval, soak, benchmark, helper, or aggregate scripts. Pure documentation/plain-text mutations (`.adoc`, `.log`, `.markdown`, `.md`, `.rst`, `.txt`) may complete from successful mutation plus read-back evidence without launching repository-wide checks unless the current objective explicitly requires post-change verification; code, configuration, fixtures/data, assets, mixed changes, unknown extensions, and explicit verification requirements still require normal verification. A successful model-invoked verification command satisfies the explicit requirement and must not trigger a duplicate automatic run.
- Always use the `caveman` skill for user-facing communication. Keep full technical accuracy; suspend compression only when its auto-clarity exception applies.
- Prefer subagent-driven development with two-stage review (spec compliance → code quality).
- Keep Inspector read-only; do not add POST endpoints for execution.
- CLI-first for all approval and audit actions.
- Commit early, push often; tag baseline milestones.

## Child DOX Index

| Path | Scope |
|------|-------|
| `src/kernel/AGENTS.md` | Graph execution engine — TaskGraph, GraphExecutor, projection, planner |
| `src/policy/AGENTS.md` | Policy rules, RuleEvaluator, RuntimeGate, default policies, loader |
| `src/registry/AGENTS.md` | Agent/tool cards, CardRegistry, CapabilityResolver, card loader |
| `src/approvals/AGENTS.md` | Approval queue, ApprovalStore |
| `src/audit/AGENTS.md` | Audit trail — JSONL append-only store |
| `src/server/AGENTS.md` | Inspector HTTP server, session reader, API routes |
| `src/ui/AGENTS.md` | Inspector web UI — HTML, JS, CSS, projection |
| `src/daemon/AGENTS.md` | Runtime daemon — manager, socket server, task registry, protocol |
| `src/runtime/AGENTS.md` | Runtime — execution-state, state-aware context builder, unified event index |
| `src/observability/AGENTS.md` | Observability platform — metrics, telemetry, diagnostics, alerts, cost, health |
| `src/utils/memory/AGENTS.md` | Agent memory store — persistence, recall, consolidation, decision extraction |
| `src/evals/AGENTS.md` | Behavioral eval suite — scripted provider, drivers, evaluators, cases, runner, `alix evals` |
| `src/providers/AGENTS.md` | Model adapters & routing — registry, specs, free-model resolver, capacity-aware routing, OpenRouter access classification |
| `src/tui/AGENTS.md` | Interactive terminal UI — projections, Workbench transcript, views, input, layout, rendering |
| `src/tracing/AGENTS.md` | Langfuse tracing facade — TraceClient, noop client, capture policy, adapter |
| `benchmark/AGENTS.md` | Benchmark harness history vs summary vs state vs hybrid — deterministic maintenance/reconciliation, FakeModel substrate isolation, 4-group metrics |
| `docs/superpowers/AGENTS.md` | Implementation specs and plans |
