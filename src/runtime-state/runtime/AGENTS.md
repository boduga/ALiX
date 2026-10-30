# DOX — Runtime (Execution State, Context, Index)

## Purpose

Runtime substrate — execution-state projection, state-aware prompt context, and unified event index. On-demand, read-only aggregation plus bounded decision context for long-horizon execution.

## Ownership

- `runtime-index.ts` — RuntimeIndexEvent type, buildRuntimeIndex(), query filters (byGraph, bySession, byApproval, byAction).
- CLI commands in `src/cli.ts` — `alix runtime {events|timeline}`.
- Inspector Runtime tab renders from `GET /api/runtime/events`.
- `execution-state/` — ExecutionState contract, projector, store (see `execution-state/AGENTS.md`).
- `state/` — Governed patch-only transition harness (see `state/AGENTS.md`).
- `context/` — State-aware prompt builder P+Σ+O+E+Tools (see `context/AGENTS.md`).
- `tool-scheduler.ts` — Concurrency-aware ToolExecutionPolicy {allowParallel, maxParallel:4} + authoritative ToolConcurrency safe/exclusive (fail-closed unknown→serial), effectiveParallel=model&&harness&&safe, Promise.all chunked scheduler.
- `tool-correlation.ts` — Result correlation: hierarchy executionId → invocationId → toolCallId, every parallel result retains all three so call_1 → result_1 never ambiguous; events carry hierarchy, messages retain correlation, next model turn receives full array.
- `timing-events.ts` — `measurePhase()`: started/completed timing-event pair around wrapped work. Timing events are best-effort observability — append failures are swallowed so they can never fail the wrapped operation.
- `continuation-store.ts` — PendingContinuation persistence (`.alix/approvals/continuations.json`), keyed by approvalId. R2.14: the ledger is AUTHORITATIVE — `load()` rebuilds from `readLatestByEntityType("continuation")` (tombstones suppress file copies; file covers legacy zero-fact records; ledger errors count and throw); `persist`/`remove` append `continuation.created`/`updated`/`removed` BEFORE the in-memory mutation and file write (append failure counts then throws — no JSON-only state, memory untouched); file writes are tolerated and counted as `projectionFailures` in `continuationLedgerStatus(cwd)`.
- `continuation-ledger-reconcile.ts` — read-only comparison of `continuations.json` vs ledger (argsHash/integrity fields compared; `missing_in_ledger` / `record_mismatch` / `projection_stale` / `projection_missing` / `version_behind` / `ledger_payload_invalid`); surfaced in the `alix approvals reconcile` output alongside approvals.
- `replay-status-index.ts` — **ledger authoritative (R2.17)**: `load()` rebuilds from `readLatestByEntityType("replay")` (file covers legacy zero-fact entries; ledger errors count and throw); `setStatus` appends `replay.status_created`/`status_updated` FIRST (throws on failure) then writes the index file (tolerated + counted as `projectionFailures` in `replayLedgerStatus(cwd)`).
- `execution-evidence-store.ts` — **ledger authoritative (R2.17)**: `append` appends `evidence.recorded` FIRST (throws on failure; EVERY physical append mirrors — duplicate evidenceIds are legal under the append-only contract, callers own deduplication) then writes JSONL (tolerated + counted); `list()` replays ALL ledger events in seq order (line-level duplicates preserved) merged with legacy JSONL records that have no ledger facts; ledger cwd derived by stripping a trailing `.alix/<x>` segment; ledger errors count and throw. Status: `evidenceLedgerStatus(cwd)`.
- `runtime-evidence-ledger-reconcile.ts` — read-only `reconcileReplayLedger` + `reconcileEvidenceLedger` (evidence reads BOTH production locations: `.alix/governance/execution-evidence.jsonl` and `<cwd>/execution-evidence.jsonl`); sections of `alix runtime reconcile-executions` (exit 1 on any drift).

**Backends aggregated (7 sources):**
1. `audit/audit.jsonl` — policy/runtime audit events
2. `governance/governance-audit-events.jsonl` — governance audit events (via `readGovernanceAudit`; user-scoped Inspector auth audit stays out of the project index)
3. `approvals/approvals.json` — approval lifecycle
4. `graphs/*.json` — graph + per-node events
5. `graphs/*.runs.json` — rerun attempts
6. `sessions/*/events.jsonl` — allowlisted session events (16 types)
7. `daemon-tasks.json` — daemon task lifecycle

## Local Contracts

