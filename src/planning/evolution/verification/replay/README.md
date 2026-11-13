# Verification Replay

## Overview
Deterministic replay primitives for counterfactual verification. A logical clock replaces wall-clock advancement, a seeded mulberry32 PRNG replaces ambient randomness, a tick-driven scheduler orders queued work, and event-stream merging imposes a total order across parallel sources. `ReplayEngine` composes those controls around a caller-supplied executor and returns merged output events, accumulated metrics, typed errors, and the executed tick count.

## Interface
- `DeterministicEvent` carries `sourceId`, `tick`, `sequenceNumber`, and opaque `payload` `[deterministic-event-merge.ts:DeterministicEvent]`.
- `mergeEvents(streams)` copies and merges parallel event streams into one ordered array `[deterministic-event-merge.ts:mergeEvents]`.
- `compareEvents(a, b)` implements tick, then `sourceId`, then `sequenceNumber` ordering `[deterministic-event-merge.ts:compareEvents]`.
- `LogicalClockSnapshot` captures `currentTick` and `startTime` `[logical-clock.ts:LogicalClockSnapshot]`.
- `LogicalClock` exposes `tick`, `advance`, `now`, `getStartTime`, `reset`, `snapshot`, and `restore` `[logical-clock.ts:LogicalClock]`.
- `SeededPRNGSnapshot` captures `seed` and `state` `[seeded-prng.ts:SeededPRNGSnapshot]`.
- `SeededPRNG` exposes `next`, `nextInt`, `reset`, `getSeed`, `snapshot`, and `restore` using mulberry32 `[seeded-prng.ts:SeededPRNG]`.
- `ScheduledTask` carries `taskId`, `tick`, `priority`, and an `execute` callback `[deterministic-scheduler.ts:ScheduledTask]`.
- `DeterministicScheduler` exposes `schedule`, `drain`, `tickAndDrain`, `pending`, and `clear` `[deterministic-scheduler.ts:DeterministicScheduler]`.
- `ReplayEngineConfig` carries `seed`, informational `clockStart`, `environmentId`, `environmentHash`, and optional resource limits `[replay-engine.ts:ReplayEngineConfig]`.
- `ReplayError`, `ReplayResult`, `ReplayExecutor`, and `ReplayContext` define typed failures, the result envelope, the event-processing callback, and the per-event control context `[replay-engine.ts:ReplayError]` `[replay-engine.ts:ReplayResult]` `[replay-engine.ts:ReplayExecutor]` `[replay-engine.ts:ReplayContext]`.
- `ReplayEngine.execute(dataset, executor, inputStreams?)` runs a replay and returns a `ReplayResult` `[replay-engine.ts:ReplayEngine.execute]`.
- `ReplayEngine.configsEquivalent(a, b)` compares the determinism-relevant seed and environment hash `[replay-engine.ts:ReplayEngine.configsEquivalent]`.
- No child contract directories exist.

## Invariants
- Merged event order is tick ascending, then `sourceId` lexicographic ascending, then `sequenceNumber` ascending `[deterministic-event-merge.ts:compareEvents]`.
- `mergeEvents` clones each event and ignores stream entries that are not arrays `[deterministic-event-merge.ts:mergeEvents]`.
- The logical clock advances only through `tick()` or `advance()`; `now()` does not advance it `[logical-clock.ts:LogicalClock]`.
- `advance(steps)` requires a non-negative finite number, floors it, and leaves the tick unchanged when it throws `[logical-clock.ts:LogicalClock.advance]`.
- `LogicalClock.reset()` returns `currentTick` to zero while `startTime` remains the constructor anchor `[logical-clock.ts:LogicalClock.reset]` `[logical-clock.ts:LogicalClock.snapshot]`.
- `SeededPRNG` rejects a non-finite seed and coerces a finite seed to an unsigned 32-bit integer `[seeded-prng.ts:SeededPRNG]`.
- `nextInt(min, max)` requires finite bounds with `min <= max` `[seeded-prng.ts:SeededPRNG.nextInt]`.
- The scheduler executes tasks whose tick is at or before the current logical tick; future-tick tasks remain queued `[deterministic-scheduler.ts:DeterministicScheduler.drain]`.
- Ready tasks execute tick ascending, priority descending, then `taskId` ascending `[deterministic-scheduler.ts:compareTasks]`.
- `tickAndDrain()` advances exactly one tick before draining `[deterministic-scheduler.ts:DeterministicScheduler.tickAndDrain]`.
- `ReplayEngine` construction rejects a non-finite seed or an empty/whitespace `environmentId` or `environmentHash` `[replay-engine.ts:ReplayEngine.validateConfig]`.
- Replay merges input streams, advances the logical clock to each event tick, invokes the executor once per event, sums metric deltas, and advances one tick afterward `[replay-engine.ts:ReplayEngine.execute]`.
- An executor exception becomes a `ProposalExecutionFailure` carrying the current tick, and later events continue processing `[replay-engine.ts:ReplayEngine.execute]`.
- `configsEquivalent` requires both seed and environment hash to match `[replay-engine.ts:ReplayEngine.configsEquivalent]`.

## Side Effects
- `ReplayEngine.execute` invokes and awaits the caller-supplied `ReplayExecutor.processEvent` callback for each merged event `[replay-engine.ts:ReplayEngine.execute]`.
- `DeterministicScheduler.drain` invokes and awaits each ready task's `execute` callback `[deterministic-scheduler.ts:DeterministicScheduler.drain]`.
- The replay modules own no filesystem, network, environment, or process mutation `[replay-engine.ts:ReplayEngine.execute]` `[logical-clock.ts:LogicalClock]` `[seeded-prng.ts:SeededPRNG]`.

## Verification
- Run: `pnpm test`
