# TUI Evolution Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one read-only `evolution` tab to the existing ALiX TUI that projects the capability-evolution loop (A7 lifecycle → A8 learning → A9 forecasts/correlations → A2.5/A3 projected decisions → measurements → evidence) onto the existing `RuntimeSnapshot`, rendered as a capability-spine overview with stage-collapsed drill-down and a reference-by-id inspector.

**Architecture:** A self-driven `DurableProjectionBuilder` (`EvolutionProjection`) is registered on the runtime collector's `ProjectionRuntime` under a new `ProjectionIds.evolution`. Because governance/measurement events are `sessionId: ""` and the collector session-filters them out, the collector gains a generic **sessionless-event relay** (Q-C4) that delivers each cycle's newly-read sessionless events to the projection, which accumulates them (deduped by `event.seq`, durable via `exportState`). Each collector cycle the projection re-reads the forecasts/correlations/recommendations JSONL (Q-C3a), change-gates an A8 `LearningEngine.learn()` recompute on newly observed A8-relevant events (Q-C2), and assembles ONE immutable `EvolutionProjectionSnapshot` with a single `generatedAt`. The TUI view (`EvolutionView`, tab `evolution`) renders the capability spine with the locked keybindings and presentation caps.

**Tech Stack:** TypeScript (existing repo), existing `ProjectionRuntime`/`RuntimeCollector`/`RuntimeSnapshot` infra, existing A8/A9 read adapters, Vitest. No new runtime dependencies.

## Global Constraints

- **Scope (Q1-Q5):** Destination is the existing ALiX TUI. Full evolution loop in ONE new `evolution` tab (lifecycle → learning → forecast → decision → evidence). Read-only projection — governance mutation stays CLI → service → A2.5 → A3. `TAB_ORDER` grows by exactly one. No Web, no shared frontend layer.
- **Data seam (Q3):** Extend `RuntimeCollector`; NO second polling loop, NO duplicate collector, NO TUI-only daemon API. Collector reads through A7/A8/A9 read adapters; A7/A8/A9 stay authoritative.
- **Projection shape (Q-S1..S4):** `EvolutionProjectionSnapshot` = capability-rooted composite spine + bounded flat stage indexes + `EvolutionLink` index + ONE `generatedAt`. It is an association/read model over canonical artifacts — NEVER a new domain store, NEVER rewrites domain identities. Decisions derived from file-backed `recommendations.jsonl` via `recommendationKindToDecisionKind`; DTO = `recommendation` / `projectedDecision` / `targetState` — NEVER an authoritative `decisionRecord`, no invented A3 identity/timestamp/persistence. A8 learning recomputes `LearningEngine.learn()` live (transient; no `learning.jsonl`). Links reference-by-id: `forecast→recommendation`, `recommendation→decision` (PROJECTED), `decision→measurement`, `measurement→correlation`, `forecast→correlation`; no causality; many-to-many preserved; no primary; NO `forecast→measurement` edge without an A9Correlation.
- **Cadence (Q-C1..C3):** ONE coherent observation point per cycle — single `generatedAt` (collector-cycle timestamp via an injectable clock, never independently sampled); EventLog incremental + JSONL full re-read + A8 recompute in one cycle → one immutable snapshot. **empty ≠ unavailable ≠ stale** (no stale state in v1). A8 recompute change-gated on NEWLY OBSERVED events intersecting A8 adapter inputs (`capability.governance.proposal.*` + `capability.governance.measurement.measured`) — not any-event, not global cursor; last-successful result retained; relevant change + failure ⇒ A8 unavailable (never empty); later success restores. Full JSONL re-read each cycle (forecasts/correlations/recommendations); no file-stat gate, no race, no second change-tracking; file timestamps never used as freshness — `generatedAt` authoritative. NO per-stage `observedAt`/`computedAt`/`lastUpdatedAt`/`sourceTimestamp`. TUI says "Evolution as of T", never "14 seconds old".
- **Q-C4 (sessionless relay, LOCKED this plan):** `RuntimeCollectorOptions.sessionlessEvents?: (events: readonly AlixEvent[]) => void` — the collector relays each cycle's NEWLY READ `sessionId === ""` events to it (the subset the session filter would otherwise drop); session-matching events continue through `ProjectionRuntime.updateAll`. The collector never interprets event types and knows nothing of A8/A9/measurements. The relay receives ONLY newly read events for that cycle — never "all sessionless events". The evolution projection dedupes relayed events by `event.seq` and persists its accumulated sessionless evidence via `exportState()` so restart never re-applies or loses relayed events. No second polling loop, no second EventLog scan.
- **Layout (Q-L1..L4):** Landing = capability-spine overview (left capability list with compact risk markers + right selected-capability detail walking the loop), following the CapabilitiesView left-list/right-detail convention. Single vertically-scrollable spine, stage-collapsed; keys `↑↓`/`j/k` navigate, `Enter/→` expand the CURRENTLY SELECTED STAGE, `←/Esc` collapse, `f` flat index, `c` capability spine, `q` quit; no per-stage pseudo-tabs. **Two selection levels (Q-L2 correction LOCKED 2026-08-16): LEFT pane = capability cursor; RIGHT pane = stage cursor; an expanded stage has an artifact cursor; selecting an artifact opens the Q-L3 inspector. `Enter`/`→` always expands the stage the cursor is on — never a hardcoded default.** Stage status visually distinct (available/empty/unavailable); unavailable never renders as an empty section. Links render as canonical ids; selecting opens a read-only side-pane inspector showing the artifact + its other relationships — **never turn a relationship into ownership**. Decision renders exactly `RECOMMENDATION` / `PROJECTED DECISION` / `TARGET STATE`. Learning renders `LEARNING — N patterns (computed live)`; failure ⇒ UNAVAILABLE, empty ⇒ 0 patterns. Render caps are PRESENTATION limits, not projection truncation: collapsed stage `N artifacts`; expansion first 10 + `… +N more`; flat indexes 50/page.
- **A9 bridge (unchanged, as locked):** `forecast.subject == proposal.submitted.proposalId`; `forecast.subjectCapability == proposal.submitted.payload.candidate.target.id` (the `candidate` segment is REQUIRED — never `payload.target.id`); `proposal.executed` authorization gate; `CapabilityMeasurementPayload` contains NO `proposalId`, `sourceProposalIds`, `forecastId`, or `correlationId`; `measurement.capabilityId == forecast.subjectCapability`.
- **Store directory:** forecasts/correlations/recommendations JSONL under `join(process.cwd(), ".alix", "governance")` (the platform default).
- **Determinism:** `generatedAt` + A8 `learn(now)` use an injectable clock defaulting to `Date.now()`, captured once per snapshot cycle — never the TUI's render-time clock.

---

## File Structure

**New files:**
- `src/tui/runtime/evolution/evolution-projection-snapshot.ts` — `EvolutionProjectionSnapshot`, `StageStatus`, `StageState<T>`, spine/row/`EvolutionLink` types. Pure types, no logic.
- `src/tui/runtime/evolution/evolution-link-builder.ts` — `buildEvolutionLinks(args)`: pure link-index builder (5 kinds, many-to-many, no primary). Depends only on the snapshot types + decision mapping.
- `src/tui/runtime/evolution/evolution-snapshot-assembler.ts` — `assembleEvolutionSnapshot(inputs)`: pure read-model assembly (spine, stage states with empty≠unavailable). Depends on types + link builder.
- `src/tui/runtime/evolution/evolution-projection.ts` — `EvolutionProjection implements DurableProjectionBuilder<EvolutionProjectionSnapshot>`: sessionless ingest (seq-dedup), A8 change gate, async snapshot assembly, `exportState`/`importState`.
- `src/tui/evolution/evolution-view.ts` — `EvolutionView implements TuiView` (tab `evolution`): render + handleKey + lazy-init selection.
- `src/tui/evolution/evolution-render.ts` — pure render helpers: spine lines, stage-collapsed rows, inspector pane, render caps (10/+N more, 50/page).
- `src/tui/evolution/evolution-keys.ts` — pure key→action mapping (Q-L2 table).

**Modified files:**
- `src/tui/runtime-collector.ts` — `sessionlessEvents?` option + `splitSessionless` relay (Task 1).
- `src/tui/runtime/projection-ids.ts` — add `evolution: 'evolution'` (Task 2).
- `src/tui/runtime/projection-runtime.ts` — add `snapshotOfAsync<T>(id)` (Task 2).
- `src/tui/snapshot.ts` — add `evolution?: EvolutionProjectionSnapshot | null` to `RuntimeSnapshot` (Task 2).
- `src/tui/state.ts` — `TabId` + `evolution`, `TAB_ORDER`, `PerTabState` evolution fields, `createInitialPerTabState` (Task 6).
- `src/tui/views/index.ts` — import + register `EvolutionView` (Task 6).
- `src/cli/commands/tui.ts` — construct adapters + `LearningEngine` + `EvolutionProjection`, register on the runtime collector, wire `sessionlessEvents` relay (Task 8).

**Test files:**
- `tests/tui/runtime/runtime-collector-sessionless.vitest.ts` (Task 1)
- `tests/tui/runtime/runtime-collector-evolution.vitest.ts` (Task 2 — async-snapshot projection lands in `RuntimeSnapshot`)
- `tests/tui/runtime/evolution-link-builder.vitest.ts` (Task 3)
- `tests/tui/runtime/evolution-snapshot-assembler.vitest.ts` (Task 4)
- `tests/tui/runtime/evolution-projection.vitest.ts` (Task 5)
- `tests/tui/views/evolution-view.vitest.ts` (Task 6/7)
- `tests/tui/runtime/evolution-composition-root.vitest.ts` (Task 8)

---

### Task 1: Sessionless-event relay in RuntimeCollector (Q-C4 — blocking foundation)

**Files:**
- Modify: `src/tui/runtime-collector.ts`
- Test: `tests/tui/runtime/runtime-collector-sessionless.vitest.ts`

**Interfaces:**
- Produces: `splitSessionless(events: readonly AlixEvent[], sessionId: string): { readonly session: AlixEvent[]; readonly sessionless: AlixEvent[] }` — exported pure helper.
- Produces: `RuntimeCollectorOptions.sessionlessEvents?: (events: readonly AlixEvent[]) => void`.
- Consumes: `AlixEvent` from `../events/types.js`; existing `EventLogCursor`, `ProjectionCheckpointStore`, `ProjectionRuntime` opts.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tui/runtime/runtime-collector-sessionless.vitest.ts
import { describe, expect, it } from 'vitest';
import { splitSessionless } from '../../../src/tui/runtime-collector.js';

function ev(seq: number, sessionId: string): any {
  return { seq, sessionId, type: 'test.event', timestamp: '', payload: {} };
}