- Approved-live shell and file deletion replay enter `executeWithEffectJournal` before their adapters. Replay IDs and renewed approvals cannot bypass an unresolved exact effect. Unknown returned or thrown outcomes leave the consumed approval pending; definite results record their terminal execution outcome. Deletion diff capture runs inside the same journal boundary.
- `ReplayExecutor` and `RollbackExecutor` snapshot their plans and require exact per-step approved-live grants through `src/governance/approvals/live-step-approval.ts` before effects. Recompute binding from actual arguments, operation IDs and position; never trust recorded argument hashes. Rollback restores the same snapshot bytes whose hash was approved. Spent grants cannot resume an effect, and blocked steps prevent a completed status.
- `WorkspacePathResolver` normalizes both directory separators for sensitive and protected pattern matching, and derives workspace-relative candidates through the path library. Windows paths must enforce the same deny boundaries as POSIX paths.

- **Containment predicate is one function.** `relativeIsOutside(rel)` in
  `workspace-path.ts` is the single lexical check for a resolved
  `relative(root, target)` result (`rel === ".." || rel.startsWith("../") ||
  isAbsolute(rel)`); it backs `WorkspacePathResolver` and every resolved-path
  backstop (tool-router, file-tools, patch-engine, coordination). Never
  re-inline the `relative`+`startsWith` pattern. Raw-input sanitizers
  (`isTraversalSafe`, `isPathSafe`) validate unresolved strings and are their
  own heuristics — do not confuse them with this predicate.
- **The R2 transactional ledger is a storage authority, not a query-time
  backend.** Domains that flipped (execution-state R2.12, continuations
  R2.14, replay + evidence R2.17) read and write
  `<root>/.alix/runtime-ledger.db` through `src/runtime-state/storage/runtime-ledger.ts`;
  their JSON files are compatibility projections rebuilt from the ledger.
  The read-only runtime index still aggregates the seven file backends below.
- **Execution intents carry authorization provenance (R1.5).** `createExecutionIntent`
  tags source from the `AuthorizationSource` union
  (`src/runtime-state/contracts/authorized-execution-port.ts`): synthesized `auto:` approvals
  are `"system"`, caller-supplied approval references default `"policy"`, and
  `"operator"` is only ever passed explicitly — X-series self-approval can
  never be read as an operator decision. `verificationPassed` on governor
  evidence remains an outcome claim, never authorization.
- `ExecutionAuthorization` preserves an execution request's canonical `agentId` when delegating tool or capability decisions to `PolicyGate`; approval correlation must not substitute `workerId`.
- **Coordination identity is a typed, validated request field — never the `metadata` bag.** `ExecutionDecisionRequest.coordination` (`CoordinationExecutionContext`) carries the trusted `{ coordinationRunId, workerId, workerAttempt, ownershipClaims?, requestFingerprint? }` minted by the coordination runtime. `evaluate` classifies it: `absent` keeps the legacy path, `valid` forwards it into `evaluateCapability`/`evaluateToolCall`, and `invalid` (present but malformed/partial/conflicting) returns `denied` with `policyRuleId: "coordination-identity-invalid"` and no store side effect — it must never degrade to legacy authorization. The prior metadata-only transport silently dropped the identity (session D2, SRAP approval-binding continuity), so the coordination binding branch never ran.
- `PendingContinuation.coordinationWorker` is optional host attribution: run ID, worker ID, original `assignedAgentId`, attempt, ownership-claim hash and scope snapshot. The assignment snapshot is separate from the canonical invocation agent; old snapshots without it remain readable but cannot authorize daemon resumption or successful-receipt recovery. The default worker host sets it only from its captured tool-failure events. Old/unattributed records stay readable but are not guessed into daemon worker authority. This metadata never changes the original approval binding or canonical invocation agent identity.
- **A continuation whose approval was consumed is classified, never blindly retried.** `ContinuationManager.resumeApproved` treats a `consumed` record as a spent single-use claim: when its `executionOutcome` is `pending` it calls `ApprovalStore.markExecutionUnverified`, then refuses with an exact reason (`succeeded`/`failed`/`cancelled`/`unverified`) — `unverified` is terminal and the continuation is not retried automatically. Before resuming, an `approved` record must also carry a valid future `expiresAt` (`approvalExpiryState`, `src/governance/approvals/approval-binding.ts`): missing, empty, or unparsable expiry is corrupt authority and refuses with an invalid-expiry reason without consuming the one-shot continuation. The executor's continuation branch also claims the backing approval before executing, so the tombstone is not itself authorization.
- Sorted newest-first by default; `order=asc` reverses.
- Session events use an allowlist to filter out noisy event types.
- Silent failure on unreadable/missing backends (never crashes).
- Layer-3 route prompts: only the intents that actually reach a route carry dedicated text; misrouted intents (e.g. `workspace_mutation` on the chat/direct path) share one neutral read-only fallback and log a warning. Chat `workspace_*` intents are read-only because they route to `agent`, never `chat`.
- **A prose objective that opens with a shell-wrapper verb reaches the agent, not the shell tool.** Both `SHELL_COMMAND_ANCHORS` and the `run/execute/exec/invoke/fire/trigger/spawn` `SHELL_WRAPPER_ANCHORS` family are gated by `hasNaturalLanguageTail`; only the explicit `use bash to …` wrapper is prose by design. A `kind:"tool"` route sets the shell-task lens (`src/agents/agent/session/turn.ts`), which caps the run at 2 iterations and routes completion through `trackShellComplete` — the loop then terminates on the first failed tool result with no verification or repair (session `1791848832999` discarded a successful 3-worker coordination run when the follow-up `cat` guessed wrong filenames). Command-shaped wrappers (`run npm test`) stay on the shell route. Pinned by `tests/runtime/task-router.test.ts`.
- The grounded route offers manifest names and resolves model calls through `resolveExecutableToolName` before dispatch. `route.allowedTools` holds internal executor IDs; `tests/runtime/grounded-selection-observation.test.ts` checks the resolved dispatch identity.
- **The grounded synthesis step owns answer completeness.** The second
  (synthesis) provider call writes the user-visible answer, so it takes its
  output ceiling from `groundedSynthesisTokenCap`, which derives the budget from
  the resolved model descriptor via `createContextBudget` — never a flat
  constant. `LocalRuntimeExecutor` no longer passes a historical 512-token cap;
  an adapter-supplied `maxOutputTokens` still wins and the daemon stays uncapped.
  A `finishReason: "length"` stop is appended with an explicit truncation marker
  rather than returned as a finished answer. The synthesis prompt
  (`GROUNDED_SYNTHESIS_PROMPT`) requires enumerating every item for "list all"
  queries and must NOT invite the model to describe further retrieval it would
  need — that wording made models answer with a plan ("I'll fetch the page…")
  instead of an answer (session `1791828877329`).
