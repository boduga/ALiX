# Planning Autonomy

## Overview
Run-lifecycle control for an agent session: a state machine that owns the `planning → executing → verifying → repairing → summarizing → stopped` progression and its hard budget counters, plus a scope tracker that decides whether a file mutation is inside the approved task scope or needs operator confirmation. Both expose snapshot serialization so a session can be resumed.

## Interface
- `RunLimits`, `RunCounters`, `StateSnapshot`, `RunResult` (`state-machine.ts`) — budget shape (`maxIterations`, `maxRepairs`, `maxFileChanges`, `maxShellCommands`, `maxRuntimeMs`) and persisted run snapshot/result shape [state-machine.ts:RunLimits]
- `RunLimiter.canTransition(from, to, ctx)` and `RunLimiter.checkCounter(limit, value)` — budget gate consulted on each transition [state-machine.ts:RunLimiter]
- `TaskStateMachine` — `currentState`, `snapshot`, `tick(runtimeMs)`, `recordFileChange()`, `recordShellCommand()`, `recordRepair()`, `toExecuting(scopeExpanded)`, `toVerifying(passed)`, `toRepairing()`, `toSummarizing()`, `stop(reason)`, `complete()`, `toJSON()`, `fromJSON(snapshot, limiter, onTransition?)` [state-machine.ts:TaskStateMachine]
- `TaskScope`, `AgentState`, `Expansion`, `ChangeEvaluation`, `ScopeSnapshot` — scope and state vocabulary [scope-tracker.ts:TaskScope]
- `ScopeTracker` — `pendingApproval`, `setInitialScope`, `getCurrentScope`, `checkMutation`, `approveScope`, `denyScope`, `setPending`, `checkExpansion`, `getExpansions`, `needsConfirmation`, `evaluateChange`, `confirmExpansion`, `toJSON`, `fromJSON` [scope-tracker.ts:ScopeTracker]
- `createScopeTracker(initialFiles, cwd)`, `extractInitialScope(args)` — scope construction helpers [scope-tracker.ts:createScopeTracker], [scope-tracker.ts:extractInitialScope]
- Free-function variants `checkMutation(path, scope)` and `approveScope(path, scope)` operate directly on a `TaskScope` [scope-tracker.ts:checkMutation], [scope-tracker.ts:approveScope]
- A second, unrelated `RunLimiter`/`RunLimits`/`RunCounters` set is declared in `run-limiter.ts` with a different shape (`maxSteps`, `maxCost`, `maxRetries`, `maxRuntimeSeconds`) and a different API (`check`, `getRemaining`, `getWarnings`, `isExpired`) [run-limiter.ts:RunLimiter]
- No subdirectories.

## Invariants
- A new `TaskStateMachine` starts in `planning` with all counters zero [state-machine.ts:TaskStateMachine]
- `tick` increments `iterations` and adds to `runtimeMs`; `recordRepair` is the only repair-counter writer and is called only by `toRepairing` [state-machine.ts:TaskStateMachine]
- `toExecuting` refuses with `scope_expansion_pending` whenever `scopeExpanded` is true, and only moves a machine that is in `planning` [state-machine.ts:TaskStateMachine]
- `toVerifying` only moves from `executing` or `repairing`; `toRepairing` only moves from `verifying` (and increments repairs on success) [state-machine.ts:TaskStateMachine]
- `stop` and `complete` both end in `stopped`; only the returned `RunResult.success` distinguishes hard stop from normal completion [state-machine.ts:TaskStateMachine]
- Limits with a value `<= 0` are treated as disabled by both limiter classes [state-machine.ts:RunLimiter], [run-limiter.ts:RunLimiter]
- `ScopeTracker.checkMutation` evaluates in a fixed order: approved → denied → in-scope → otherwise records `pendingApproval` and returns `scope_expansion` [scope-tracker.ts:ScopeTracker]
- With no scope, or with no files on the evaluated change, mutation is unconditionally allowed [scope-tracker.ts:ScopeTracker]
- A scope with `approvedAt` permits all further expansion without confirmation, and `confirmExpansion` clears accumulated expansions [scope-tracker.ts:ScopeTracker]
- `createScopeTracker` resolves relative initial files against `cwd` and pre-approves every initial file [scope-tracker.ts:createScopeTracker]
- The free-function `checkMutation`/`approveScope` pair mutates `scope.files` in place and does not track denied paths — it is not equivalent to the class [scope-tracker.ts:approveScope]
- The duplicate `RunLimiter` in `run-limiter.ts` is imported only by `tests/autonomy/run-limiter.test.ts`; production callers import the limiter from `state-machine.ts` [run-limiter.ts:RunLimiter]
- Snapshots round-trip: `toJSON` returns copies and `fromJSON` restores counters, approved/denied sets, and pending approval [scope-tracker.ts:ScopeTracker], [state-machine.ts:TaskStateMachine]

## Side Effects
- Clock reads: `Date.now()` in `isExpired` and `new Date().toISOString()` in `checkExpansion`/`confirmExpansion` [run-limiter.ts:RunLimiter], [scope-tracker.ts:ScopeTracker]
- Optional `onTransition(from, to, reason)` callback invoked on every accepted state change [state-machine.ts:TaskStateMachine]
- In-place mutation of a caller-supplied `TaskScope.files` by the free-function `approveScope` [scope-tracker.ts:approveScope]
- No disk, network, or lock access; persistence is done by the caller via `toJSON` snapshots [state-machine.ts:TaskStateMachine]

## Verification
- Run: `pnpm test`