describe('splitSessionless', () => {
  it('partitions a batch into session-matching and sessionless events', () => {
    const batch = [ev(1, 'sess-1'), ev(2, ''), ev(3, 'sess-1'), ev(4, '')];
    const { session, sessionless } = splitSessionless(batch, 'sess-1');
    expect(session.map((e) => e.seq)).toEqual([1, 3]);
    expect(sessionless.map((e) => e.seq)).toEqual([2, 4]);
  });

  it('keeps the full batch when everything matches the session', () => {
    const batch = [ev(1, 'a'), ev(2, 'a')];
    const { session, sessionless } = splitSessionless(batch, 'a');
    expect(session).toHaveLength(2);
    expect(sessionless).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/runtime/runtime-collector-sessionless.vitest.ts`
Expected: FAIL — `splitSessionless` is not exported (module resolution error).

- [ ] **Step 3: Implement `splitSessionless` + relay option**

In `src/tui/runtime-collector.ts`, add to `RuntimeCollectorOptions` (after `projectionRuntime`):

```ts
/**
 * Q-C4 — optional sessionless-event relay. Each sample, the collector delivers
 * ONLY this cycle's newly-read `sessionId === ""` events (the ones the session
 * filter would otherwise drop) to this callback. The collector never interprets
 * event types — the caller decides what the events mean. When absent,
 * sessionless events are dropped as today.
 */
sessionlessEvents?: (events: readonly AlixEvent[]) => void;
```

Store it on the instance (constructor, near `this.projectionRuntime = opts.projectionRuntime`):

```ts
private readonly sessionlessEvents?: (events: readonly AlixEvent[]) => void;
// ...
this.sessionlessEvents = opts.sessionlessEvents;
```

Add the exported pure helper at the bottom of the file (after `computeWorkflow`):

```ts
/** Q-C4 — partition a read batch into session-matching events (delivered to
 *  the projections) and sessionless events (`sessionId === ""`, which the
 *  session filter would otherwise drop). The sessionless half is relayed to
 *  the optional `sessionlessEvents` callback so session-less governance /
 *  measurement events can feed the evolution projection. */
export function splitSessionless(
  events: readonly AlixEvent[],
  sessionId: string,
): { readonly session: AlixEvent[]; readonly sessionless: AlixEvent[] } {
  const session: AlixEvent[] = [];
  const sessionless: AlixEvent[] = [];
  for (const e of events) {
    (e.sessionId === sessionId ? session : sessionless).push(e);
  }
  return { session, sessionless };
}
```

- [ ] **Step 4: Wire the relay into `sample()`**

In `sample()`, replace:

```ts
const sessionBatch = batch.events.filter((e) => e.sessionId === this.sessionId);
this.projectionRuntime.updateAll(sessionBatch);
```

with:

```ts
// Q-C4 — split the freshly-read batch: session-matching events go to the
// projections; sessionless events (`sessionId === ""`) go to the optional
// relay. The relay receives ONLY this cycle's newly-read events — the caller
// dedupes across cycles/restarts.
const { session: sessionBatch, sessionless } = splitSessionless(batch.events, this.sessionId);
this.projectionRuntime.updateAll(sessionBatch);
this.sessionlessEvents?.(sessionless);
```

Update the `sample()` doc comment's "Session filter FIRST" block to mention the split. Do NOT touch checkpoint logic, the D5/D5a commit ordering, or the `nextCache` assembly (Task 2).

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/tui/runtime/runtime-collector-sessionless.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Add collector-level relay contract tests**

In the same test file, use the existing collector test harness pattern from `tests/tui/runtime/` (fake `EventLog` with `readSince`, fake `ProjectionCheckpointStore`, a `ProjectionRuntime` with a dummy builder) to assert:

- A collector constructed WITHOUT `sessionlessEvents` never calls it; session-matching events still reach `updateAll` (existing behavior preserved).
- A collector WITH `sessionlessEvents` calls it once per sample with exactly the current batch's `sessionId === ""` events.
- Sessionless events NEVER reach `updateAll`.
- When the checkpoint save rejects, the next sample re-reads the same batch and the relay is called AGAIN with the same sessionless events (the collector's contract is "relay every newly-read batch"; the consumer dedupes — Task 5).

- [ ] **Step 7: Run the full test file + collector regression**

Run: `pnpm vitest run tests/tui/runtime/runtime-collector-sessionless.vitest.ts`
Expected: PASS.

Run: `pnpm vitest run tests/tui/runtime/ tests/tui/app.vitest.ts`
Expected: PASS (existing collector/dashboard behavior unchanged).

- [ ] **Step 8: Commit**

```bash
git add src/tui/runtime-collector.ts tests/tui/runtime/runtime-collector-sessionless.vitest.ts
git commit -m "feat(tui): Q-C4 sessionless-event relay on RuntimeCollector"
```

---

### Task 2: Evolution projection registration seam (async snapshot flow — blocking foundation)

**Files:**
- Modify: `src/tui/runtime/projection-ids.ts`
- Modify: `src/tui/runtime/projection-runtime.ts`
- Modify: `src/tui/snapshot.ts`
- Modify: `src/tui/runtime-collector.ts`
- Test: `tests/tui/runtime/runtime-collector-evolution.vitest.ts`

**Interfaces:**
- Consumes: `EvolutionProjectionSnapshot` from `./runtime/evolution/evolution-projection-snapshot.js` (defined in Task 3).
- Produces: `ProjectionIds.evolution = 'evolution'`.
- Produces: `ProjectionRuntime.snapshotOfAsync<TSnapshot>(id): Promise<TSnapshot | undefined>`.
- Produces: `RuntimeSnapshot.evolution?: EvolutionProjectionSnapshot | null`.

> **Ordering note:** Task 3 defines the real `EvolutionProjectionSnapshot` type. Land Task 3's type file (Step 1 of Task 3) before Task 2, so Task 2's import resolves. The plan is written with this order in mind.

- [ ] **Step 1: Write the failing test**

```ts
// tests/tui/runtime/runtime-collector-evolution.vitest.ts
import { describe, expect, it } from 'vitest';
import { ProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';

class AsyncSnapBuilder {
  async snapshot(): Promise<{ generatedAt: number }> {
    return { generatedAt: 42 };
  }
  update(): void {}
  reset(): void {}
}

describe('ProjectionRuntime.snapshotOfAsync', () => {
  it('awaits an async builder snapshot', async () => {
    const rt = new ProjectionRuntime();
    rt.register(ProjectionIds.evolution, new AsyncSnapBuilder() as any);
    await expect(rt.snapshotOfAsync(ProjectionIds.evolution)).resolves.toEqual({ generatedAt: 42 });
  });

  it('returns undefined for an unregistered id', async () => {
    const rt = new ProjectionRuntime();
    await expect(rt.snapshotOfAsync('evolution')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/runtime/runtime-collector-evolution.vitest.ts`
Expected: FAIL — `snapshotOfAsync` does not exist.

- [ ] **Step 3: Add `ProjectionIds.evolution`**

In `src/tui/runtime/projection-ids.ts`:

```ts
export const ProjectionIds = {
  timeline: 'timeline',
  trace: 'trace',
  approval: 'approval',
  capability: 'capability',
  metrics: 'metrics',
  context: 'context',
  evolution: 'evolution',
} as const;
```

- [ ] **Step 4: Add `snapshotOfAsync` to `ProjectionRuntime`**

In `src/tui/runtime/projection-runtime.ts`, after `snapshotOf`:

```ts
/** Await-able snapshot extraction. A builder whose `snapshot()` returns a
 *  Promise (an I/O-backed projection like evolution) is awaited; a sync
 *  builder resolves immediately. Unregistered ids return undefined. */
async snapshotOfAsync<TSnapshot>(id: string): Promise<TSnapshot | undefined> {
  const builder = this.byId.get(id.trim());
  if (!builder) return undefined;
  const snap = builder.snapshot();
  return snap instanceof Promise ? await snap : snap;
}
```

- [ ] **Step 5: Add `evolution` field to `RuntimeSnapshot`**

In `src/tui/snapshot.ts`, import the snapshot type and add after `context` (line ~129):

```ts
import type { EvolutionProjectionSnapshot } from './runtime/evolution/evolution-projection-snapshot.js';
// ...
  /**
   * Evolution-loop projection (A7 lifecycle → A8 learning → A9 forecasts /
   * correlations → A2.5/A3 projected decisions → measurements). Null when the
   * projection isn't registered (e.g. older collectors).
   */
  readonly evolution?: EvolutionProjectionSnapshot | null;
```

- [ ] **Step 6: Collect the evolution snapshot in `sample()`**

In `src/tui/runtime-collector.ts`, in `nextCache` assembly (line ~244), add after `context:`:

```ts
        evolution: (await this.projectionRuntime.snapshotOfAsync<EvolutionProjectionSnapshot>(ProjectionIds.evolution)) ?? null,
```

Add the imports: `import { ProjectionIds } from './runtime/projection-ids.js';` (already imported) and `import type { EvolutionProjectionSnapshot } from './runtime/evolution/evolution-projection-snapshot.js';`.

Note: chat/agent collectors also build `nextCache` via the same `sample()` — their evolution projection is unregistered, so `snapshotOfAsync` returns undefined and the field is `null`. This is expected.

- [ ] **Step 7: Run the tests**

Run: `pnpm vitest run tests/tui/runtime/runtime-collector-evolution.vitest.ts tests/tui/runtime/runtime-collector-sessionless.vitest.ts tests/tui/runtime/`
Expected: PASS (existing runtime tests unaffected).

- [ ] **Step 8: Commit**

```bash
git add src/tui/runtime/projection-ids.ts src/tui/runtime/projection-runtime.ts src/tui/snapshot.ts src/tui/runtime-collector.ts tests/tui/runtime/runtime-collector-evolution.vitest.ts
git commit -m "feat(tui): evolution projection registration seam (ProjectionIds.evolution + snapshotOfAsync)"
```

---

### Task 3: Evolution snapshot contract + link index (pure types + reference-by-id links)

**Files:**
- Create: `src/tui/runtime/evolution/evolution-projection-snapshot.ts`
- Create: `src/tui/runtime/evolution/evolution-link-builder.ts`
- Test: `tests/tui/runtime/evolution-link-builder.vitest.ts`

**Interfaces:**
- Produces: all snapshot types below (`StageStatus`, `StageState<T>`, `EvolutionProjectionSnapshot`, row types, `EvolutionLink`, `EvolutionLinkKind`, `EvolutionNodeType`) and `buildEvolutionLinks(args): readonly EvolutionLink[]`.
- Consumes: `A9Forecast`, `A9Correlation` from `../../evolution/a9/contracts/a9-contract.js`; `GovernanceRecommendation` from `../../evolution/governance/contracts/recommendation-contract.js`; `recommendationKindToDecisionKind` from `../../evolution/governance/decision-engine.js`; `LifecycleState` from `../../capability/capability-evolution-types.js`; `LearningFinding` from `../../evolution/learning/contracts/learning-contract.js`.
- Consumed by: Task 2 (import), Task 4 (assembler), Task 5 (projection), Task 7 (view).

- [ ] **Step 1: Define the snapshot contract**

`src/tui/runtime/evolution/evolution-projection-snapshot.ts`:

```ts
/**
 * Evolution-loop projection snapshot (locked Q-S1..S4, Q-C3b).
 *
 * ONE immutable read model per collector cycle: a single `generatedAt`, a
 * capability-rooted spine, flat stage states, and a reference-by-id link
 * index. This is an ASSOCIATION layer over canonical artifacts (A7/A8/A9/
 * A2.5/measurements) — never a new domain store; domain identities are never
 * rewritten; no per-stage timestamps.
 */
import type { A9Correlation, A9Forecast } from '../../../evolution/a9/contracts/a9-contract.js';
import type { GovernanceRecommendation } from '../../../evolution/verification/contracts/recommendation-contract.js';
import type { GovernanceDecisionKind } from '../../../evolution/governance/contracts/decision-contract.js';
import type { LifecycleState } from '../../../adaptation/capability-evolution-types.js';
import type { LearningFinding } from '../../../evolution/learning/contracts/learning-contract.js';

/** Q-C3b — stage health. empty ≠ unavailable (a healthy source with zero
 *  artifacts is 'empty'; a failed source is 'unavailable', never a falsely
 *  complete zero). No 'stale' state in v1. */
export type StageStatus = 'available' | 'empty' | 'unavailable';

export interface StageState<T> {
  readonly status: StageStatus;
  /** Canonical artifacts for this stage. ALWAYS empty when status !== 'available'. */
  readonly items: readonly T[];
}

/** A7 lifecycle row (canonical registry state, eligibility is a pure lookup). */
export interface LifecycleRow {
  readonly capabilityId: string;
  readonly state: LifecycleState;
  readonly eligible: boolean;
}

/** A9 forecast row — canonical `forecastId` + minimal presentation fields. */
export interface ForecastRow {
  readonly forecastId: string;
  readonly kind: string;
  readonly band: string;
  readonly confidence: number;
  readonly subject: string;
  readonly subjectCapability: string;
}

/** A8 learning pattern row — canonical `findingId` + presentation fields. */
export interface LearningPatternRow {
  readonly findingId: string;
  readonly kind: string;
  readonly occurrences: number;
  readonly summary: string;
}

/** Q-S2/Q-L4a — a projected decision. Derived from a canonical A2.5
 *  recommendation via `recommendationKindToDecisionKind`; NEVER an
 *  authoritative A3 decisionRecord; no invented A3 identity/timestamp.
 *  Keyed by the canonical `recommendationId`; `projectedDecision`/`targetState`
 *  are null when the recommendation maps to no decision (e.g. ESCALATE). */
export interface DecisionRow {
  readonly recommendationId: string;
  readonly recommendationKind: string;
  readonly proposalId: string;
  readonly confidence: number;
  readonly projectedDecision: GovernanceDecisionKind | null;
  readonly targetState: 'APPROVED' | 'REJECTED' | 'UNDER_REVIEW' | null;
}

/** A5 measurement row — canonical `measurementId` (the EventLog event UUID).
 *  MUST NOT carry proposalId / sourceProposalIds / forecastId / correlationId
 *  (sentinel: CapabilityMeasurementPayload has none). */
export interface MeasurementRow {
  readonly measurementId: string;
  readonly capabilityId: string;
  readonly recordedAt: string;
  readonly status: string;
  readonly outcomeKind: string;
  readonly confidence: number;
}

/** A9 correlation row — canonical ids, the bridge between a forecast and a
 *  measurement. */
export interface CorrelationRow {
  readonly correlationId: string;
  readonly forecastId: string;
  readonly measurementId: string;
  readonly delta: string;
  readonly band: string;
  readonly forecastBand: string;
}

/** Q-S1 — capability-rooted composite spine entry. */
export interface CapabilitySpineEntry {
  readonly capabilityId: string;
  readonly lifecycle: LifecycleRow | null;
  readonly learning: StageState<LearningPatternRow>;
  readonly forecasts: StageState<ForecastRow>;
  readonly decisions: StageState<DecisionRow>;
  readonly measurements: StageState<MeasurementRow>;
  readonly correlations: StageState<CorrelationRow>;
}

/** Q-S4 — reference-by-id link. Direction carries NO causality; many-to-many is
 *  preserved (no primary designation). */
export type EvolutionLinkKind =
  | 'forecast→recommendation'
  | 'recommendation→decision'
  | 'decision→measurement'
  | 'measurement→correlation'
  | 'forecast→correlation';
export type EvolutionNodeType = 'forecast' | 'recommendation' | 'decision' | 'measurement' | 'correlation';
export interface EvolutionLink {
  readonly from: string;
  readonly fromType: EvolutionNodeType;
  readonly to: string;
  readonly toType: EvolutionNodeType;
  readonly kind: EvolutionLinkKind;
}

/** Q-S1/Q-C3b — one generatedAt + flat stage states + spine + link index. */
export interface EvolutionProjectionSnapshot {
  readonly generatedAt: number;
  readonly stages: {
    readonly lifecycle: StageState<LifecycleRow>;
    readonly learning: StageState<LearningPatternRow>;
    readonly forecasts: StageState<ForecastRow>;
    readonly decisions: StageState<DecisionRow>;
    readonly measurements: StageState<MeasurementRow>;
    readonly correlations: StageState<CorrelationRow>;
  };
  readonly spine: readonly CapabilitySpineEntry[];
  readonly links: readonly EvolutionLink[];
}
```

> **Note:** a separate `flatIndexes` field is intentionally omitted from v1 — the locked "bounded flat stage indexes" are satisfied by `stages` (flat per-stage artifact sets) plus the renderer's flat view (Task 7) which derives from `stages`. YAGNI; add `flatIndexes` only if the flat view needs distinct data.

- [ ] **Step 2: Write the failing link-builder test**

`tests/tui/runtime/evolution-link-builder.vitest.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildEvolutionLinks } from '../../../src/tui/runtime/evolution/evolution-link-builder.js';

const forecast = { forecastId: 'forecast-1', subject: 'proposal-1', subjectCapability: 'cap-a' } as any;
const forecast2 = { forecastId: 'forecast-2', subject: 'proposal-1', subjectCapability: 'cap-a' } as any;
const rec = (id: string, proposalId: string, kind = 'APPROVE') => ({
  recommendationId: id, evidenceId: 'e', proposalId, kind, confidence: 0.5, reasoning: '', supportingEvidence: [], risks: [], createdAt: '',
}) as any;
const measurement = { measurementId: 'measurement-1', eventId: '1', capabilityId: 'cap-a', recordedAt: '', status: 'pass', outcomeKind: 'effective', confidence: 0.9 } as any;
const correlation = { correlationId: 'corr-1', forecastId: 'forecast-1', measurementId: 'measurement-1' } as any;

describe('buildEvolutionLinks', () => {
  it('emits forecast→recommendation for shared proposalId, many-to-many', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast, forecast2],
      recommendations: [rec('rec-1', 'proposal-1'), rec('rec-2', 'proposal-1')],
      measurements: [], correlations: [], proposalTargets: { 'proposal-1': 'cap-a' },
    });
    const fr = links.filter((l) => l.kind === 'forecast→recommendation');
    expect(fr).toHaveLength(4); // 2 forecasts × 2 recommendations
    expect(fr.every((l) => l.fromType === 'forecast' && l.toType === 'recommendation')).toBe(true);
  });

  it('emits recommendation→decision (PROJECTED) only for mappable kinds', () => {
    const links = buildEvolutionLinks({
      forecasts: [], recommendations: [rec('rec-1', 'p', 'RISK_GATED_REVIEW'), rec('rec-2', 'p', 'ESCALATE')],
      measurements: [], correlations: [], proposalTargets: {},
    });
    const rd = links.filter((l) => l.kind === 'recommendation→decision');
    expect(rd.map((l) => l.from)).toEqual(['rec-1']);
  });

  it('emits decision→measurement via the proposal target capability', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast], recommendations: [rec('rec-1', 'proposal-1', 'APPROVE')],
      measurements: [measurement], correlations: [],
      proposalTargets: { 'proposal-1': 'cap-a' },
    });
    const dm = links.filter((l) => l.kind === 'decision→measurement');
    expect(dm).toHaveLength(1);
    expect(dm[0]).toMatchObject({ from: 'rec-1', fromType: 'decision', to: 'measurement-1', toType: 'measurement' });
  });

  it('emits forecast→correlation and measurement→correlation per correlation; NO direct forecast→measurement edge', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast], recommendations: [], measurements: [measurement], correlations: [correlation],
      proposalTargets: {},
    });
    expect(links.filter((l) => l.kind === 'forecast→correlation')).toHaveLength(1);
    expect(links.filter((l) => l.kind === 'measurement→correlation')).toHaveLength(1);
    expect(links.filter((l) => l.fromType === 'forecast' && l.toType === 'measurement')).toHaveLength(0);
  });

  it('never designates a primary or collapses many-to-many', () => {
    const links = buildEvolutionLinks({
      forecasts: [forecast, forecast2], recommendations: [], measurements: [measurement],
      correlations: [
        { ...correlation, correlationId: 'corr-1' },
        { ...correlation, correlationId: 'corr-2', forecastId: 'forecast-2' },
      ],
      proposalTargets: {},
    });
    // measurement-1 appears in two correlations — both edges present.
    const mc = links.filter((l) => l.kind === 'measurement→correlation');
    expect(mc.map((l) => l.to)).toEqual(['corr-1', 'corr-2']);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/runtime/evolution-link-builder.vitest.ts`
Expected: FAIL — `buildEvolutionLinks` not exported.

- [ ] **Step 4: Implement the link builder**

`src/tui/runtime/evolution/evolution-link-builder.ts`:

```ts
/** Q-S4 — reference-by-id evolution link index. Links are projection metadata
 *  (association), NEVER domain state; direction carries no causality;
 *  many-to-many preserved; no primary. NO forecast→measurement edge is ever
 *  emitted without an A9Correlation (the correlation is the bridge). */
import type { A9Correlation, A9Forecast } from '../../evolution/a9/contracts/a9-contract.js';
import type { GovernanceRecommendation } from '../../evolution/governance/contracts/recommendation-contract.js';
import { recommendationKindToDecisionKind } from '../../evolution/governance/decision-engine.js';
import type { EvolutionLink } from './evolution-projection-snapshot.js';

export interface BuildEvolutionLinksArgs {
  readonly forecasts: ReadonlyArray<A9Forecast>;
  readonly recommendations: ReadonlyArray<GovernanceRecommendation>;
  readonly measurements: ReadonlyArray<{ readonly measurementId: string; readonly capabilityId: string }>;
  readonly correlations: ReadonlyArray<A9Correlation>;
  /** proposalId → target capabilityId (derived from relayed
   *  proposal.submitted payloads; canonical two-hop bridge). */
  readonly proposalTargets: Readonly<Record<string, string>>;
}

export function buildEvolutionLinks(args: BuildEvolutionLinksArgs): readonly EvolutionLink[] {
  const links: EvolutionLink[] = [];
  const { forecasts, recommendations, measurements, correlations, proposalTargets } = args;

  // forecast→recommendation (shared proposalId; many-to-many).
  for (const f of forecasts) {
    for (const r of recommendations) {
      if (r.proposalId !== f.subject) continue;
      links.push({ from: f.forecastId, fromType: 'forecast', to: r.recommendationId, toType: 'recommendation', kind: 'forecast→recommendation' });
    }
  }

  // recommendation→decision (PROJECTED — keyed by the canonical recommendationId).
  for (const r of recommendations) {
    if (!recommendationKindToDecisionKind(r.kind)) continue;
    links.push({ from: r.recommendationId, fromType: 'recommendation', to: r.recommendationId, toType: 'decision', kind: 'recommendation→decision' });
  }

  // decision→measurement (recommendation's proposal target capability ↔ measurements).
  for (const r of recommendations) {
    if (!recommendationKindToDecisionKind(r.kind)) continue;
    const target = proposalTargets[r.proposalId];
    if (!target) continue;
    for (const m of measurements) {
      if (m.capabilityId !== target) continue;
      links.push({ from: r.recommendationId, fromType: 'decision', to: m.measurementId, toType: 'measurement', kind: 'decision→measurement' });
    }
  }

  // correlations are the ONLY bridge between forecasts and measurements.
  for (const c of correlations) {
    links.push({ from: c.forecastId, fromType: 'forecast', to: c.correlationId, toType: 'correlation', kind: 'forecast→correlation' });
    links.push({ from: c.measurementId, fromType: 'measurement', to: c.correlationId, toType: 'correlation', kind: 'measurement→correlation' });
  }

  return links;
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/tui/runtime/evolution-link-builder.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Verify the Task 2 seam test resolves the real type**

Run: `pnpm vitest run tests/tui/runtime/runtime-collector-evolution.vitest.ts`
Expected: PASS — `EvolutionProjectionSnapshot` import now resolves to the real type file.

- [ ] **Step 7: Commit**

```bash
git add src/tui/runtime/evolution/evolution-projection-snapshot.ts src/tui/runtime/evolution/evolution-link-builder.ts tests/tui/runtime/evolution-link-builder.vitest.ts
git commit -m "feat(tui): evolution snapshot contract + reference-by-id link index"
```

---

### Task 4: Pure snapshot assembler (spine, empty≠unavailable, derived decisions)

**Files:**
- Create: `src/tui/runtime/evolution/evolution-snapshot-assembler.ts`
- Test: `tests/tui/runtime/evolution-snapshot-assembler.vitest.ts`

**Interfaces:**
- Consumes: all types from `./evolution-projection-snapshot.js`; `buildEvolutionLinks` from `./evolution-link-builder.js`; `recommendationKindToDecisionKind` + `decisionKindToTargetState` from `../../evolution/governance/decision-engine.js`; `A9Forecast`, `A9Correlation`, `GovernanceRecommendation`, `LearningProposal`, `LearningFinding`.
- Produces: `StageInput<T>`, `MeasurementRecord`, `EvolutionAssemblerInputs`, `learningCapabilityId(finding)`, `assembleEvolutionSnapshot(inputs): EvolutionProjectionSnapshot`.
- Consumed by: Task 5 (projection calls `assembleEvolutionSnapshot`), Task 7 (view reads rows).

- [ ] **Step 1: Write the failing test**

`tests/tui/runtime/evolution-snapshot-assembler.vitest.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assembleEvolutionSnapshot } from '../../../src/tui/runtime/evolution/evolution-snapshot-assembler.js';

// Minimal canonical-artifact fixtures (A9/A2.5-shaped).
const forecast = {
  forecastId: 'forecast-1', forecastVersion: 1,
  subject: 'proposal-1', subjectCapability: 'cap-a',
  prediction: { kind: 'trust-velocity', band: 'high', internalScore: 70 },
  horizon: { from: '2026-08-01T00:00:00.000Z', to: '2026-08-31T00:00:00.000Z' },
  confidence: 0.8,
  provenance: { generatedAt: '2026-08-15T00:00:00.000Z', generatorVersion: '1', evidenceRefs: [] },
} as const;
const recommendation = {
  recommendationId: 'rec-1', evidenceId: 'e1', proposalId: 'proposal-1',
  kind: 'RISK_GATED_REVIEW', confidence: 0.7, reasoning: 'r', supportingEvidence: [], risks: [],
  createdAt: '2026-08-15T00:00:00.000Z',
} as const;
const measurement = {
  measurementId: 'measurement-1', eventId: '1', capabilityId: 'cap-a',
  recordedAt: '2026-08-10T00:00:00.000Z', status: 'pass', outcomeKind: 'effective', confidence: 0.9,
} as const;
const correlation = {
  correlationId: 'corr-1', correlationVersion: 1, forecastId: 'forecast-1', measurementId: 'measurement-1',
  foreignProvenance: { proposalId: 'proposal-1' },
  resolution: { band: 'high', forecastBand: 'high', delta: 'match' },
} as const;

const inputs = (overrides: Record<string, unknown> = {}) => ({
  generatedAt: 1_700_000_000_000,
  lifecycle: { records: [{ capabilityId: 'cap-a', state: 'active', eligible: true }], status: 'available' },
  learning: { result: null, unavailable: false },
  forecasts: { records: [forecast], status: 'available' },
  correlations: { records: [correlation], status: 'available' },
  recommendations: { records: [recommendation], status: 'available' },
  measurements: { records: [measurement], status: 'available' },
  proposalTargets: { 'proposal-1': 'cap-a' },
  ...overrides,
});

describe('assembleEvolutionSnapshot', () => {
  it('assembles the capability spine rooted at the measured capability', () => {
    const snap = assembleEvolutionSnapshot(inputs());
    expect(snap.generatedAt).toBe(1_700_000_000_000);
    expect(snap.spine.map((s) => s.capabilityId)).toEqual(['cap-a']);
    expect(snap.spine[0]!.forecasts.items.map((f) => f.forecastId)).toEqual(['forecast-1']);
    expect(snap.spine[0]!.measurements.items.map((m) => m.measurementId)).toEqual(['measurement-1']);
    expect(snap.spine[0]!.decisions.items.map((d) => d.recommendationId)).toEqual(['rec-1']);
  });

  it('derives decision rows as recommendation/projectedDecision/targetState', () => {
    const snap = assembleEvolutionSnapshot(inputs());
    const d = snap.stages.decisions.items[0]!;
    expect(d.recommendationId).toBe('rec-1');
    expect(d.recommendationKind).toBe('RISK_GATED_REVIEW');
    expect(d.projectedDecision).toBe('REQUEST_MORE_EVIDENCE');
    expect(d.targetState).toBe('UNDER_REVIEW');
  });

  it('maps an unmapped recommendation kind to a null projected decision', () => {
    const snap = assembleEvolutionSnapshot(inputs({
      recommendations: { records: [{ ...recommendation, kind: 'ESCALATE' }], status: 'available' },
    }));
    const d = snap.stages.decisions.items[0]!;
    expect(d.projectedDecision).toBeNull();
    expect(d.targetState).toBeNull();
  });

  it('treats empty != unavailable', () => {
    const empty = assembleEvolutionSnapshot(inputs({ forecasts: { records: [], status: 'empty' } }));
    expect(empty.stages.forecasts.status).toBe('empty');
    const unavailable = assembleEvolutionSnapshot(inputs({ forecasts: { records: [], status: 'unavailable' } }));
    expect(unavailable.stages.forecasts.status).toBe('unavailable');
    // Items are ALWAYS empty unless status is 'available'.
    expect(unavailable.stages.forecasts.items).toHaveLength(0);
  });

  it('shows learning as empty for a successful recompute with zero patterns', () => {
    const snap = assembleEvolutionSnapshot(inputs({ learning: { result: { proposalId: 'p', generatedAt: '', findings: [] }, unavailable: false } }));
    expect(snap.stages.learning.status).toBe('empty');
  });

  it('shows learning as unavailable when recompute failed', () => {
    const snap = assembleEvolutionSnapshot(inputs({ learning: { result: null, unavailable: true } }));
    expect(snap.stages.learning.status).toBe('unavailable');
    expect(snap.stages.learning.items).toHaveLength(0);
  });

  it('associates findings to capabilities (identityKey = capabilityId or fingerprint suffix)', () => {
    const snap = assembleEvolutionSnapshot(inputs({
      learning: {
        result: { proposalId: 'p', generatedAt: '', findings: [
          { findingId: 'f1', kind: 'underperformer', identityKey: 'cap-a', evidenceWindow: { from: '', to: '' }, occurrences: 2, evidenceRefs: [], summary: 's' },
        ] },
        unavailable: false,
      },
    }));
    expect(snap.spine[0]!.learning.items.map((f) => f.findingId)).toEqual(['f1']);
  });

  it('emits the link index (forecast→recommendation and correlation bridges)', () => {
    const snap = assembleEvolutionSnapshot(inputs());
    expect(snap.links.filter((l) => l.kind === 'forecast→recommendation')).toHaveLength(1);
    expect(snap.links.filter((l) => l.kind === 'forecast→correlation')).toHaveLength(1);
    expect(snap.links.filter((l) => l.kind === 'measurement→correlation')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/runtime/evolution-snapshot-assembler.vitest.ts`
Expected: FAIL — `assembleEvolutionSnapshot` not exported.

- [ ] **Step 3: Implement the assembler**

`src/tui/runtime/evolution/evolution-snapshot-assembler.ts`:

```ts
/** Pure read-model assembly: canonical artifacts + source health → one
 *  immutable EvolutionProjectionSnapshot (Q-S1..S4, Q-C3b). Never a domain
 *  store; never rewrites canonical identities. */
import type { A9Correlation, A9Forecast } from '../../../evolution/a9/contracts/a9-contract.js';
import type { GovernanceRecommendation } from '../../../evolution/verification/contracts/recommendation-contract.js';
import { decisionKindToTargetState, recommendationKindToDecisionKind } from '../../../evolution/governance/decision-engine.js';
import type { LearningFinding, LearningProposal } from '../../../evolution/learning/contracts/learning-contract.js';
import { buildEvolutionLinks } from './evolution-link-builder.js';
import type {
  CapabilitySpineEntry,
  CorrelationRow,
  DecisionRow,
  EvolutionProjectionSnapshot,
  ForecastRow,
  LearningPatternRow,
  LifecycleRow,
  MeasurementRow,
  StageState,
  StageStatus,
} from './evolution-projection-snapshot.js';

export interface StageInput<T> {
  readonly records: readonly T[];
  readonly status: StageStatus;
}

/** The projection's own measurement DTO (derived from relayed
 *  `capability.governance.measurement.measured` events). `eventId` is
 *  `String(event.seq)` — the dedup/restart marker (Q-C4). Contains NO
 *  proposalId / forecastId / correlationId (sentinel preserved). */
export interface MeasurementRecord {
  readonly measurementId: string;
  readonly eventId: string;
  readonly capabilityId: string;
  readonly recordedAt: string;
  readonly status: string;
  readonly outcomeKind: string;
  readonly confidence: number;
}

export interface EvolutionAssemblerInputs {
  readonly generatedAt: number;
  readonly lifecycle: StageInput<LifecycleRow>;
  readonly learning: { readonly result: LearningProposal | null; readonly unavailable: boolean };
  readonly forecasts: StageInput<A9Forecast>;
  readonly correlations: StageInput<A9Correlation>;
  readonly recommendations: StageInput<GovernanceRecommendation>;
  readonly measurements: StageInput<MeasurementRecord>;
  /** proposalId → target capabilityId (relayed proposal.submitted payloads). */
  readonly proposalTargets: Readonly<Record<string, string>>;
}

/** The capability a learning finding is about. underperformer +
 *  outcome-contradiction key findings by capabilityId; repeated-pattern-failure
 *  fingerprints as `${error}:${capabilityId}` (capabilityId is the final
 *  `:`-delimited segment). Read-model association only. */
export function learningCapabilityId(finding: LearningFinding): string | undefined {
  if (finding.kind === 'repeated-pattern-failure') {
    const idx = finding.identityKey.lastIndexOf(':');
    return idx === -1 ? undefined : finding.identityKey.slice(idx + 1);
  }
  return finding.identityKey;
}

export function assembleEvolutionSnapshot(inputs: EvolutionAssemblerInputs): EvolutionProjectionSnapshot {
  const { generatedAt } = inputs;

  const forecasts: StageState<ForecastRow> = stage(inputs.forecasts, (f) => ({
    forecastId: f.forecastId,
    kind: f.prediction.kind,
    band: f.prediction.band,
    confidence: f.confidence,
    subject: f.subject,
    subjectCapability: f.subjectCapability,
  }));

  const decisions = toDecisionStage(inputs.recommendations);

  const measurements: StageState<MeasurementRow> = stage(inputs.measurements, (m) => ({
    measurementId: m.measurementId,
    capabilityId: m.capabilityId,
    recordedAt: m.recordedAt,
    status: m.status,
    outcomeKind: m.outcomeKind,
    confidence: m.confidence,
  }));

  const correlations: StageState<CorrelationRow> = stage(inputs.correlations, (c) => ({
    correlationId: c.correlationId,
    forecastId: c.forecastId,
    measurementId: c.measurementId,
    delta: c.resolution.delta,
    band: c.resolution.band,
    forecastBand: c.resolution.forecastBand,
  }));

  const learning = toLearningStage(inputs.learning);

  const lifecycle: StageState<LifecycleRow> =
    inputs.lifecycle.status === 'available'
      ? { status: 'available', items: inputs.lifecycle.records }
      : { status: inputs.lifecycle.status, items: [] };

  const capabilityIds = collectCapabilityIds(inputs);
  const spine: CapabilitySpineEntry[] = capabilityIds.map((capabilityId) => ({
    capabilityId,
    lifecycle:
      lifecycle.status === 'available'
        ? (lifecycle.items.find((l) => l.capabilityId === capabilityId) ?? null)
        : null,
    learning: learningStageFor(inputs.learning, capabilityId),
    forecasts: { status: forecasts.status, items: forecasts.items.filter((f) => f.subjectCapability === capabilityId) },
    decisions: { status: decisions.status, items: decisions.items.filter((d) => (inputs.proposalTargets[d.proposalId] ?? '') === capabilityId) },
    measurements: { status: measurements.status, items: measurements.items.filter((m) => m.capabilityId === capabilityId) },
    correlations: { status: correlations.status, items: correlations.items.filter((c) => measurementCapabilityId(c, measurements) === capabilityId) },
  }));

  const links = buildEvolutionLinks({
    forecasts: inputs.forecasts.records,
    recommendations: inputs.recommendations.records,
    measurements: inputs.measurements.records,
    correlations: inputs.correlations.records,
    proposalTargets: inputs.proposalTargets,
  });

  return {
    generatedAt,
    stages: { lifecycle, learning, forecasts, decisions, measurements, correlations },
    spine,
    links,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function stage<T, R>(input: StageInput<T>, map: (t: T) => R): StageState<R> {
  return input.status === 'available'
    ? { status: 'available', items: input.records.map(map) }
    : { status: input.status, items: [] };
}

function toLearningPatternRow(f: LearningFinding): LearningPatternRow {
  return { findingId: f.findingId, kind: f.kind, occurrences: f.occurrences, summary: f.summary };
}

function toLearningStage(input: { result: LearningProposal | null; unavailable: boolean }): StageState<LearningPatternRow> {
  if (input.unavailable) return { status: 'unavailable', items: [] };
  const findings = input.result?.findings ?? [];
  return {
    status: findings.length > 0 ? 'available' : 'empty',
    items: findings.map(toLearningPatternRow),
  };
}

/** Per-capability learning stage — re-derives from the raw findings so the
 *  spine associates by `learningCapabilityId`, never by parsing display rows. */
function learningStageFor(input: { result: LearningProposal | null; unavailable: boolean }, capabilityId: string): StageState<LearningPatternRow> {
  if (input.unavailable) return { status: 'unavailable', items: [] };
  const findings = (input.result?.findings ?? []).filter((f) => learningCapabilityId(f) === capabilityId);
  return {
    status: findings.length > 0 ? 'available' : 'empty',
    items: findings.map(toLearningPatternRow),
  };
}

function toDecisionStage(input: StageInput<GovernanceRecommendation>): StageState<DecisionRow> {
  if (input.status !== 'available') return { status: input.status, items: [] };
  const items = input.records.map<DecisionRow>((r) => {
    const projectedDecision = recommendationKindToDecisionKind(r.kind) ?? null;
    return {
      recommendationId: r.recommendationId,
      recommendationKind: r.kind,
      proposalId: r.proposalId,
      confidence: r.confidence,
      projectedDecision,
      targetState: projectedDecision ? decisionKindToTargetState(projectedDecision) : null,
    };
  });
  return { status: 'available', items };
}

function collectCapabilityIds(inputs: EvolutionAssemblerInputs): string[] {
  const ids = new Set<string>();
  for (const l of inputs.lifecycle.records) ids.add(l.capabilityId);
  for (const f of inputs.forecasts.records) ids.add(f.subjectCapability);
  for (const m of inputs.measurements.records) ids.add(m.capabilityId);
  for (const capabilityId of Object.values(inputs.proposalTargets)) ids.add(capabilityId);
  return [...ids].sort();
}

/** Resolve a correlation's measurement to its capability (the spine groups
 *  correlations under the measured capability). */
function measurementCapabilityId(c: A9Correlation, measurements: StageState<MeasurementRow>): string | undefined {
  if (measurements.status !== 'available') return undefined;
  return measurements.items.find((m) => m.measurementId === c.measurementId)?.capabilityId;
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/tui/runtime/evolution-snapshot-assembler.vitest.ts`
Expected: PASS (all eight cases).

- [ ] **Step 5: Run the link-builder suite (assembler depends on it)**

Run: `pnpm vitest run tests/tui/runtime/evolution-link-builder.vitest.ts tests/tui/runtime/evolution-snapshot-assembler.vitest.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/runtime/evolution/evolution-snapshot-assembler.ts tests/tui/runtime/evolution-snapshot-assembler.vitest.ts
git commit -m "feat(tui): pure evolution snapshot assembler — spine, empty!=unavailable, derived decisions"
```

---

### Task 5: EvolutionProjection — durable, change-gated, restart-safe builder

**Files:**
- Create: `src/tui/runtime/evolution/evolution-projection.ts`
- Test: `tests/tui/runtime/evolution-projection.vitest.ts`

**Interfaces:**
- Consumes: `DurableProjectionBuilder` from `../durable-projection-builder.js`; `AlixEvent` from `../../../events/types.js`; `EvolutionProjectionSnapshot` from `./evolution-projection-snapshot.js`; `assembleEvolutionSnapshot`, `MeasurementRecord` from `./evolution-snapshot-assembler.js`; `buildEvolutionLinks` (via the assembler); `CapabilityMeasurementPayload` from `../../../capability/measurement/measurement-event-types.js`; `readCandidateTargetId` from `../../../evolution/a9/bridge-target.js`; `LearningProposal` from `../../../evolution/learning/contracts/learning-contract.js`.
- Produces: `EvolutionProjection` (a `DurableProjectionBuilder<EvolutionProjectionSnapshot>` with an extra `ingestSessionless(events)` method), `EvolutionProjectionOptions`, `EvolutionProjectionState`.
- Consumed by: Task 8 (composition root), Task 2's seam (snapshotOfAsync awaits its async `snapshot()`).

- [ ] **Step 1: Write the failing test**

`tests/tui/runtime/evolution-projection.vitest.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EvolutionProjection } from '../../../src/tui/runtime/evolution/evolution-projection.js';

const now = 1_700_000_000_000;
function clock(): number { return now; }

// A sessionless `measured` event shape (payload has NO proposalId/forecastId/correlationId — sentinel).
function measuredEvent(seq: number, id: string, capabilityId: string) {
  return {
    seq, id, sessionId: '', type: 'capability.governance.measurement.measured',
    timestamp: new Date(now + seq * 1000).toISOString(),
    payload: {
      measurement: { capabilityId, version: '1' },
      post: { status: 'pass', confidence: 0.9 },
      outcome: { kind: 'effective' as const },
    },
  };
}
function submittedEvent(seq: number, proposalId: string, capabilityId: string) {
  return {
    seq, id: `e${seq}`, sessionId: '', type: 'capability.governance.proposal.submitted',
    timestamp: new Date(now + seq * 1000).toISOString(),
    payload: { proposalId, candidate: { target: { id: capabilityId } } },
  };
}

function makeProjection(overrides: Record<string, unknown> = {}) {
  const sources = {
    lifecycle: () => [{ capabilityId: 'cap-a', state: 'active' as const, eligible: true }],
    forecasts: () => Promise.resolve([] as any[]),
    correlations: () => Promise.resolve([] as any[]),
    recommendations: () => Promise.resolve([] as any[]),
    learning: { learn: async () => null },
    ...overrides,
  };
  return new EvolutionProjection({ sources, clock });
}

describe('EvolutionProjection', () => {
  it('ingestSessionless dedupes by event.seq and persists via exportState', () => {
    const p = makeProjection();
    p.ingestSessionless([measuredEvent(1, 'm1', 'cap-a'), measuredEvent(2, 'm2', 'cap-a')]);
    p.ingestSessionless([measuredEvent(2, 'm2', 'cap-a'), measuredEvent(3, 'm3', 'cap-a')]); // seq 2 re-delivered
    const state = p.exportState();
    expect(state.seenSeqs).toEqual({ '1': true, '2': true, '3': true });
    expect(state.measurements.map((m: any) => m.measurementId)).toEqual(['m1', 'm2', 'm3']);
  });

  it('does not re-apply relayed events after importState (restart durability — Q-C4)', async () => {
    const p1 = makeProjection();
    p1.ingestSessionless([measuredEvent(1, 'm1', 'cap-a'), measuredEvent(2, 'm2', 'cap-a')]);
    await p1.snapshot();
    const state = p1.exportState();

    const p2 = makeProjection();
    p2.importState(state);
    p2.ingestSessionless([measuredEvent(1, 'm1', 'cap-a'), measuredEvent(2, 'm2', 'cap-a')]); // process 2 re-reads same batch
    const snap = await p2.snapshot();
    expect(snap.stages.measurements.items.map((m) => m.measurementId)).toEqual(['m1', 'm2']);
    expect(snap.stages.measurements.status).toBe('available');
  });

  it('gates A8 recompute on newly observed relevant events (not any event)', async () => {
    let learns = 0;
    const p = makeProjection({ learning: { learn: async () => { learns++; return null; } } });
    await p.snapshot(); // no relevant events yet → no learn
    expect(learns).toBe(0);
    p.ingestSessionless([submittedEvent(1, 'proposal-1', 'cap-a')]); // relevant
    await p.snapshot();
    expect(learns).toBe(1);
    await p.snapshot(); // no new relevant events → retained, no re-learn
    expect(learns).toBe(1);
  });

  it('relevant change + failure ⇒ learning unavailable; later success restores (Q-C2)', async () => {
    let fail = true;
    const p = makeProjection({
      learning: {
        learn: async () => { if (fail) throw new Error('boom'); return { proposalId: 'p', generatedAt: '', findings: [] }; },
      },
    });
    p.ingestSessionless([submittedEvent(1, 'proposal-1', 'cap-a')]);
    await p.snapshot();
    expect((await p.snapshot()).stages.learning.status).toBe('unavailable');
    fail = false;
    p.ingestSessionless([submittedEvent(2, 'proposal-2', 'cap-a')]);
    const restored = await p.snapshot();
    expect(restored.stages.learning.status).toBe('empty'); // success, 0 patterns
  });

  it('measurement stage is unavailable before any relay, then available/empty (empty ≠ unavailable)', async () => {
    const p = makeProjection();
    expect((await p.snapshot()).stages.measurements.status).toBe('unavailable');
    p.ingestSessionless([]); // relay observed (empty batch)
    expect((await p.snapshot()).stages.measurements.status).toBe('empty');
    p.ingestSessionless([measuredEvent(1, 'm1', 'cap-a')]);
    expect((await p.snapshot()).stages.measurements.status).toBe('available');
  });

  it('snapshot never throws — a failed JSONL read becomes an unavailable stage', async () => {
    const p = makeProjection({ forecasts: async () => { throw new Error('disk'); } });
    const snap = await p.snapshot();
    expect(snap.stages.forecasts.status).toBe('unavailable');
    expect(snap.stages.forecasts.items).toHaveLength(0);
  });

  it('generatedAt is the injected collector-cycle clock, single observation point', async () => {
    const p = makeProjection();
    p.ingestSessionless([measuredEvent(1, 'm1', 'cap-a')]);
    const snap = await p.snapshot();
    expect(snap.generatedAt).toBe(now);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/runtime/evolution-projection.vitest.ts`
Expected: FAIL — `EvolutionProjection` not exported.

- [ ] **Step 3: Implement the projection**

`src/tui/runtime/evolution/evolution-projection.ts`:

```ts
/**
 * Self-driven evolution projection (Q-S1..S4, Q-C1..C3, Q-C4).
 *
 * The collector is projection-blind: it dispatches session-filtered events via
 * updateAll and relays newly-read sessionless events (sessionId "") via the
 * optional sessionlessEvents callback (Q-C4). This projection consumes ONLY the
 * relayed sessionless stream — governance proposal + measurement events — and
 * reads its persisted sources (forecasts/correlations/recommendations JSONL)
 * fresh each snapshot cycle (Q-C3a). A8 learning recompute is change-gated on
 * newly observed A8-relevant events (Q-C2). All accumulated sessionless
 * evidence is durable via exportState/importState so restart never re-applies
 * or loses relayed events (dedup by event.seq in seenSeqs).
 *
 * Core invariant: the snapshot is an association/read model over canonical
 * artifacts — never a new domain store.
 */
import type { AlixEvent } from '../../../events/types.js';
import type { DurableProjectionBuilder } from '../durable-projection-builder.js';
import type { EvolutionProjectionSnapshot } from './evolution-projection-snapshot.js';
import { assembleEvolutionSnapshot, type MeasurementRecord } from './evolution-snapshot-assembler.js';
import type { CapabilityMeasurementPayload } from '../../../capability/measurement/measurement-event-types.js';
import { readCandidateTargetId } from '../../../evolution/a9/bridge-target.js';
import type { LearningProposal } from '../../../evolution/learning/contracts/learning-contract.js';

export interface EvolutionReadSources {
  readonly lifecycle: () => ReadonlyArray<{ capabilityId: string; state: string; eligible: boolean }>;
  readonly forecasts: () => Promise<ReadonlyArray<unknown>>;
  readonly correlations: () => Promise<ReadonlyArray<unknown>>;
  readonly recommendations: () => Promise<ReadonlyArray<unknown>>;
  readonly learning: { learn(now: string): Promise<LearningProposal | null> };
}

export interface EvolutionProjectionOptions {
  readonly sources: EvolutionReadSources;
  /** Deterministic cycle clock (Q-S3 — collector timestamp, not UI clock). */
  readonly clock?: () => number;
}

export interface EvolutionProjectionState {
  /** String(event.seq) → true. Exact dedup marker for relayed sessionless
   *  events (Q-C4) — restart-safe because it is persisted. */
  readonly seenSeqs: Record<string, true>;
  readonly measurements: readonly MeasurementRecord[];
  readonly proposalTargets: Record<string, string>;
  readonly a8: {
    readonly pending: boolean;
    readonly unavailable: boolean;
    readonly lastSuccessful: LearningProposal | null;
  };
}

const MEASUREMENT_EVENT = 'capability.governance.measurement.measured';
const PROPOSAL_SUBMITTED = 'capability.governance.proposal.submitted';
const PROPOSAL_PREFIX = 'capability.governance.proposal.';

function isA8Relevant(type: string): boolean {
  return type.startsWith(PROPOSAL_PREFIX) || type === MEASUREMENT_EVENT;
}

export class EvolutionProjection implements DurableProjectionBuilder<EvolutionProjectionSnapshot> {
  private state: EvolutionProjectionState = this.initialState();
  private relayObserved = false;
  private readonly sources: EvolutionReadSources;
  private readonly clock: () => number;

  constructor(opts: EvolutionProjectionOptions) {
    this.sources = opts.sources;
    this.clock = opts.clock ?? (() => Date.now());
  }

  private initialState(): EvolutionProjectionState {
    return {
      seenSeqs: {},
      measurements: [],
      proposalTargets: {},
      a8: { pending: false, unavailable: false, lastSuccessful: null },
    };
  }

  /** Session-filtered projection batch — the evolution projection consumes NO
   *  session-scoped events (governance/measurement events are sessionless).
   *  Deliberately a no-op: its input is the sessionless relay. */
  update(_events: readonly AlixEvent[]): void {}

  /** Q-C4 — ingest the relayed sessionless events (ONLY newly-read, per cycle).
   *  Dedupes by event.seq against persisted seenSeqs. */
  ingestSessionless(events: readonly AlixEvent[]): void {
    this.relayObserved = true;
    for (const e of events) {
      if (typeof e.seq !== 'number') continue;
      const key = String(e.seq);
      if (this.state.seenSeqs[key]) continue;
      this.state.seenSeqs[key] = true;
      this.ingest(e);
    }
  }

  private ingest(e: AlixEvent): void {
    const type = e.type;
    if (type === MEASUREMENT_EVENT) {
      const p = e.payload as CapabilityMeasurementPayload;
      this.state.measurements = [
        ...this.state.measurements,
        {
          measurementId: e.id ?? String(e.seq),
          eventId: String(e.seq),
          capabilityId: p.measurement.capabilityId,
          recordedAt: e.timestamp,
          status: p.post.status,
          outcomeKind: p.outcome.kind,
          confidence: p.post.confidence,
        },
      ];
      this.state.a8 = { ...this.state.a8, pending: true };
    } else if (type === PROPOSAL_SUBMITTED) {
      const p = e.payload as { proposalId?: unknown; candidate?: { target?: { id?: unknown } } };
      const target = readCandidateTargetId(p as { candidate: { target: { id: unknown } } });
      const proposalId = typeof p.proposalId === 'string' ? p.proposalId : undefined;
      if (target && proposalId) this.state.proposalTargets[proposalId] = target;
      this.state.a8 = { ...this.state.a8, pending: true };
    } else if (isA8Relevant(type)) {
      this.state.a8 = { ...this.state.a8, pending: true };
    }
  }

  /** Assemble ONE immutable snapshot at the collector-cycle observation point.
   *  NEVER throws — a failed source becomes an unavailable stage (Q-C3b). */
  async snapshot(): Promise<EvolutionProjectionSnapshot> {
    const generatedAt = this.clock();
    let learningResult = this.state.a8.lastSuccessful;
    let learningUnavailable = this.state.a8.unavailable;
    if (this.state.a8.pending) {
      try {
        const result = await this.sources.learning.learn(new Date(generatedAt).toISOString());
        this.state.a8 = { pending: false, unavailable: false, lastSuccessful: result };
        learningResult = result;
        learningUnavailable = false;
      } catch {
        // Q-C2 — relevant change + failure ⇒ unavailable (never empty).
        // lastSuccessful is retained (not wiped) for a later successful restore.
        this.state.a8 = { ...this.state.a8, pending: false, unavailable: true };
        learningUnavailable = true;
      }
    }

    const [forecasts, correlations, recommendations] = await Promise.all([
      this.readStage(this.sources.forecasts),
      this.readStage(this.sources.correlations),
      this.readStage(this.sources.recommendations),
    ]);
    const lifecycleRecords = this.sources.lifecycle();

    return assembleEvolutionSnapshot({
      generatedAt,
      lifecycle: {
        records: lifecycleRecords.map((l) => ({ capabilityId: l.capabilityId, state: l.state as never, eligible: l.eligible })),
        status: lifecycleRecords.length > 0 ? 'available' : 'empty',
      },
      learning: { result: learningResult, unavailable: learningUnavailable },
      forecasts,
      correlations,
      recommendations,
      measurements: {
        records: this.state.measurements,
        status: !this.relayObserved
          ? 'unavailable'
          : this.state.measurements.length > 0
            ? 'available'
            : 'empty',
      },
      proposalTargets: this.state.proposalTargets,
    });
  }

  private async readStage<T>(read: () => Promise<ReadonlyArray<T>>) {
    try {
      const records = await read();
      return { records, status: records.length > 0 ? ('available' as const) : ('empty' as const) };
    } catch {
      return { records: [] as ReadonlyArray<T>, status: 'unavailable' as const };
    }
  }

  reset(): void {
    this.state = this.initialState();
    this.relayObserved = false;
  }

  exportState(): EvolutionProjectionState {
    return this.state;
  }

  importState(state: EvolutionProjectionState): void {
    this.state = {
      seenSeqs: { ...state.seenSeqs },
      measurements: [...state.measurements],
      proposalTargets: { ...state.proposalTargets },
      a8: { ...state.a8, lastSuccessful: state.a8.lastSuccessful },
    };
  }
}
```

> **Type-consistency note:** `EvolutionReadSources.forecasts/correlations/recommendations` are typed `Promise<ReadonlyArray<unknown>>` so the projection stays decoupled from A9/A2.5 contracts; `assembleEvolutionSnapshot`'s `StageInput<A9Forecast>` etc. are satisfied because the assembler's `stage()` mapping only reads the fields it needs (TS structural typing accepts `unknown[]`-returning sources via the `readStage` narrowing — if `tsc` complains, type `EvolutionReadSources` with the CONCRETE `A9Forecast`/`A9Correlation`/`GovernanceRecommendation` types and import them; pick one and keep it consistent).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/tui/runtime/evolution-projection.vitest.ts`
Expected: PASS (all seven cases).

- [ ] **Step 5: Verify the full runtime suite**

Run: `pnpm vitest run tests/tui/runtime/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/tui/runtime/evolution/evolution-projection.ts tests/tui/runtime/evolution-projection.vitest.ts
git commit -m "feat(tui): EvolutionProjection — durable, change-gated A8, restart-safe relay ingestion"
```

---

### Task 6: Evolution tab plumbing (TabId, TAB_ORDER, PerTabState, view registry)

**Files:**
- Modify: `src/tui/state.ts`
- Modify: `src/tui/views/index.ts`
- Test: `tests/tui/views/evolution-view.vitest.ts`

**Interfaces:**
- Produces: `TabId` includes `'evolution'`; `TAB_ORDER` gains `'evolution'` exactly once (last, after `'capabilities'`); `PerTabState` gains `evolutionSelectedCapabilityId?: string`, `evolutionStageCursor?: 'lifecycle'|'learning'|'forecasts'|'decisions'|'measurements'|'correlations' | null` (Q-L2 correction — the RIGHT-pane stage cursor; `Enter`/`→` expands the stage the cursor is on), `evolutionArtifactCursor?: number | null` (within an expanded stage), `evolutionInspector?: { type: 'forecast'|'recommendation'|'decision'|'measurement'|'correlation'; id: string } | null`, `evolutionFlatView?: 'forecasts'|'decisions'|'measurements'|'correlations' | null`.
- Consumes: `EvolutionView` (Task 7) — this task registers the view by importing it; if Task 7 hasn't landed, register a minimal placeholder view first, then Task 7 replaces it.
- **PLAN GAP (fixed by implementer, commit ce369e35):** adding `'evolution'` to `TabId` makes `TuiApp.defaultViews` (src/tui/app.ts, `Record<TabId, TuiView>`) and `createInitialTuiAppState`'s `views` record fail typecheck (TS2741) and would crash on tab cycling to the evolution tab. Both must gain `evolution: getView('evolution')!` / `evolution: createInitialPerTabState()`. Commit `src/tui/app.ts` with this task.

- [ ] **Step 1: Write the failing test**

`tests/tui/views/evolution-view.vitest.ts` (plumbing portion; render/keys land in Task 7):

```ts
import { describe, expect, it } from 'vitest';
import { TAB_ORDER, createInitialPerTabState } from '../../../src/tui/state.js';
import { getView } from '../../../src/tui/views/index.js';

describe('evolution tab plumbing', () => {
  it('TAB_ORDER contains evolution exactly once, after capabilities', () => {
    expect(TAB_ORDER.filter((t) => t === 'evolution')).toHaveLength(1);
    expect(TAB_ORDER[TAB_ORDER.length - 1]).toBe('evolution');
  });

  it('createInitialPerTabState seeds evolution fields and round-trips JSON', () => {
    const s = createInitialPerTabState();
    const roundTripped = JSON.parse(JSON.stringify(s)) as typeof s;
    expect(roundTripped).toEqual(s);
  });

  it('registers an evolution view in the view registry', () => {
    const v = getView('evolution');
    expect(v).toBeDefined();
    expect(v!.id).toBe('evolution');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/views/evolution-view.vitest.ts`
Expected: FAIL — `'evolution'` is not a `TabId` / no view registered.

- [ ] **Step 3: Add `evolution` to TabId, TAB_ORDER, PerTabState**

In `src/tui/state.ts`:

```ts
export type TabId =
  | 'dashboard' | 'chat' | 'agent' | 'daemon' | 'approvals' | 'runtime' | 'sops' | 'policy' | 'capabilities' | 'evolution';

export const TAB_ORDER: readonly TabId[] = ['dashboard', 'chat', 'agent', 'daemon', 'approvals', 'runtime', 'sops', 'policy', 'capabilities', 'evolution'];
```

In `PerTabState` (after `capabilitiesSelectedId` at ~L125):

```ts
  /** Q-L1 — selected capability in the evolution spine (lazy-init). */
  evolutionSelectedCapabilityId?: string;
  /** Q-L2 — expanded stage within the selected capability's spine. */
  evolutionExpandedStage?: 'lifecycle' | 'learning' | 'forecasts' | 'decisions' | 'measurements' | 'correlations' | null;
  /** Q-L3 — read-only inspector target (reference-by-id). */
  evolutionInspector?: { type: 'forecast' | 'recommendation' | 'decision' | 'measurement' | 'correlation'; id: string } | null;
  /** Q-L2 — flat index mode (f key). */
  evolutionFlatView?: 'forecasts' | 'decisions' | 'measurements' | 'correlations' | null;
```

In `createInitialPerTabState` (seed block), add the four fields as `undefined` (or `null` for the nullable ones) so they round-trip JSON.

- [ ] **Step 4: Register the view**

In `src/tui/views/index.ts`, import `EvolutionView` from `../evolution/evolution-view.js`, add `evolution: new EvolutionView()` to the `_views` record, and add `EvolutionView` to the view re-exports. (If Task 7 hasn't landed, create a minimal `EvolutionView` stub with `readonly id: TabId = 'evolution'` and `render: () => ({ rows: [] })` — Task 7 replaces it.)

- [ ] **Step 5: Run the tests**

Run: `pnpm vitest run tests/tui/views/evolution-view.vitest.ts tests/tui/app.vitest.ts tests/tui/state.vitest.ts`
Expected: PASS. `app.vitest.ts` regression confirms the extra tab doesn't break tab rendering/cycling.

- [ ] **Step 6: Commit**

```bash
git add src/tui/state.ts src/tui/views/index.ts tests/tui/views/evolution-view.vitest.ts
git commit -m "feat(tui): evolution tab plumbing — TabId, TAB_ORDER, PerTabState, view registry"
```

---

### Task 7: Evolution view — spine, stage-collapsed drill-down, inspector, keys

**Files:**
- Create: `src/tui/evolution/evolution-keys.ts`
- Create: `src/tui/evolution/evolution-render.ts`
- Create: `src/tui/evolution/evolution-view.ts`
- Test: `tests/tui/views/evolution-view.vitest.ts` (extend)

**Interfaces:**
- Consumes: `TuiView`, `ViewRenderContext`, `ViewInputContext`, `ViewAction` from `../views/types.js`; `truncate` from `../box.js`; `EvolutionProjectionSnapshot`, `EvolutionNodeType` from `../runtime/evolution/evolution-projection-snapshot.js`; `PerTabState` from `../state.js`.
- Produces: `evolutionKeyAction(key, perTab)` (pure), `renderEvolution(snap, perTab, dims)` (pure), `EvolutionView implements TuiView`.

> **Q-L2/Q-L3 correction (LOCKED 2026-08-16):** This task's acceptance test is amended to prove the complete interaction path — TWO selection levels: (1) LEFT pane capability cursor, (2) RIGHT pane stage cursor, (3) artifact cursor within an expanded stage, (4) Q-L3 inspector opens on artifact select. `Enter`/`→` ALWAYS expands the stage the cursor is on — never a hardcoded default. Key mapping:
> - `↑`/`k` or `↓`/`j` — move the STAGE cursor (right pane), or the capability cursor when the left pane has focus.
> - `Enter`/`→` — expand the CURRENTLY SELECTED STAGE.
> - `←`/`Esc` — collapse the expanded stage; `Esc` again returns through the hierarchy WITHOUT changing the capability anchor.
> - `f` — toggle flat index mode. `c` — return to the capability spine root. `q` — quit drill-down → root spine.
> - Artifact selection within an expanded stage opens the Q-L3 inspector (read-only side pane, canonical ids + related ids, never ownership; many-to-many preserved — a measurement never acquires a primary forecast).
>
> Acceptance additions (prove the reachable path): (1) select capability; (2) move stage cursor lifecycle→learning→forecasts; (3) `Enter` on forecasts → forecasts expand; (4) move artifact cursor within expanded forecasts; (5) select a forecast → `evolutionInspector` becomes populated; (6) inspector renders the canonical id + related ids; (7) `Esc`/`←` returns through the hierarchy without changing the capability anchor. Add an app-level regression that tab-cycling to `evolution` and pressing keys never crashes (frame-painter `[s.activeTab]!` path). Tests may inject `evolutionStageCursor`/`evolutionArtifactCursor` directly, but at least one test must drive the full path through `handleKey` (no injection of `evolutionExpandedStage`).

- [ ] **Step 1: Write the failing render test**

Extend `tests/tui/views/evolution-view.vitest.ts`:

```ts
import { renderEvolution } from '../../../src/tui/evolution/evolution-render.js';
import { evolutionKeyAction } from '../../../src/tui/evolution/evolution-keys.js';

// A minimal snapshot: one capability, one forecast, one decision, one measurement.
const snap = {
  generatedAt: 1_700_000_000_000,
  stages: {
    lifecycle: { status: 'available', items: [{ capabilityId: 'cap-a', state: 'active', eligible: true }] },
    learning: { status: 'empty', items: [] },
    forecasts: { status: 'available', items: [{ forecastId: 'forecast-1', kind: 'trust-velocity', band: 'high', confidence: 0.8, subject: 'p1', subjectCapability: 'cap-a' }] },
    decisions: { status: 'available', items: [{ recommendationId: 'rec-1', recommendationKind: 'RISK_GATED_REVIEW', proposalId: 'p1', confidence: 0.7, projectedDecision: 'REQUEST_MORE_EVIDENCE', targetState: 'UNDER_REVIEW' }] },
    measurements: { status: 'available', items: [{ measurementId: 'measurement-1', capabilityId: 'cap-a', recordedAt: '2026-08-10', status: 'pass', outcomeKind: 'effective', confidence: 0.9 }] },
    correlations: { status: 'empty', items: [] },
  },
  spine: [{
    capabilityId: 'cap-a',
    lifecycle: { capabilityId: 'cap-a', state: 'active', eligible: true },
    learning: { status: 'empty', items: [] },
    forecasts: { status: 'available', items: [{ forecastId: 'forecast-1', kind: 'trust-velocity', band: 'high', confidence: 0.8, subject: 'p1', subjectCapability: 'cap-a' }] },
    decisions: { status: 'available', items: [{ recommendationId: 'rec-1', recommendationKind: 'RISK_GATED_REVIEW', proposalId: 'p1', confidence: 0.7, projectedDecision: 'REQUEST_MORE_EVIDENCE', targetState: 'UNDER_REVIEW' }] },
    measurements: { status: 'available', items: [{ measurementId: 'measurement-1', capabilityId: 'cap-a', recordedAt: '2026-08-10', status: 'pass', outcomeKind: 'effective', confidence: 0.9 }] },
    correlations: { status: 'empty', items: [] },
  }],
  links: [],
} as any;

describe('renderEvolution', () => {
  it('renders the capability list on the left (Q-L1)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('cap-a'))).toBe(true);
  });

  it('renders collapsed stages as "N artifacts" (Q-L4c)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('forecasts') && r.includes('1 artifact'))).toBe(true);
  });

  it('renders a decision as RECOMMENDATION / PROJECTED DECISION / TARGET STATE (Q-L4a)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: 'decisions' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('RECOMMENDATION') && r.includes('RISK_GATED_REVIEW'))).toBe(true);
    expect(rows.some((r) => r.includes('PROJECTED DECISION') && r.includes('REQUEST_MORE_EVIDENCE'))).toBe(true);
    expect(rows.some((r) => r.includes('TARGET STATE') && r.includes('UNDER_REVIEW'))).toBe(true);
  });

  it('renders learning as "LEARNING — N patterns (computed live)" (Q-L4b)', () => {
    const rows = renderEvolution({
      ...snap,
      spine: [{ ...snap.spine[0], learning: { status: 'available', items: [{ findingId: 'f1', kind: 'underperformer', occurrences: 2, summary: 's' }] } }],
      stages: { ...snap.stages, learning: { status: 'available', items: [{ findingId: 'f1', kind: 'underperformer', occurrences: 2, summary: 's' }] } },
    } as any, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('LEARNING') && r.includes('1 pattern'))).toBe(true);
  });

  it('caps expanded stage at 10 with "+N more" (Q-L4c — presentation limit)', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ findingId: `f${i}`, kind: 'underperformer', occurrences: 1, summary: `s${i}` }));
    const rows = renderEvolution({
      ...snap,
      spine: [{ ...snap.spine[0], learning: { status: 'available', items: many } }],
      stages: { ...snap.stages, learning: { status: 'available', items: many } },
    } as any, { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: 'learning' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('+3 more'))).toBe(true);
  });

  it('renders "Evolution as of" with the generatedAt, never a stage age (Q-C3b)', () => {
    const rows = renderEvolution(snap, { evolutionSelectedCapabilityId: 'cap-a' } as any, { columns: 120, rows: 40 });
    expect(rows.some((r) => r.includes('Evolution as of'))).toBe(true);
    expect(rows.some((r) => /ago|seconds|old/.test(r))).toBe(false);
  });
});