- **Grounded retrieval is a bounded loop, not a single tool round.** The model
  chooses tools across at most `GROUNDED_MAX_TOOL_ROUNDS` rounds, one allowlisted
  call per round (`#760`: fan-out extras are ignored), with each result appended
  to the conversation so the next round can act on it. The synthesis call then
  receives EVERY collected result. This exists because the route was previously
  a hardcoded single round, so the model could only ever `search` and every
  external answer came from titles/URLs/snippets — a "list all X" question could
  not read article bodies (sessions `1791824290404`, `1791828877329`,
  `1791829878920` each called `web.search` and never `alix_web_fetch`). The
  `RETRIEVAL_SYSTEM_PROMPT` must therefore name BOTH tools and their distinct
  jobs: search FINDS pages, fetch READS them. Keep the round cap a hard bound;
  never widen the offered surface.
- **A repeated fetch inside one turn is served from cache.** `alix_web_fetch` is
  deduplicated by URL for the turn: a repeat reuses the first result instead of
  spending a round of the bounded budget. Models routinely re-fetch one URL with
  a different `maxLength`, which otherwise silently consumed the whole budget on
  a single page (session `1791833097742` spent two of three rounds that way).
- **Grounded synthesis never returns a non-answer.** A synthesis response is
  checked by `isNonSubstantiveSynthesis` (empty, plan-only, or leftover
  tool-call syntax) and replaced with an explicit insufficient-data sentence
  rather than shown as a result. A model that leaks a tool call as prose
  (`<dots_function_call>[name]{json}`, `[name]{json}`) is recovered by
  `extractLeakedToolCall`, dispatched against the OFFERED surface only, and
  re-synthesized exactly once — bounded, so leaked calls cannot spin an
  unbounded loop and cannot widen the tool surface. Pinned by
  `tests/runtime/grounded-synthesis.test.ts`.

## Work Guidance

- Adding a new source means adding a new block in `buildRuntimeIndex()` and adding the source string to the `RuntimeIndexEvent.source` union type.
- The API supports `?graphId=`, `?sessionId=`, `?approvalId=`, `?action=`, `?limit=`, `?order=` query params.

## Verification

- `tests/runtime/runtime-index.test.ts` — empty index, sources, merge, sort, filters.
- `tests/runtime/tool-scheduler.vitest.ts` — safe parallel overlap, exclusive/unknown/model-disabled serial execution, bounded chunking, independent governance.
- `tests/runtime/parallel-tool-execution.vitest.ts` — parallel calls retain execution, invocation, and tool-call correlation in events and model results.

## Child DOX Index

| Path | Scope |
|------|-------|
| `src/runtime-state/runtime/execution-state/AGENTS.md` | ExecutionState contract, projector, store |
| `src/runtime-state/runtime/state/AGENTS.md` | Governed patch-only transition harness — StateTransitionProposal → 10-gate → events → ExecutionState |
| `src/runtime-state/runtime/context/AGENTS.md` | State-aware prompt builder P+Σ+O+E+Tools, bounded tiers |
