# DOX — Coordination

## Purpose

Owns delegated multi-agent execution: the graph runtime and scheduler (`kernel/`), the path-based write authority (`ownership/`), deterministic SOP packs (`sop/`), and the issue-lifecycle workflow kernel (`workflow/`). This document owns the contracts that span those subdirectories; each subdirectory's own `AGENTS.md` owns its internals.

## Ownership

- `src/coordination/kernel/AGENTS.md` — graph runtime, planner, scheduler, coordination tools, worker executors, liveness/recovery.
- `src/coordination/ownership/AGENTS.md` — ownership registry, leases, and the shared owned-scope matcher.
- `src/coordination/README.md` — subtree overview and the boundary between runtime orchestration and write authority.
- `src/coordination/sop/README.md`, `src/coordination/workflow/README.md` — SOP pack and workflow-kernel contracts.

## Local Contracts

- **Explicit coordination requests use the coordination runtime.** When the operator asks for a coordinated multi-agent, multi-worker, or parallel-worker run, the agent must call `alix_coordination_run`; ordinary parallel tool calls, direct edits, and sequential `alix_delegate` calls do not satisfy that request. Completion requires the coordination run id and per-worker outcomes.
- **Coordination approval authority is host-parity.** CLI-hosted coordination resolves the project-scoped approval store (`loadApprovalStore(cwd)`) into its `PolicyGate` through `buildCoordinationPolicyGate` (`src/interfaces/cli/commands/coordination.ts`), exactly as the daemon does — one durable authority, no second store or resolver. A store-less gate fails closed (`approval-store-missing`), and an approval-required verdict that names no durable approval id — including the `ExecutionAuthorization` legacy `"unknown"` sentinel — is denied, never surfaced as a pending approval. Owner: `src/governance/policy/AGENTS.md`.
- **Inspector execution endpoints.** `POST /api/coordination/run` and `POST /api/coordination/:runId/cancel` are the only execution POSTs: both require the `coordination:execute` permission (authenticated routes), pass through on loopback development per the global auth posture, and execute detached (the client polls the existing GET routes). Server close aborts in-flight runs and their worker children; Inspector-hosted runs are reclaimed and resumed on restart (dead `executionOwnerId` workers reset to pending under the run's original approval mode). No other HTTP route may execute agent actions.
- **Coordination completion.** A successful `alix_coordination_run` call alone cannot complete a session. `deriveCoordinationCompletion` requires terminal execution, generated aggregate, known outcome, and a `coordination.aggregate.completed` verification event matching run identity, `aggregateResultRef`, and source fingerprint. Resolve run identity from structured `coordinationRunId`, falling back to the result's run line; unresolved or missing evidence yields `completed_unverified`.
- **A non-terminal coordination run is never a success receipt.** `alix_coordination_run` derives completion from authoritative run state, not from the scheduler's stop reason: success requires a terminal `completed` execution AND a `verified` completion (aggregate attached with a matching durable `coordination.aggregate.completed` event). `stopReason: "idle"` is not evidence of completion — an interleaved retry/approval cycle can exhaust the idle budget while the run is still running. Every other state returns a non-success result and tags it `outcomeUnknown` (`ToolResult` in `src/capabilities/tools/types.ts`), which tells `ToolExecutor` to write NO execution receipt: the consumed claim stays `pending` (replay classifies `unverified`, fail-closed) instead of being promoted to `succeeded` or downgraded to a synthesized `failed`. Durable run/worker state is never rewritten, so the run stays resumable and a second run is not created.
- **Delegated mutation evidence.** `alix_coordination_run` counts only when it reports workspace changes derived from explicit worker mutation records or reported mutation paths. Worker success or prose alone is insufficient; writes remain evidence even if a worker later fails.
- **Worker recovery and owned writes.** `installParentLivenessWatchdog` terminates a child when its host dies. Reclaim through the single `shouldReclaimWorker` verdict: a provably dead execution owner, or an ownerless worker on a stale heartbeat (never a locally active or possibly-alive owner); reset workers to pending without incrementing attempts, and the next scheduler dispatch increments the attempt within its limit. `alix_file_create` succeeds for identical content. A worker may create or overwrite only inside its declared owned paths, and a broader capability permission never widens that grant. `PolicyGate`, the `ToolExecutor` (owned-scope gate for owned and continuation paths), and the `FileToolRouter` share `isWithinOwnedScope`, and all three ask `src/coordination/ownership/owned-scope-channels.ts` whether the requested channel can be constrained at all. A channel that cannot be enumerated against the scope is denied for scoped workers; read-only channels are unaffected. Adding a mutation channel means adding it to that one module, not to each enforcement point. Owners: `src/coordination/kernel/AGENTS.md`, `src/coordination/ownership/AGENTS.md`, and `src/governance/policy/AGENTS.md`.
- **Coordination cancellation.** Aborting `alix_coordination_run` cancels the scheduler run, workers, task graph, and ownership leases, then throws `ExecutionCancelledError`. Sweep dead-owner CLI runs before planning and release their leases. Cancellation failure remains cancellation but emits `coordination.cancel.failed`. Bind recorder inputs before cancellation sites; `createCancelFailureRecorder` receives its session id explicitly.
- **Coordination hosting.** Inspector hosts web/inspector runs; daemon services tick daemon runs; CLI processes own foreground runs. Restart recovery preserves persisted `sessionMode` and `maxConcurrency`, resumes provably dead owners, and reticks after approval resolution. Never tick another host's live run.
- **Model-supplied approval mode may tighten, never loosen.** `alix_coordination_run`'s `sessionMode` argument is model output; it can only make the run stricter than the host session mode (`ask` is the enforcing mode, so `auto`/`bypass` requests are ignored under an `ask` host). The effective mode is clamped before persistence because `run.sessionMode` is re-applied over host config on every tick and after restart. Operator-supplied modes (Inspector API body, CLI flag) are unaffected.
- **Single-output path recovery.** A write worker with exactly one owned path may omit the path in a valid `alix_file_create` call; the boundary supplies that sole path. Never rewrite explicit paths, ambiguous ownership, read-only workers, or malformed calls.
- **Worker tool and input identity.** Resolve only exact offered model-facing names to internal executor names; reject aliases, executor IDs, and unknown names. Dependent workers receive full workspace-relative producer output paths. Resolve a bare input basename only when it uniquely matches declared inputs; explicit and ambiguous paths remain supplied and pass workspace containment.
- **CLI coordination cleanup.** Foreground coordination installs SIGINT/SIGTERM handlers that cancel before exit and sweeps dead-owner CLI runs through `cancelDeadOwnerRuns` on startup.

## Work Guidance

- Add scheduler, worker, and store behavior to its owning `kernel/` module; keep coordination tool handlers thin over the scheduler and store.
- A new mutation channel enters `src/coordination/ownership/owned-scope-channels.ts` once; the gate, executor, and file router all read that module.
- Change an execution-endpoint or completion contract together with its HTTP route tests and the completion gates.

## Verification

- `tests/run/task-loop-coordination-completion.vitest.ts` — coordination completion evidence and non-terminal verdicts.
- `tests/cli/commands/coordination-approval-wiring.test.ts` — CLI approval-store host parity.
- `tests/server/coordination-post.test.ts`, `tests/server/coordination-conflict-routes.test.ts` — Inspector execution endpoints and conflict routes.
- `tests/agents/worker-executor-route-parity.vitest.ts`, `tests/agents/worker-route-claim-simulation.vitest.ts` — worker identity, scope, and route parity.
- `node --test tests/scripts/check-pr-scope.test.mjs` when a change adds or retires a top-level area.

## Child DOX Index

| Path | Scope |
|------|-------|
| `src/coordination/kernel/AGENTS.md` | Graph runtime — TaskGraph, GraphExecutor, projection, planner, scheduler, coordination tools, worker executors, liveness/recovery |
| `src/coordination/ownership/AGENTS.md` | Ownership claims and path-scope arithmetic — registry/lock and the owned-scope matcher shared by the policy gate and file router |