describe('evolutionKeyAction', () => {
  it('maps the Q-L2 table: enter/→ expand, ←/esc collapse, j/k scroll, f flat, c spine', () => {
    const perTab = { evolutionSelectedCapabilityId: 'cap-a', evolutionExpandedStage: null } as any;
    expect(evolutionKeyAction('enter', perTab).action).toBe('expand');
    expect(evolutionKeyAction('→', perTab).action).toBe('expand');
    expect(evolutionKeyAction('escape', { ...perTab, evolutionExpandedStage: 'decisions' }).action).toBe('collapse');
    expect(evolutionKeyAction('k', perTab).action).toBe('navigate');
    expect(evolutionKeyAction('j', perTab).action).toBe('navigate');
    expect(evolutionKeyAction('f', perTab).action).toBe('flat');
    expect(evolutionKeyAction('c', perTab).action).toBe('spine');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run tests/tui/views/evolution-view.vitest.ts`
Expected: FAIL — `renderEvolution` / `evolutionKeyAction` not exported.

- [ ] **Step 3: Implement the key mapping**

`src/tui/evolution/evolution-keys.ts`:

```ts
/** Q-L2 — evolution-tab keybindings (pure). `q` returns to the root spine
 *  (quit drill-down); the app-level global quit remains untouched. */
import type { ViewInputContext } from '../views/types.js';

export type EvolutionKeyAction =
  | { action: 'navigate'; direction: -1 | 1 }
  | { action: 'expand' }
  | { action: 'collapse' }
  | { action: 'scroll'; offset: -1 | 1 }
  | { action: 'flat' }
  | { action: 'spine' }
  | { action: 'select' }
  | { action: 'inspect'; type: string; id: string }
  | { action: 'none' };

export function evolutionKeyAction(key: string, _perTab: Readonly<ViewInputContext['perTab']>): EvolutionKeyAction {
  switch (key) {
    case 'ArrowUp': case 'k': return { action: 'navigate', direction: -1 };
    case 'ArrowDown': case 'j': return { action: 'navigate', direction: 1 };
    case 'Enter': case 'ArrowRight': return { action: 'expand' };
    case 'ArrowLeft': case 'Escape': return { action: 'collapse' };
    case 'f': return { action: 'flat' };
    case 'c': return { action: 'spine' };
    case 'q': return { action: 'spine' }; // quit drill-down → root spine
    default: return { action: 'none' };
  }
}
```

- [ ] **Step 4: Implement the renderer**

`src/tui/evolution/evolution-render.ts` (pure — returns text rows):

```ts
/** Q-L1..L4 — evolution-tab rendering (pure). Render caps are PRESENTATION
 *  limits, never projection truncation: collapsed stage "N artifacts",
 *  expansion first 10 + "… +N more", flat indexes 50/page. */
import type { EvolutionProjectionSnapshot, EvolutionNodeType } from '../runtime/evolution/evolution-projection-snapshot.js';
import { truncate } from '../box.js';

export interface EvolutionRenderState {
  readonly evolutionSelectedCapabilityId?: string;
  readonly evolutionExpandedStage?: string | null;
  readonly evolutionInspector?: { type: EvolutionNodeType; id: string } | null;
  readonly evolutionFlatView?: string | null;
}
export interface EvolutionDimensions { readonly columns: number; readonly rows: number; }

const EXPANSION_CAP = 10;
const FLAT_PAGE = 50;

export function renderEvolution(
  snap: EvolutionProjectionSnapshot,
  state: EvolutionRenderState,
  dims: EvolutionDimensions,
): string[] {
  const rows: string[] = [];
  const header = `Evolution as of ${new Date(snap.generatedAt).toLocaleTimeString()}`;
  rows.push(header);
  rows.push('');

  if (snap.spine.length === 0) {
    rows.push('  no capabilities in the evolution loop');
    return rows;
  }

  const selected = state.evolutionSelectedCapabilityId ?? snap.spine[0]!.capabilityId;
  const spine = snap.spine.find((s) => s.capabilityId === selected) ?? snap.spine[0]!;

  if (state.evolutionFlatView) {
    return renderFlat(snap, state.evolutionFlatView, dims, rows);
  }

  // Left capability list (CapabilitiesView convention) — compact risk markers.
  const listW = Math.floor(dims.columns / 2) - 1;
  for (let i = 0; i < snap.spine.length; i++) {
    const s = snap.spine[i]!;
    const marker = s.capabilityId === selected ? '▶ ' : '  ';
    rows.push(`${marker}${riskMarker(s)} ${truncate(s.capabilityId, listW - 3)}`);
  }
  rows.push('');

  // Right: selected capability's spine, stage-collapsed (Q-L2).
  rows.push(`capability ${spine.capabilityId}`);
  rows.push(stageLine('lifecycle', spine.lifecycle ? [spine.lifecycle.capabilityId] : [], spine.lifecycle ? 'available' : 'empty', 'lifecycle', state.evolutionExpandedStage));
  rows.push(stageLine('learning', spine.learning.items, spine.learning.status, 'learning', state.evolutionExpandedStage));
  rows.push(stageLine('forecasts', spine.forecasts.items, spine.forecasts.status, 'forecasts', state.evolutionExpandedStage));
  rows.push(stageLine('decisions', spine.decisions.items, spine.decisions.status, 'decisions', state.evolutionExpandedStage));
  rows.push(stageLine('measurements', spine.measurements.items, spine.measurements.status, 'measurements', state.evolutionExpandedStage));
  rows.push(stageLine('correlations', spine.correlations.items, spine.correlations.status, 'correlations', state.evolutionExpandedStage));

  if (state.evolutionExpandedStage) {
    rows.push('');
    rows.push(...expandStage(state.evolutionExpandedStage, spine[state.evolutionExpandedStage as 'forecasts']));
  }

  if (state.evolutionInspector) {
    rows.push('');
    rows.push(...renderInspector(snap, state.evolutionInspector));
  }

  return rows;
}

/** Q-L4c — collapsed stage line: "N artifacts" + status (available/empty/
 *  unavailable distinct; unavailable NEVER renders as an empty section). */
function stageLine(
  name: string,
  items: readonly unknown[],
  status: string,
  stage: string,
  expanded: string | null | undefined,
): string {
  const label = `${name} — ${items.length} artifact${items.length === 1 ? '' : 's'}`;
  const open = expanded === stage ? '▼' : '▶';
  const statusSuffix = status === 'unavailable' ? ' (unavailable)' : status === 'empty' ? ' (empty)' : '';
  return `  ${open} ${label}${statusSuffix}`;
}

function statusLabel(status: string): string {
  return status === 'unavailable' ? '(unavailable)' : status === 'empty' ? '(empty)' : '';
}

function riskMarker(s: { forecasts: { status: string; items: readonly { band: string }[] } }): string {
  const bands = s.forecasts.status === 'available' ? s.forecasts.items.map((f) => f.band) : [];
  if (bands.includes('critical')) return '!!';
  if (bands.includes('high')) return '!';
  return '·';
}

function expandStage(stage: string, items: readonly { id?: string; forecastId?: string; recommendationId?: string; measurementId?: string; correlationId?: string }[]): string[] {
  const shown = items.slice(0, EXPANSION_CAP);
  const more = items.length - shown.length;
  const out = shown.map((it) => `    ${displayId(it)}`);
  if (more > 0) out.push(`    … +${more} more`);
  return out;
}

function displayId(it: { id?: string; forecastId?: string; recommendationId?: string; measurementId?: string; correlationId?: string }): string {
  return it.forecastId ?? it.recommendationId ?? it.measurementId ?? it.correlationId ?? it.id ?? '?';
}

function renderFlat(snap: EvolutionProjectionSnapshot, stage: string, _dims: EvolutionDimensions, rows: string[]): string[] {
  const items = snap.stages[stage as 'forecasts'].items;
  const page = items.slice(0, FLAT_PAGE);
  rows.push(`flat — ${stage} (${page.length}/${items.length})`);
  for (const it of page) rows.push(`  ${displayId(it)}`);
  if (items.length > FLAT_PAGE) rows.push(`  … +${items.length - FLAT_PAGE} more`);
  return rows;
}

function renderInspector(snap: EvolutionProjectionSnapshot, target: { type: EvolutionNodeType; id: string }): string[] {
  // Q-L3 — reference-by-id read-only inspector: the artifact + its other
  // relationships ('also correlated with: forecast-456'). Never ownership.
  const related = snap.links.filter((l) =>
    (l.from === target.id && l.fromType === target.type) ||
    (l.to === target.id && l.toType === target.type));
  return [
    `inspector — ${target.type} ${target.id}`,
    ...related.map((l) => `  ${l.kind}: ${l.fromType} ${l.from} → ${l.toType} ${l.to}`),
    ...(related.length === 0 ? ['  no relationships'] : []),
  ];
}
```

> **Note:** the `stageLine` signature above takes a real `status` from the spine's `StageState` — it must render `(unavailable)` distinctly and NEVER show `(empty)` for an unavailable stage (Q-L2/Q-C3b). `statusLabel` is kept for the flat view. The tests in Step 1 are the gate; make the renderer satisfy exactly those assertions (the decision triple and learning live-status lines are expanded in the `expandStage`/`renderInspector` implementations — add the Q-L4a/Q-L4b detail lines there if the tests require it).

- [ ] **Step 5: Implement the view**

`src/tui/evolution/evolution-view.ts`:

```ts
/** Q5/Q-L1 — the `evolution` tab: capability-spine overview with stage-collapsed
 *  drill-down, reference-by-id inspector, flat indexes. Read-only. */
import type { PerTabState, TabId } from '../state.js';
import type { TuiView, ViewAction, ViewInputContext, ViewRenderContext, ViewRenderResult } from '../views/types.js';
import { renderEvolution } from './evolution-render.js';
import { evolutionKeyAction } from './evolution-keys.js';

export class EvolutionView implements TuiView {
  readonly id: TabId = 'evolution';

  render(ctx: ViewRenderContext): ViewRenderResult {
    const snap = ctx.snap.runtime?.evolution ?? null;
    if (!snap) {
      return { rows: ['\x1b[90mevolution unavailable — projection not registered\x1b[0m'], hint: '' };
    }
    const rows = renderEvolution(snap, ctx.perTab as PerTabState, ctx.dimensions);
    return { rows, hint: '↑↓ select · Enter expand · ← Esc collapse · f flat · c spine · q quit' };
  }

  handleKey(key: string, ctx: ViewInputContext): ViewAction {
    const perTab = ctx.perTab;
    const action = evolutionKeyAction(key, perTab);
    switch (action.action) {
      case 'expand': perTab.evolutionExpandedStage = perTab.evolutionExpandedStage ?? 'forecasts'; return { type: 'handled' };
      case 'collapse': perTab.evolutionInspector = null; perTab.evolutionExpandedStage = null; return { type: 'handled' };
      case 'navigate': perTab.evolutionSelectedCapabilityId = cycleCapability(ctx, action.direction); return { type: 'handled' };
      case 'flat': perTab.evolutionFlatView = perTab.evolutionFlatView ? null : 'forecasts'; return { type: 'handled' };
      case 'spine': perTab.evolutionFlatView = null; perTab.evolutionInspector = null; perTab.evolutionExpandedStage = null; return { type: 'handled' };
      default: return { type: 'handled' };
    }
  }
}

function cycleCapability(ctx: ViewInputContext, direction: -1 | 1): string {
  const spine = ctx.snap.runtime?.evolution?.spine ?? [];
  if (spine.length === 0) return ctx.perTab.evolutionSelectedCapabilityId ?? '';
  const idx = Math.max(0, spine.findIndex((s) => s.capabilityId === ctx.perTab.evolutionSelectedCapabilityId));
  return spine[(idx + direction + spine.length) % spine.length]!.capabilityId;
}
```

- [ ] **Step 6: Run the tests until green**

Run: `pnpm vitest run tests/tui/views/evolution-view.vitest.ts`
Expected: PASS.

- [ ] **Step 7: Regression — existing TUI tabs + view registry**

Run: `pnpm vitest run tests/tui/views/ tests/tui/app.vitest.ts tests/tui/render.vitest.ts tests/tui/frame-painter-status-row.vitest.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/tui/evolution/ tests/tui/views/evolution-view.vitest.ts
git commit -m "feat(tui): evolution view — capability spine, stage-collapsed drill-down, inspector, Q-L2 keys"
```

---

### Task 8: Composition root — wire adapters, LearningEngine, projection, relay

**Files:**
- Modify: `src/cli/commands/tui.ts`
- Test: `tests/tui/runtime/evolution-composition-root.vitest.ts`

**Interfaces:**
- Consumes: `EvolutionProjection` from `../../tui/runtime/evolution/evolution-projection.js`; `ProjectionIds` (already imported); `ForecastsAdapter` from `../../evolution/a9/forecasts-adapter.js`; `ForecastsStore` from `../../evolution/a9/forecasts-store.js`; `CorrelationsAdapter`/`CorrelationsStore`; `RecommendationsAdapter` from `../../evolution/learning/adapters/recommendations-adapter.js`; `GovernanceStore` from `../../governance/governance-store.js`; `LearningEngine` from `../../evolution/learning/learning-engine.js`; `ProposalEventsAdapter`, `MeasurementEventsAdapter`, `EnrichedProposalsAdapter` from `../../evolution/learning/adapters/*.js`; `createEnrichedProposalsSource` from `../../evolution/a9/adapters/enriched-proposals-source.js`; `isLifecycleEligible` from `../../capability/lifecycle-eligibility.js`.
- Produces: `runtimeProjectionRuntime` registers `[ProjectionIds.evolution, evolutionProjection]`; `runtimeCollector` wired with `sessionlessEvents: (events) => evolutionProjection.ingestSessionless(events)`.

- [ ] **Step 1: Write the failing integration test**

`tests/tui/runtime/evolution-composition-root.vitest.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { RuntimeCollectorImpl } from '../../../src/tui/runtime-collector.js';
import { createProjectionRuntime } from '../../../src/tui/runtime/projection-runtime.js';
import { ProjectionIds } from '../../../src/tui/runtime/projection-ids.js';
import { EvolutionProjection } from '../../../src/tui/runtime/evolution/evolution-projection.js';

// Wire a real EvolutionProjection with in-memory sources + a real collector
// over a tiny in-memory EventLog, feed governance/measurement events, and assert
// the projection's snapshot flows into RuntimeSnapshot.evolution via the relay.
describe('evolution composition', () => {
  it('relays sessionless events into the projection and surfaces evolution in the runtime snapshot', async () => {
    // 1. Build the in-memory EventLog fake used by the runtime-collector tests
    //    (readSince/cursor/serialize), append a `capability.governance.
    //    measurement.measured` event with sessionId "".
    // 2. Build projection with sources { lifecycle: () => [], forecasts: () => [],
    //    correlations: () => [], recommendations: () => [],
    //    learning: { learn: async () => null } }.
    // 3. Build runtimeCollector with projectionRuntime registering
    //    [ProjectionIds.evolution, projection] and
    //    sessionlessEvents: (e) => projection.ingestSessionless(e).
    // 4. await collector.start(); const snap = await collector.snapshot();
    // 5. expect(snap?.evolution).toBeDefined();
    //    expect(snap!.evolution!.stages.measurements.status).toBe('available');
    //    expect(snap!.evolution!.stages.measurements.items[0]!.capabilityId)
    //      .toBe(<the appended payload's capabilityId>);
    // 6. expect(snap!.timeline).toHaveLength(0) — sessionless events NEVER
    //    reach the session projections.
    expect(true).toBe(true); // placeholder — implement steps 1-6 with the repo's EventLog harness
  });
});
```

- [ ] **Step 2: Implement the composition wiring in `src/cli/commands/tui.ts`**

In `runTui`, after the platform/`CapabilityService` construction and BEFORE `runtimeProjectionRuntime` (line ~130), construct the evolution projection:

```ts
// A9/A8 read surfaces for the evolution projection (Q-S3/C3a — collector reads
// through adapters; A7/A8/A9 stay authoritative). storeDir matches the
// platform default: .alix/governance.
const evolutionStoreDir = join(process.cwd(), '.alix', 'governance');
const evolutionProjection = new EvolutionProjection({
  sources: {
    lifecycle: () =>
      capabilityService.platform.registry
        .listLifecycleStates()
        .map(({ capabilityId, state }) => ({ capabilityId, state, eligible: isLifecycleEligible(state) })),
    forecasts: () => capabilityService.platform.a9.forecasts.list(),
    correlations: () => capabilityService.platform.a9.correlations.list(),
    recommendations: () => new RecommendationsAdapter(new GovernanceStore(evolutionStoreDir)).list(),
    learning: new LearningEngine(
      new ProposalEventsAdapter(eventLog),
      new MeasurementEventsAdapter(eventLog),
      new EnrichedProposalsAdapter(await createEnrichedProposalsSource(process.cwd())()),
      new RecommendationsAdapter(new GovernanceStore(evolutionStoreDir)),
    ),
  },
});
```

Register it and wire the relay on the runtime collector:

```ts
const runtimeProjectionRuntime = createProjectionRuntime([
  [ProjectionIds.trace, new IncrementalExecutionTraceBuilder()],
  [ProjectionIds.approval, new ApprovalProjection()],
  [ProjectionIds.capability, new CapabilityProjection()],
  [ProjectionIds.metrics, new MetricsProjection()],
  [ProjectionIds.context, new ContextProjectionBuilder()],
  [ProjectionIds.evolution, evolutionProjection],
]);
const runtimeCollector = new RuntimeCollectorImpl({
  eventLog,
  checkpointStore: runtimeCheckpointStore,
  sessionId,
  projectionRuntime: runtimeProjectionRuntime,
  // Q-C4 — relay each cycle's newly-read sessionless events to the evolution
  // projection (its A8 change gate + measurement stage consume them).
  sessionlessEvents: (events) => evolutionProjection.ingestSessionless(events),
});
```

> **Note:** `capabilityService` must be constructed BEFORE this block (it currently is — `new CapabilityPlatform({ eventLog })` inside the TUI capability-service). Verify the variable name in `tui.ts` (it may be the `CapabilityService` instance passed into `TuiApp`); if the service isn't constructed until later, move this block after it. `runTui` is `async`, so the `await createEnrichedProposalsSource(...)` is legal. `isLifecycleEligible` is imported from `src/capability/lifecycle-eligibility.js`.

- [ ] **Step 3: Complete the integration test**

Replace the placeholder assertion with the real flow using the in-memory EventLog fake already used by `tests/tui/runtime/runtime-collector*.vitest.ts` (the shared EventLog stub). Assert the five points in Step 1's comments. This test must NOT touch the real `.alix/governance` directory (all sources are in-memory fakes).

- [ ] **Step 4: Run the tests**

Run: `pnpm vitest run tests/tui/runtime/evolution-composition-root.vitest.ts tests/tui/runtime/`
Expected: PASS.

- [ ] **Step 5: Full typecheck**

Run: `pnpm tsc --noEmit`
Expected: NO NEW errors beyond the 33 pre-existing baseline (verify the baseline by `git stash` first if unsure).

- [ ] **Step 6: Full TUI regression**

Run: `pnpm vitest run tests/tui/`
Expected: PASS (all existing TUI tests + the new evolution tests).

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/tui.ts tests/tui/runtime/evolution-composition-root.vitest.ts
git commit -m "feat(tui): wire evolution projection + sessionless relay in the composition root"
```

---

## Self-Review

**1. Spec coverage** — every locked ruling maps to a task:
- Q1-Q5 scope (one tab, read-only) → Tasks 6, 7.
- Q3 extend collector / no second loop → Tasks 1, 2, 8.
- Q-S1 spine + bounded indexes + never-a-store → Tasks 3, 4, 5.
- Q-S2 derived decisions (`recommendation`/`projectedDecision`/`targetState`) → Task 4 (assembler), Task 3 (links), Task 7 (render).
- Q-S3 live A8 recompute, no persistence, deterministic clock → Task 5.
- Q-S4 link index, reference-by-id, no primary, no forecast→measurement without correlation → Task 3.
- Q-C1 single `generatedAt`, one immutable snapshot → Tasks 4, 5.
- Q-C2 change-gated A8, retain last result, failure⇒unavailable, later success restores → Task 5 (+ test).
- Q-C3a full JSONL re-read → Task 5 (`readStage`).
- Q-C3b StageStatus empty≠unavailable, no stage ages → Tasks 4, 7.
- Q-C4 sessionless relay + seq dedup + restart durability → Tasks 1, 5 (+ tests).
- Q-L1..L4 landing/spine/keys/inspector/presentation caps/decision triple/learning live-status → Task 7 (+ tests).
- A9 bridge unchanged (`candidate.target.id`, executed gate, no foreign measurement fields) → Task 3 (proposalTargets), Task 5 (ingest), sentinel preserved in `MeasurementRow`.
- Mandate test invariants → Task 4 (projection identity, capability association, generatedAt, empty≠unavailable, recommendation→decision), Task 3 (many-to-many, no primary, no forecast→measurement), Task 5 (A8 gating, JSONL refresh, restart durability, dedup), Task 7 (bounded rendering, navigation, inspector), Task 8 (composition), plus existing-tab regression in Tasks 1/2/7.

**2. Placeholder scan** — the only intentionally-deferred placeholders are: Task 2's ordering note (land Task 3's type file first), Task 7's `stageLine` note (the tests are the gate; the status-distinct rendering is specified inline), and Task 8's test "placeholder" (explicitly replaced in Step 3). Each is called out inline with the concrete replacement. No "TBD"/"add error handling" steps.

**3. Type consistency** — `EvolutionProjectionSnapshot`/`StageState`/`StageStatus`/`EvolutionLink` are defined once (Task 3) and imported everywhere. `buildEvolutionLinks` (Task 3) and `assembleEvolutionSnapshot` (Task 4) signatures are fixed before Task 5 consumes them. `MeasurementRecord` lives in `evolution-snapshot-assembler.ts` and is imported by the projection (Task 5). `splitSessionless` (Task 1) and `snapshotOfAsync` (Task 2) are consumed by Tasks 5/8 exactly as produced. Task 5's type-consistency note flags the one place where the assembler's concrete source types must match the projection's `EvolutionReadSources` — implementer picks one consistent choice.
