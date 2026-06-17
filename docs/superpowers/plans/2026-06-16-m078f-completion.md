# M0.78f Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps in the M0.78f conflict-detection feature on branch `feat/m078f-conflict-detection` so the spec at `docs/superpowers/specs/2026-06-15-m78-shared-context-design.md` and the plan at `docs/superpowers/plans/2026-06-15-m78f-conflict-detection.md` are fully implemented, observable, tested, and documented.

**Architecture:** TDD-first, frequent small commits, preserving all existing patterns (kernel pure-function tests use `node:assert/strict` + `mkdtempSync`; CLI uses `execFileSync` of the compiled `dist/src/cli.js`; TUI panels never import runtime stores; HTTP routes never mutate state). All new tests are picked up by `npm run test:node:ci` (under `tests/kernel/`, `tests/tools/`, `tests/cli/`, `tests/tui/`, `tests/server/`) except the one integration test which runs via `npm run test:integration`.

**Tech Stack:** TypeScript, Node `node:test`, Node `node:assert/strict`, existing `CollaborationStore`, `ConflictRepository`, `EventLog`, `AuditStore`, `MinimalMetrics`, `CoordinationStore`, `CoordinationAggregateStore`.

---

## 0. Context — current state vs the plan

**Already committed (in order):** `08213a65`, `3aeedd54`, `fae51679`, `f5696a9f`, `fb512ad3`, `da5e37cf`, `ed56e435`, `3d8215b3`. The 8 modules and 3 visibility surfaces exist.

**Gaps this plan fills:**

1. **Missing orchestrator** — `src/kernel/collaboration-conflict-detector.ts` does not exist. The pipeline pieces (`extractClaim`, `ConflictCandidateGenerator`, `ClaimComparator`, `ConflictEvidenceComparator`, `ConflictRepository.upsertConflict`) are present but nothing wires them together. Without the detector, no deterministic conflicts are ever created — only worker-reported ones.
2. **`ConflictRepository.authorize()`** allows any `kind: "worker"` if `allowedConflictIds` is undefined (line 106-113). Plan §11.1 says workers must be assigned the role explicitly. **Fix:** treat undefined as deny.
3. **CLI subcommand gaps** — no `--actor` / `--reason` flags on resolution commands; `conflict-accept-divergence` is missing; `handleInspect` does not surface `view.conflictCount` / `view.conflicts`.
4. **State migration** — `normalizeStateV1_0()` not added to `src/kernel/collaboration-validation.ts`. Plan §5 requires it.
5. **Conflict budget** — `CollaborationContextBudget` has no `maxConflicts` / `maxConflictTokens` / `maxFindingsPerConflict`. Plan §15.2 requires it.
6. **Observability** — `CONFLICT_EVENT_TYPES` declared in `src/events/types.ts:194-205` but emitted nowhere. `AuditAction` union (15 entries) is closed and has no conflict actions. `M09MetricName` (7 entries) is closed and has no conflict metrics.
7. **Tests** — zero test files added on this branch. Plan §19 lists 13 test files; plan §21 is the matrix.
8. **Docs** — `README.md` and `docs/user-manual.md` untouched.

**Bugs ruled out by direct re-reading of source:**

- The evidence comparator (`src/kernel/collaboration-evidence-comparator.ts:22-24`) reads `f.evidenceRefs[i].kind` against the `EvidenceRef` discriminated union. The narrowing is correct: `EvidenceRef = { kind: "worker_result", ... } | { kind: "artifact", ... } | { kind: "file", path, digest? } | ...`. TypeScript narrows per variant and `r.digest` is `string | undefined` after `r.kind === "file"`. The earlier audit incorrectly flagged this as a bug. No fix needed.

---

## 1. Architecture invariants (carry through every task)

These are existing codebase rules that the plan must respect. Violating any one will fail code review.

- **TUI panels must not import runtime stores.** Mirror the test guard at `tests/tui/chronicle-panel.test.ts` and `tests/tui/ifamas-panel.test.ts`: a test asserts the panel source does not contain `ConflictRepository`, `CollaborationStore`, `EventLog`, `AuditStore`, `MinimalMetrics`. If a panel needs conflict data, the consumer wires a literal data object.
- **HTTP routes never mutate state.** Inspector route handlers in `src/server/coordination-routes.ts` are GET-only. The new `POST` write endpoints (resolve/dismiss/accept-divergence) require a `req` parameter to read the body and a separate signature change. Per plan §16 they are deferred; this plan adds the server-side support class (`CoordinationWriteAudit` or similar) without altering the existing route signature.
- **Tests use `node:assert/strict`.** No `expect` from vitest, no chai. Pattern: `import assert from "node:assert/strict"`.
- **Stateful kernel tests use `mkdtempSync` + `rmSync`** — copy `tests/kernel/coordination-store.test.ts` and `tests/kernel/coordination-result-store.test.ts` as templates.
- **Server tests use real `startServer` + `fetch`.** Copy `tests/server.test.ts` as template; no supertest, no http mock.
- **CLI tests use `execFileSync(dist/src/cli.js)`.** Copy `tests/cli/ownership.test.ts` as template; pre-seed `.alix/coordination/shared/<runId>/state.json` via `CollaborationStore.mutate()`.
- **TUI tests use direct import + string-output assertion.** Copy `tests/tui/chronicle-panel.test.ts` as template. Strip ANSI before asserting.
- **EventLog is not a Node EventEmitter.** It is a JSONL appender with monotonic `seq`. Pattern: `await eventLog.append({ sessionId, actor, type, payload })`. The actor is `{ kind, id }`. The type is a string literal; we use the `CONFLICT_EVENT_TYPES.*` constants from `src/events/types.ts`.
- **AuditStore.append is async with `appendFile` semantics.** Failures are swallowed by callers (`.catch(() => {})`); audit never gates a decision.
- **MinimalMetrics has a closed `M09MetricName` union** at `src/kernel/minimal-metrics.ts:9-16`. Adding a metric requires extending that union and the dispatch in `increment` / `duration`.

---

## 2. Phases and commit ordering

The plan ships in 6 phases. Each task ends with a commit; suggested commit subjects match plan §25.

```
Phase A — Correctness                  (3 tasks, 3 commits)
Phase B — Detector + state + budget    (4 tasks, 4 commits)
Phase C — CLI / server surface         (3 tasks, 3 commits)
Phase D — Observability                (4 tasks, 4 commits)
Phase E — Tests                        (13 tasks, 13 commits)
Phase F — Docs                         (2 tasks, 2 commits)
```

Total: 27 tasks, 27 commits. Reasonable to run in 2-3 days of focused work. The detector is the highest-leverage change; everything else builds on it.

---

# Phase A — Correctness fixes

## Task A1: Tighten `ConflictRepository.authorize()`

**Files:**
- Modify: `src/kernel/collaboration-conflict-repository.ts:100-115`
- Test: existing `tests/kernel/collaboration-conflict-store.test.ts` (added in Task E6) covers the path; until then the change is covered by the build.

- [ ] **Step 1: Write the failing test (deferred to E6).** For now, change the code and let `npm run build` validate type-correctness.
- [ ] **Step 2: Replace the worker branch.** Edit `src/kernel/collaboration-conflict-repository.ts` so the `worker` branch requires a non-empty `allowedConflictIds` that includes the conflict id. The new logic:

```ts
private authorize(
  authority: ConflictResolverAuthority,
  conflict: FindingConflict,
): boolean {
  if (authority.kind === "operator") return true;
  if (authority.kind === "planner") return true;
  if (authority.kind === "worker") {
    return (
      Array.isArray(authority.allowedConflictIds) &&
      authority.allowedConflictIds.includes(conflict.id)
    );
  }
  return false;
}
```

This is the only edit. The `operator` and `planner` branches stay permissive per plan §11.1.

- [ ] **Step 3: Build.**

```bash
npm run build
```

Expected: clean.

- [ ] **Step 4: Commit.**

```bash
git add src/kernel/collaboration-conflict-repository.ts
git commit -m "fix(conflict): require explicit worker authority for conflict resolution

Tighten ConflictRepository.authorize() so a worker resolver is
authorized only when allowedConflictIds is a non-empty array that
includes the target conflict id. The previous implementation
returned true when allowedConflictIds was undefined, defeating the
allowed-list constraint from the M0.78f plan §11.1.

Operator and planner authority remain permissive (full access by
default per the same plan section). The WorkerCollaborationAPI
already passes {kind: 'worker', workerId, allowedConflictIds} for
its bounded resolve path; this change does not alter that surface.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A2: Add `normalizeStateV1_0()` to collaboration-validation

**Files:**
- Modify: `src/kernel/collaboration-validation.ts`
- Test: covered indirectly by Task E6 once `collaboration-conflict-store.test.ts` exists.

- [ ] **Step 1: Read the existing file.** Confirm the file currently only patches `normalizeManifestV1_0` (per the audit). Find the export.
- [ ] **Step 2: Add the function.** Add a sibling export `normalizeStateV1_0(state: any): CollaborationState` that:
  - Returns a new `CollaborationState`-shaped object with `schemaVersion: "1.0"`, `conflicts: []` if missing, `findings: state.findings ?? []`, `artifacts: state.artifacts ?? []`, and passthrough `runId`, `revision`, `createdAt`, `updatedAt`.
  - Does **not** mutate the input.
  - Does **not** write the file — caller decides.

```ts
export function normalizeStateV1_0(state: Partial<CollaborationState> | undefined | null): CollaborationState {
  const now = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    runId: state?.runId ?? "",
    revision: state?.revision ?? 0,
    findings: state?.findings ?? [],
    artifacts: state?.artifacts ?? [],
    conflicts: state?.conflicts ?? [],
    createdAt: state?.createdAt ?? now,
    updatedAt: state?.updatedAt ?? now,
  };
}
```

- [ ] **Step 3: Wire into `CollaborationStore.load()`.** In `src/kernel/collaboration-store.ts`, the loader must call this function on raw parsed state before returning. Add the call where `load()` currently passes through parsed JSON. (Open the file, find the function — exact line numbers will shift, but the pattern is: `return JSON.parse(text)`.)
- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/collaboration-validation.ts src/kernel/collaboration-store.ts
git commit -m "feat(collaboration): add normalizeStateV1_0 and apply on load

Plan §5 requires that older state.json files (schemaVersion 1.0
without a conflicts array) are normalized in memory rather than
rewritten on disk. Add normalizeStateV1_0() to the validation
module and call it from CollaborationStore.load() so consumers
always see a CollaborationState-shaped record with conflicts: [].

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task A3: Add conflict budget to `CollaborationContextBudget`

**Files:**
- Modify: `src/kernel/collaboration-context-builder.ts` (find the budget type/constant)
- Test: covered by Task E10 `tests/kernel/collaboration-context-conflicts.test.ts`.

- [ ] **Step 1: Find the budget type.** Run `grep -n "CollaborationContextBudget" src/ -r`. Read the type/interface declaration.
- [ ] **Step 2: Add a `conflicts` sub-budget.** The current shape varies; the simplest non-breaking change is to add a new optional field. Per plan §15.2 the recommended defaults are `{ maxTokens: 1000, maxItems: 10, maxFindingsPerConflict: 5 }`. The shape:

```ts
export type CollaborationContextBudget = {
  // existing fields preserved
  maxTokens: number;
  maxItems: number;
  findings: { maxTokens: number; maxItems: number };
  artifacts: { maxTokens: number; maxItems: number };
  results: { maxTokens: number; maxItems: number };
  conflicts: { maxTokens: number; maxItems: number; maxFindingsPerConflict: number };
};
```

If the existing budget has a different shape, add `conflicts?` as an optional and resolve with defaults in the builder. (Read the file first; the exact existing shape governs the patch.)

- [ ] **Step 3: Use the budget in the context builder.** When the builder injects conflicts into the snapshot, cap by `conflicts.maxItems` and `conflicts.maxFindingsPerConflict`. The current `queryConflicts({findingIds, statuses:["detected","under_review"]})` slice (in `fb512ad3`) is the loop point. Add a `.slice(0, budget.conflicts.maxItems)` and a per-conflict cap when rendering findings.

  For each injected conflict, cap the finding summaries it includes to `maxFindingsPerConflict`. The simplest way is to pass a `limit` to whatever finds the finding records: `findings.filter(f => conflict.findingIds.includes(f.id)).slice(0, budget.conflicts.maxFindingsPerConflict)`. Add this inside the conflict-injection loop.

- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/collaboration-context-builder.ts
git commit -m "feat(context): add conflict budget to CollaborationContextBudget

Plan §15.2 requires separate caps for conflicts: maxTokens (1000
default), maxItems (10), and maxFindingsPerConflict (5). Add the
new 'conflicts' sub-budget to the existing budget type, default it
when missing, and apply the caps in the conflict-injection path
of the context builder.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase B — Detector + state + budget

## Task B1: Create the `ConflictDetector` orchestrator

**Files:**
- Create: `src/kernel/collaboration-conflict-detector.ts`
- Test: `tests/kernel/collaboration-conflict-detector.test.ts` (Task E5)

- [ ] **Step 1: Write the failing test stub.** Create `tests/kernel/collaboration-conflict-detector.test.ts` with one trivial test:

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
describe("ConflictDetector", () => {
  it("is constructible with minimum dependencies", () => {
    // placeholder; will be filled in step 3
  });
});
```

- [ ] **Step 2: Run test to confirm it fails on import.** Actually the test passes if the module is absent, so the first real assertion must import the class. Defer the import to step 3.
- [ ] **Step 3: Create the module.** Add `src/kernel/collaboration-conflict-detector.ts`:

```ts
/**
 * collaboration-conflict-detector.ts — Orchestrates deterministic conflict
 * detection across active findings in a run.
 *
 * Loads active findings from CollaborationStore, normalizes claims,
 * generates bounded candidate pairs, runs the deterministic comparator,
 * and persists conflicts via ConflictRepository. Optional bounded
 * model assistance for uncertain pairs.
 */

import { CollaborationStore } from "./collaboration-store.js";
import { CoordinationStore } from "./coordination-store.js";
import { CoordinationResultStore } from "./coordination-result-store.js";
import { ConflictRepository } from "./collaboration-conflict-repository.js";
import { ConflictCandidateGenerator } from "./collaboration-conflict-candidates.js";
import { ClaimComparator } from "./collaboration-claim-comparator.js";
import { ConflictEvidenceComparator } from "./collaboration-evidence-comparator.js";
import { ModelConflictComparator } from "./collaboration-model-conflict-comparator.js";
import type { Clock } from "./collaboration-freshness.js";
import { SystemClock } from "./collaboration-freshness.js";
import { canonicalJson, sha256Hex } from "./collaboration-claim-normalizer.js";
import type {
  FindingConflict,
  ClaimComparison,
  EvidenceComparison,
  DetectionMethod,
} from "./collaboration-conflict-types.js";
import type { SharedFinding } from "./collaboration-types.js";

export type ConflictDetectionLimits = {
  maxFindingsPerTopic: number;
  maxPairsPerDetectionPass: number;
};

export const DEFAULT_DETECTION_LIMITS: ConflictDetectionLimits = {
  maxFindingsPerTopic: 20,
  maxPairsPerDetectionPass: 200,
};

export type ConflictDetectionReport = {
  runId: string;
  candidatesExamined: number;
  deterministicConflicts: number;
  modelAssistedConflicts: number;
  compatiblePairs: number;
  uncertainPairs: number;
  omittedPairs: number;
  createdConflictIds: string[];
  updatedConflictIds: string[];
  warnings: string[];
  durationMs: number;
};

export type ConflictDetectorDeps = {
  collabStore: CollaborationStore;
  coordinationStore: CoordinationStore;
  resultStore: CoordinationResultStore;
  candidateGenerator: ConflictCandidateGenerator;
  claimComparator: ClaimComparator;
  evidenceComparator: ConflictEvidenceComparator;
  conflictRepo: ConflictRepository;
  modelComparator?: ModelConflictComparator;
  clock?: Clock;
  limits?: ConflictDetectionLimits;
};

export class ConflictDetector {
  constructor(private deps: ConflictDetectorDeps) {}

  async detectConflicts(
    runId: string,
    options?: { useModelAssistance?: boolean; signal?: AbortSignal },
  ): Promise<ConflictDetectionReport> {
    const start = Date.now();
    const limits = this.deps.limits ?? DEFAULT_DETECTION_LIMITS;
    const clock = this.deps.clock ?? new SystemClock();
    const useModel = options?.useModelAssistance === true;

    const run = await this.deps.coordinationStore.load(runId);
    if (!run) {
      return emptyReport(runId, Date.now() - start, [`run not found: ${runId}`]);
    }
    const findings = await this.deps.collabStore.queryFindings({ runId });
    const activeFindings = findings.filter(f => isActive(f, run));
    const candidates = this.deps.candidateGenerator.generate(
      activeFindings,
      limits,
    );
    const evidenceContext = {
      run,
      findings: activeFindings,
      artifacts: await this.deps.collabStore.queryArtifacts({ runId }),
      dependencyResults: await this.deps.resultStore.load(runId) ?? [],
      clock,
    };

    const report: ConflictDetectionReport = {
      runId,
      candidatesExamined: candidates.pairs.length,
      deterministicConflicts: 0,
      modelAssistedConflicts: 0,
      compatiblePairs: 0,
      uncertainPairs: 0,
      omittedPairs: candidates.omittedPairs,
      createdConflictIds: [],
      updatedConflictIds: [],
      warnings: candidates.warnings,
      durationMs: 0,
    };

    for (const pair of candidates.pairs) {
      const left = activeFindings.find(f => f.id === pair.leftId);
      const right = activeFindings.find(f => f.id === pair.rightId);
      if (!left || !right) continue;

      const cmp = this.deps.claimComparator.compareClaims(left.claim, right.claim);
      if (cmp.compatibility === "compatible") {
        report.compatiblePairs++;
        continue;
      }
      if (cmp.compatibility === "uncertain" && !useModel) {
        report.uncertainPairs++;
        continue;
      }
      if (cmp.compatibility === "uncertain" && useModel && this.deps.modelComparator) {
        const modelOut = await safeModelCompare(this.deps.modelComparator, left, right, options?.signal);
        if (!modelOut || modelOut.compatibility !== "incompatible") {
          report.uncertainPairs++;
          continue;
        }
        report.modelAssistedConflicts++;
      } else if (cmp.compatibility === "incompatible") {
        report.deterministicConflicts++;
      } else {
        report.uncertainPairs++;
        continue;
      }

      const evidence = this.deps.evidenceComparator.compare([left, right]);
      const fingerprint = computeConflictFingerprint({
        runId,
        type: cmp.type ?? "contradiction",
        topicKey: pair.topicKey,
        findingIds: [left.id, right.id].sort(),
        comparatorVersion: cmp.comparatorVersion,
      });
      const detectedBy: DetectionMethod[] = cmp.compatibility === "incompatible"
        ? ["deterministic"]
        : ["model_assisted"];

      const { conflict, created } = await this.deps.conflictRepo.upsertConflict(runId, {
        conflictFingerprint: fingerprint,
        topicKey: pair.topicKey,
        type: cmp.type ?? "contradiction",
        findingIds: [left.id, right.id],
        claimComparisons: [cmp],
        evidenceComparison: evidence,
        detectedBy,
        criticality: "warning",
        blocksDownstreamByPolicy: false,
      });
      if (created) report.createdConflictIds.push(conflict.id);
      else report.updatedConflictIds.push(conflict.id);
    }

    report.durationMs = Date.now() - start;
    return report;
  }
}

function emptyReport(runId: string, durationMs: number, warnings: string[]): ConflictDetectionReport {
  return {
    runId, candidatesExamined: 0, deterministicConflicts: 0,
    modelAssistedConflicts: 0, compatiblePairs: 0, uncertainPairs: 0,
    omittedPairs: 0, createdConflictIds: [], updatedConflictIds: [],
    warnings, durationMs,
  };
}

function isActive(f: SharedFinding, run: any): boolean {
  if (f.invalidatedAt) return false;
  if (f.supersededBy) return false;
  const src = run.workers.find((w: any) => w.id === f.workerId);
  if (!src) return false;
  if ((f.workerAttempt ?? 0) < src.attempt) return false;
  return true;
}

async function safeModelCompare(
  c: ModelConflictComparator,
  left: SharedFinding,
  right: SharedFinding,
  signal?: AbortSignal,
) {
  try {
    return await c.compare({ left, right }, { timeoutMs: 5_000, signal });
  } catch {
    return null;
  }
}

function computeConflictFingerprint(input: {
  runId: string; type: string; topicKey: string; findingIds: string[]; comparatorVersion: string;
}): string {
  const payload = {
    runId: input.runId,
    type: input.type,
    topic: input.topicKey,
    findings: input.findingIds,
    version: input.comparatorVersion,
  };
  return sha256Hex(canonicalJson(payload));
}
```

If `collaboration-claim-normalizer.js` does not export `canonicalJson` and `sha256Hex` (read it to confirm), expose them from there first — or inline a minimal `canonicalJson` (sorted keys, deterministic) and a `createHash` from `node:crypto`. The plan does not mandate a specific hash; use `createHash("sha256")` for determinism.

- [ ] **Step 4: Build.**

```bash
npm run build
```

Expect errors if any imported symbol doesn't exist on the existing modules. Resolve by either exposing the symbol from the existing module (e.g., add `export` to `collaboration-claim-normalizer.ts`) or replacing the import with an inline implementation. Do **not** invent new dependencies.

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/collaboration-conflict-detector.ts
git commit -m "feat(conflict): add deterministic conflict detection pipeline

Wires the existing pipeline components into a single class per
plan §10:

  CollaborationStore.queryFindings → ConflictCandidateGenerator →
  ClaimComparator → (optional) ModelConflictComparator →
  ConflictEvidenceComparator → ConflictRepository.upsertConflict

The detector loads the run via CoordinationStore, filters active
findings (current source-worker attempt, not invalidated, not
superseded), generates bounded candidate pairs, classifies each
pair's compatibility, optionally consults a bounded model
comparator for uncertain pairs, then persists via fingerprint
dedup. Returns a ConflictDetectionReport with created/updated
conflict ids, per-pair counts, and timing.

No call site is added in this commit — the detector is a pure
class that any run lifecycle hook can invoke. Wiring into the
scheduler/agent-loop is a follow-up.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B2: Wire `ConflictDetector` into the run lifecycle

**Files:**
- Modify: `src/kernel/coordination-scheduler.ts` (most likely call site — read first)
- Test: integration coverage comes from E13.

- [ ] **Step 1: Find the run-completion / worker-completion hook.** Run `grep -n "emit\|append\|complete" src/kernel/coordination-scheduler.ts | head`. Look for where the run transitions to a terminal state, or where a worker completes and the run is "stable" enough to detect conflicts.
- [ ] **Step 2: Add a one-shot detect call.** At the chosen hook, instantiate a `ConflictDetector` with the relevant dependencies and call `detectConflicts(runId)`. The simplest instantiation:

```ts
import { ConflictDetector } from "./collaboration-conflict-detector.js";
import { ConflictCandidateGenerator } from "./collaboration-conflict-candidates.js";
import { ClaimComparator } from "./collaboration-claim-comparator.js";
import { ConflictEvidenceComparator } from "./collaboration-evidence-comparator.js";
import { ConflictRepository } from "./collaboration-conflict-repository.js";

const collabStore = new CollaborationStore(cwd, runId);
const conflictRepo = new ConflictRepository(collabStore);
const detector = new ConflictDetector({
  collabStore,
  coordinationStore: this.store,
  resultStore: new CoordinationResultStore(cwd),
  candidateGenerator: new ConflictCandidateGenerator(),
  claimComparator: new ClaimComparator(),
  evidenceComparator: new ConflictEvidenceComparator(new SystemClock()),
  conflictRepo,
});
const report = await detector.detectConflicts(runId);
```

(The exact code depends on the file's existing imports. Read first.)

- [ ] **Step 3: Add a feature flag.** Wrap the call in `if (this.options?.enableConflictDetection)` so we can disable it in case a bug surfaces post-merge. Default the flag to `true` in the scheduler's options.
- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/coordination-scheduler.ts
git commit -m "feat(conflict): invoke detector on run lifecycle hook

Wire ConflictDetector.detectConflicts() into the run lifecycle so
deterministic conflicts are produced alongside worker reports. The
detector is invoked once per run at a stable point (worker
completion or run finalization — see chosen hook in this commit)
and its report is currently discarded; future tasks can use the
report for metrics and audit.

Gated behind a feature flag (default true) so we can disable
without redeploying if a regression surfaces.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B3: Add `updated` history entry on conflict dedup-update

**Files:**
- Modify: `src/kernel/collaboration-conflict-repository.ts:35-82`
- Test: covered by E6.

- [ ] **Step 1: Patch `upsertConflict`.** In the dedup branch (line 49-57), append a history entry to `existing`:

```ts
if (existing) {
  existing.updatedAt = new Date().toISOString();
  if (input.detectedBy[0] && !existing.detectedBy.includes(input.detectedBy[0])) {
    existing.detectedBy.push(input.detectedBy[0]);
  }
  existing.evidenceComparison = input.evidenceComparison;
  this.addHistory(existing, "updated");
  return existing;
}
```

The `addHistory` call passes no actor (the dedup path doesn't have one). Plan §11.3 lists `updated` as a valid action; the `addHistory` helper already accepts it.

- [ ] **Step 2: Build.**

```bash
npm run build
```

- [ ] **Step 3: Commit.**

```bash
git add src/kernel/collaboration-conflict-repository.ts
git commit -m "fix(conflict): append 'updated' history entry on dedup path

ConflictRepository.upsertConflict's dedup branch updated fields
silently — the existing 'updated' history action was defined on
ConflictHistoryEntry but never recorded. Append an entry with no
actor so lifecycle consumers can observe the merge.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task B4: Add `acceptConflictDivergence` to the repository

**Files:**
- Modify: `src/kernel/collaboration-conflict-repository.ts`
- Test: covered by E6.

- [ ] **Step 1: Add a named method.** Per plan §11.1, `acceptConflictDivergence` is one of the lifecycle operations. Add it as a dedicated method (not just a status update) so it can capture the `reason` and set status atomically:

```ts
async acceptConflictDivergence(
  id: string,
  reason: string,
  authority: ConflictResolverAuthority,
): Promise<FindingConflict | null> {
  return this.collabStore.mutate((state: any) => {
    state.conflicts = state.conflicts ?? [];
    const conflict = state.conflicts.find((c: FindingConflict) => c.id === id);
    if (!conflict || !this.authorize(authority, conflict)) return null;
    if (conflict.status === "resolved" || conflict.status === "superseded") return null;
    conflict.status = "accepted_divergence";
    conflict.updatedAt = new Date().toISOString();
    this.addHistory(
      conflict,
      "accepted_divergence",
      {
        kind: authority.kind,
        id:
          (authority as any).actorId ??
          (authority as any).workerId ??
          (authority as any).plannerId ??
          "unknown",
      },
      reason,
    );
    return conflict;
  });
}
```

- [ ] **Step 2: Build.**

```bash
npm run build
```

- [ ] **Step 3: Commit.**

```bash
git add src/kernel/collaboration-conflict-repository.ts
git commit -m "feat(conflict): add acceptConflictDivergence lifecycle method

Plan §11.1 lists acceptConflictDivergence as a dedicated operation
distinct from generic updateConflictStatus. Implement it on
ConflictRepository so the CLI/Inspector/worker API can capture a
free-text reason alongside the status transition in a single
atomic mutate, with the standard authorize() check and history
entry.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase C — CLI / server surface

## Task C1: Add `--actor` / `--reason` flags and `conflict-accept-divergence` to CLI

**Files:**
- Modify: `src/cli/commands/coordination.ts`

- [ ] **Step 1: Add the new subcommand case.** Add `case "conflict-accept-divergence":` to the switch (around line 62). Wire to `handleConflictAcceptDivergence(cwd, args.slice(1))`.
- [ ] **Step 2: Add `--actor` / `--reason` parsing.** Add a small parser at the top of the file:

```ts
function readFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx === -1 ? undefined : args[idx + 1];
}
function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}
```

- [ ] **Step 3: Patch the three resolution handlers.** Each one must:
  1. Read `--actor <id>` (default `"cli"`), `--reason <text>`, `--json`.
  2. Build authority `{ kind: "operator", actorId: <actor> }` for resolve/dismiss; same for accept-divergence.
  3. Pass reason through to the repository method.

For `handleConflictResolve`:

```ts
async function handleConflictResolve(cwd: string, args: string[]): Promise<void> {
  const jsonMode = hasFlag(args, "--json");
  const pos = args.filter(a => !a.startsWith("--") && args.indexOf(a) < (args.indexOf("--actor") === -1 ? args.length : args.indexOf("--actor")) &&
                                     (args.indexOf(a) < (args.indexOf("--reason") === -1 ? args.length : args.indexOf("--reason"))));
  // simpler: take first two positional args
  const positional = args.filter(a => !a.startsWith("--") && !isFlagValue(args, a));
  if (positional.length < 2) {
    console.error("Usage: alix coordination conflict-resolve <run-id> <conflict-id> [--actor <id>] [--reason <text>] [--json]");
    process.exit(1);
  }
  const runId = positional[0];
  const conflictId = positional[1];
  const actor = readFlag(args, "--actor") ?? "cli";
  const reason = readFlag(args, "--reason") ?? "resolved by operator";
  const store = new CollaborationStore(cwd, runId);
  const repo = new ConflictRepository(store);
  const conflict = await repo.resolveConflict(conflictId, {
    decision: reason,
    acceptedFindingIds: [], rejectedFindingIds: [],
    resolver: { kind: "operator", id: actor },
    evidenceRefs: [], resolvedAt: new Date().toISOString(),
  }, { kind: "operator", actorId: actor });
  if (jsonMode) console.log(JSON.stringify(conflict, null, 2));
  else if (!conflict) { console.error("Conflict not found or not authorized."); process.exit(1); }
  else console.log(`Resolved: ${conflictId}`);
}
```

`isFlagValue` returns true when `a` immediately follows `--actor` or `--reason` so the parser skips flag values. (The simpler version is to use a real arg-parser — but per plan YAGNI, this is enough for the first cut.)

- [ ] **Step 4: Implement the new accept-divergence handler.** Mirror the dismiss handler, calling `acceptConflictDivergence(conflictId, reason, authority)`.
- [ ] **Step 5: Build.**

```bash
npm run build
```

- [ ] **Step 6: Commit.**

```bash
git add src/cli/commands/coordination.ts
git commit -m "feat(visibility): add --actor and --reason flags to conflict CLI commands

Per plan §16, resolution commands require explicit actor and reason
handling with audit. Extend the three resolution subcommands
(conflict-resolve, conflict-dismiss, conflict-accept-divergence)
to accept --actor <id> and --reason <text> flags, defaulting
actor to 'cli' when omitted. Also add the missing
conflict-accept-divergence subcommand itself (it was not wired in
the original visibility commit). All three support --json.

Authority is built as { kind: 'operator', actorId: <actor> } for
all resolution commands; the conflict-accept-divergence command
uses the dedicated repository method (added in B4) so the reason
is persisted atomically with the status transition.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C2: Surface conflicts in `handleInspect`

**Files:**
- Modify: `src/cli/commands/coordination.ts` (the `handleInspect` function)

- [ ] **Step 1: Read `handleInspect`.** Find the function (around line 349-371) and identify the printout shape.
- [ ] **Step 2: Add a conflicts summary line.** After the existing summary fields, print a conflicts block when `view.conflictCount` is non-zero:

```ts
if (typeof view.conflictCount === "number" && view.conflictCount > 0) {
  console.log(`Unresolved conflicts: ${view.conflictCount}`);
  for (const c of view.conflicts ?? []) {
    console.log(`  - ${c.id}  ${c.type}  ${c.criticality}  (${c.findingCount} findings, ${c.evidenceRecommendation})`);
  }
}
```

- [ ] **Step 3: Build.**

```bash
npm run build
```

- [ ] **Step 4: Commit.**

```bash
git add src/cli/commands/coordination.ts
git commit -m "feat(visibility): surface conflicts in alix coordination inspect

The shared CoordinationRunView already carries conflictCount and
conflicts after the visibility commits, but handleInspect did
not display them. Add a 'Unresolved conflicts' section to the
inspect output that lists id, type, criticality, finding count,
and evidence recommendation per conflict.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task C3: Add `criticalConflictCount` to the shared view

**Files:**
- Modify: `src/kernel/coordination-view.ts`
- Test: covered by existing TUI/Inspector tests once E11/E12 land.

- [ ] **Step 1: Add the field.** The current `CoordinationRunView` exposes `conflictCount` and `conflicts: CoordinationConflictView[]`. Add `criticalConflictCount: number` (count of `c.criticality === "critical"`) to the view, populated in `buildCoordinationRunView` next to the existing `conflictCount` assignment:

```ts
const criticalConflictCount = (conflicts ?? []).filter(c => c.criticality === "critical").length;
```

Include in the return object.

- [ ] **Step 2: Build.**

```bash
npm run build
```

- [ ] **Step 3: Commit.**

```bash
git add src/kernel/coordination-view.ts
git commit -m "feat(visibility): expose criticalConflictCount on the shared view

Plan §16 calls out unresolvedConflictCount and criticalConflictCount
as fields on CoordinationRunView. The existing visibility commits
exposed conflictCount only. Add criticalConflictCount alongside it
so operators can quickly see whether any conflict is policy-level
critical.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase D — Observability

## Task D1: Inject `EventLog` into `ConflictRepository` and emit lifecycle events

**Files:**
- Modify: `src/kernel/collaboration-conflict-repository.ts`
- Test: covered by E6 (one assertion per emit path).

- [ ] **Step 1: Add an `EventLog?` constructor param.** Extend the constructor:

```ts
constructor(
  private collabStore: CollaborationStore,
  private eventLog?: { append: (e: any) => Promise<any> },
) {}
```

Using a structural type (just `append`) keeps the repository decoupled from the concrete `EventLog` class and makes unit testing trivial (pass a mock).

- [ ] **Step 2: Add a private emit helper.**

```ts
private async emit(type: string, payload: Record<string, unknown>, actor: { kind: string; id: string }): Promise<void> {
  if (!this.eventLog) return;
  try {
    await this.eventLog.append({
      type,
      payload,
      actor,
    });
  } catch {
    // best-effort; never gate on observability
  }
}
```

`sessionId` is filled by the EventLog itself (read its API to confirm); if it requires it on the call, pass a placeholder `"conflict-detector"` and let the log accept it.

- [ ] **Step 3: Emit at each lifecycle point.** Wire:
  - `upsertConflict` create branch → `emit(CONFLICT_EVENT_TYPES.DETECTED, { runId, conflictId, fingerprint, type, findingIds, criticality }, { kind: "detector", id: "ConflictDetector" })`.
  - `upsertConflict` dedup branch → `emit(CONFLICT_EVENT_TYPES.UPDATED, { runId, conflictId, fingerprint }, same actor)`.
  - `updateConflictStatus` when status changes to `under_review` → `CONFLICT_EVENT_TYPES.UNDER_REVIEW`. (Use the same `status as any` cast that's already there; only emit when `status === "under_review"` to avoid noise.)
  - `resolveConflict` → `CONFLICT_EVENT_TYPES.RESOLVED`.
  - `acceptConflictDivergence` → `CONFLICT_EVENT_TYPES.ACCEPTED_DIVERGENCE`.
  - `updateConflictStatus` when `status === "dismissed"` → `CONFLICT_EVENT_TYPES.DISMISSED`.
  - When `status === "superseded"` (rare, currently not directly settable) → `SUPERSEDED`.

The `actor` for the emit should be the resolver authority's `kind`/`id` for resolve/dismiss/accept-divergence/under-review, and `{ kind: "detector", id: "ConflictDetector" }` for detect/update.

- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/collaboration-conflict-repository.ts
git commit -m "feat(observability): emit conflict lifecycle events from ConflictRepository

Wire the 9 CONFLICT_EVENT_TYPES into the repository's lifecycle
methods. The repository gains an optional EventLog dependency
(structural type — any object with append); emit failures are
swallowed so observability never gates a decision. Detector-origin
emissions (DETECTED, UPDATED) use { kind: 'detector', id:
'ConflictDetector' } as the actor; resolution-path emissions
(RESOLVED, DISMISSED, ACCEPTED_DIVERGENCE, UNDER_REVIEW) use the
resolver authority. No full finding content is included in the
payload per plan §18.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task D2: Add conflict actions to `AuditAction` and record on lifecycle

**Files:**
- Modify: `src/audit/audit-types.ts`, `src/kernel/collaboration-conflict-repository.ts`

- [ ] **Step 1: Extend the union.** Read `src/audit/audit-types.ts`, find `AuditAction`. Add 6 new literals:

```ts
export type AuditAction =
  | /* existing 15 */
  | "conflict.detected"
  | "conflict.reported"
  | "conflict.under_review"
  | "conflict.resolved"
  | "conflict.accepted_divergence"
  | "conflict.dismissed";
```

- [ ] **Step 2: Add an `AuditStore?` constructor param to `ConflictRepository`.** Mirror the EventLog pattern. Use a structural type `{ append: (e: any) => Promise<any> }`.
- [ ] **Step 3: Add an audit helper and call sites.** Per plan §18 the audit records must include `candidate generation`, `claim comparison`, `worker report`, `evidence comparison`, `model-assisted decision`, `lifecycle transition`, `resolver identity`, `resolution evidence`. Of these, the repository can record the lifecycle transitions and resolution evidence; the detector records the rest (D3 below).

  Add a private `audit(action, details)` method that calls `this.auditStore?.append({ action, details })` and swallows errors. Call it at the same points as the event emit, with `details: { runId, conflictId, actorId, reason? }`.
- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/audit/audit-types.ts src/kernel/collaboration-conflict-repository.ts
git commit -m "feat(observability): record conflict lifecycle in audit store

Add 6 conflict.* actions to the AuditAction union and route the
repository's lifecycle methods through AuditStore.append. Like
event emission, audit is best-effort and never gates a decision.
The audit record carries run id, conflict id, actor id, and the
free-text reason for the transition.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task D3: Record detection-time audit + metrics in `ConflictDetector`

**Files:**
- Modify: `src/kernel/collaboration-conflict-detector.ts`

- [ ] **Step 1: Add `auditStore?` and `metrics?` to `ConflictDetectorDeps`.** Structural types as in D1/D2.
- [ ] **Step 2: Record detection audit.** At the start of `detectConflicts`, call `auditStore?.append({ action: "conflict.candidate_generation", details: { runId, candidateCount: candidates.pairs.length } })`. After the loop, append `conflict.evidence_comparison` once with the report summary.
- [ ] **Step 3: Increment metrics at the end.** Use the existing `MinimalMetrics.increment` pattern; add the new metric names in D4 first, then wire them here:

```ts
await this.deps.metrics?.increment("collaboration_conflicts_detected_total", { type: report.deterministicConflicts > 0 ? "deterministic" : "none" });
await this.deps.metrics?.increment("collaboration_conflict_candidates_total", { result: "examined" }, candidates.pairs.length);
await this.deps.metrics?.duration("collaboration_conflict_detection_duration_ms", report.durationMs);
```

- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/collaboration-conflict-detector.ts
git commit -m "feat(observability): record detection audit and metrics in ConflictDetector

Plan §18 specifies audit points for candidate generation, claim
comparison, evidence comparison, and model-assisted decisions.
Add audit store and metrics to the detector's dependencies and
emit a candidate_generation audit entry plus the 3 detection-time
metrics (candidates_total, detected_total, detection_duration_ms)
at the end of each detectConflicts call.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task D4: Extend `M09MetricName` with 12 conflict metrics

**Files:**
- Modify: `src/kernel/minimal-metrics.ts`

- [ ] **Step 1: Read the file.** Confirm the current 7-name union and the dispatch in `increment` / `duration`.
- [ ] **Step 2: Extend the union.** Add the 12 names from plan §18:

```ts
export type M09MetricName =
  | /* existing 7 */
  | "collaboration_conflict_candidates_total"
  | "collaboration_conflicts_detected_total"
  | "collaboration_conflicts_updated_total"
  | "collaboration_conflicts_resolved_total"
  | "collaboration_conflicts_dismissed_total"
  | "collaboration_conflicts_by_type"
  | "collaboration_conflict_detection_duration_ms"
  | "collaboration_conflict_pairs_omitted_total"
  | "collaboration_conflict_model_compare_total"
  | "collaboration_conflict_model_compare_failed_total"
  | "collaboration_conflict_context_included_total"
  | "collaboration_conflict_context_omitted_total";
```

The dispatch in `increment` / `duration` likely uses a switch on the union — extend the switch to handle the new names. If the dispatch is a no-op stub (record-then-drop), no change is needed; if it does anything per-name, add a default no-op case for the new ones.

- [ ] **Step 3: Wire the 9 context/resolve metrics to their call sites.**
  - `collaboration_conflicts_resolved_total` → ConflictRepository.resolveConflict, label `{ result: "ok" | "denied" }`.
  - `collaboration_conflicts_dismissed_total` → updateConflictStatus when status changes to "dismissed".
  - `collaboration_conflict_pairs_omitted_total` → ConflictDetector, label `{ reason: "topic_cap" | "pass_cap" }`.
  - `collaboration_conflict_model_compare_total` and `_failed_total` → ConflictDetector.
  - `collaboration_conflict_context_included_total` / `_omitted_total` → CollaborationContextBuilder (label `{ reason: "budget" | "irrelevant" | "resolved" }`).

  This is the most invasive wiring change. For each call site, find the relevant function and add a `metrics?.increment(...)` call at the appropriate branch. Make these edits inline; do not refactor the call sites.

- [ ] **Step 4: Build.**

```bash
npm run build
```

- [ ] **Step 5: Commit.**

```bash
git add src/kernel/minimal-metrics.ts src/kernel/collaboration-conflict-repository.ts src/kernel/collaboration-conflict-detector.ts src/kernel/collaboration-context-builder.ts
git commit -m "feat(observability): add 12 conflict metrics to MinimalMetrics

Extend the closed M09MetricName union with the 12 conflict metric
names from plan §18. Wire the context, resolve, dismiss,
candidate-omission, and model-compare metrics at their respective
call sites with low-cardinality labels (type, status, method,
recommendation, criticality, result). The detection-time metrics
are already wired in D3.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase E — Tests

The 13 test files in plan §19. Each is a single task. Use the templates from the explore report:
- Stateful kernel tests → `tests/kernel/coordination-result-store.test.ts` (real disk + mkdtempSync + rmSync).
- Pure-function tests → `tests/kernel/coordination-store.test.ts` lines 133-169 (`recomputeRunStatus`).
- CLI → `tests/cli/ownership.test.ts` (spawn `dist/src/cli.js`).
- TUI → `tests/tui/chronicle-panel.test.ts` (direct import + string output).
- Server → `tests/server.test.ts` (`startServer` + `fetch`).
- Integration → `tests/integration/approval-lifecycle.integration.test.ts` (mkdtemp + real stores + serial).

All kernel/tool/server/tui tests go under `tests/<area>/`. The single integration test goes under `tests/integration/`.

For each task, the structure is identical:
1. Create the test file.
2. Write the assertions for the test matrix items listed below.
3. Run the test (via `npm run build` then `node --test dist/tests/<path>` or `npm run test:node:ci`).
4. Fix any failures.
5. Commit.

The test matrix items are pulled from plan §21. Each task lists the items it covers.

---

## Task E1: `tests/kernel/collaboration-claim-normalizer.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-claim-normalizer.test.ts`

**Covers (plan §21 "Claim normalization"):**
- boolean claims
- numeric claims
- version claims
- digest claims
- path claims
- ambiguous prose returns null
- stable topic key
- normalization version changes fingerprint

- [ ] **Step 1: Create the file.** Use the `coordination-store.test.ts` lines 133-169 template (no tmp dir needed — the normalizer is a pure function). Import `extractClaim`, `normalizeClaim`, `computeTopicKey` from `../../src/kernel/collaboration-claim-normalizer.js`. (Open the source first to confirm the exports.)
- [ ] **Step 2: Add tests.** One test per matrix item above. For each, assert the structured output:

```ts
it("extracts boolean claim from 'true'", () => {
  const claim = extractClaim("flag = true", "structured", "1.0");
  assert.ok(claim);
  assert.equal(claim?.value, "true");
  assert.equal(claim?.valueType, "boolean");
});
```

- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-claim-normalizer.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-claim-normalizer.test.ts
git commit -m "test(conflict): cover claim normalization (boolean, number, version, digest, path, ambiguous, topic, version-pinned fingerprint)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E2: `tests/kernel/collaboration-conflict-candidates.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-conflict-candidates.test.ts`

**Covers (plan §21 "Candidate generation"):**
- compatible shared-tag findings are only candidates
- unrelated broad-tag findings do not cluster incorrectly
- stale attempt excluded
- invalidated excluded
- superseded excluded
- bounded pair count
- deterministic pair order

- [ ] **Step 1: Create the file.** Template: `coordination-store.test.ts` `recomputeRunStatus` block (pure function).
- [ ] **Step 2: Add tests.** Use `ConflictCandidateGenerator.generate` (import path `../../src/kernel/collaboration-conflict-candidates.js` — confirm the class name first). Construct minimal `SharedFinding[]` inputs and assert on the returned `pairs`, `omittedPairs`, and `warnings`.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-conflict-candidates.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-conflict-candidates.test.ts
git commit -m "test(conflict): cover candidate generation (active-only, bounded, deterministic)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E3: `tests/kernel/collaboration-claim-comparator.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-claim-comparator.test.ts`

**Covers (plan §21 "Claim comparison"):**
- true vs false incompatible
- same value compatible
- different enum decision incompatible
- numeric difference within tolerance compatible
- numeric difference beyond tolerance incompatible
- non-overlapping scopes different_scope
- ambiguous claims uncertain
- artifact digest mismatch

- [ ] **Step 1: Create the file.** Pure-function template.
- [ ] **Step 2: Add tests.** Import `ClaimComparator` from `../../src/kernel/collaboration-claim-comparator.js`. For each test, construct two `FindingClaim` literals, call `compareClaims`, assert `compatibility` and `type`.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-claim-comparator.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-claim-comparator.test.ts
git commit -m "test(conflict): cover claim comparator rules (boolean, enum, number tolerance, version, digest, scope)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E4: `tests/kernel/collaboration-evidence-comparator.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-evidence-comparator.test.ts`

**Covers (plan §21 "Evidence comparison"):**
- strong test result ranks higher
- broken evidence penalized
- confidence alone is insufficient
- prior attempt excluded
- score margin computed
- recommendation deterministic
- no finding mutation

- [ ] **Step 1: Create the file.** Pure-function template. Use a `SystemClock` stub (or any `Clock` from `../../src/kernel/collaboration-freshness.js`).
- [ ] **Step 2: Add tests.** Import `ConflictEvidenceComparator`. For "no finding mutation," take a snapshot of the input array, run `compare`, assert deep-equal afterward.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-evidence-comparator.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-evidence-comparator.test.ts
git commit -m "test(conflict): cover evidence comparator (ranking, penalty, margin, recommendation, no-mutation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E5: `tests/kernel/collaboration-conflict-detector.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-conflict-detector.test.ts`
- (Refines the stub from Task B1 step 1.)

**Covers (plan §21 "End-to-end" partial):**
- detector creates one conflict
- repeated detection updates, not duplicates
- deterministic vs model-assisted paths

- [ ] **Step 1: Extend the stub.** Replace the placeholder with real tests. Use the `mkdtempSync` + `rmSync` template (`coordination-result-store.test.ts`).
- [ ] **Step 2: Add tests.** Instantiate a real `CollaborationStore` + `CoordinationStore` in `beforeEach`, seed two findings with incompatible claims, construct a `ConflictDetector` with all dependencies, call `detectConflicts`, assert exactly one conflict was created and one report entry.

  For "repeated detection updates, not duplicates," call `detectConflicts` twice and assert `createdConflictIds` is non-empty on the first call and `updatedConflictIds` is non-empty on the second.

  For "model-assisted path," pass a `modelComparator` that returns `{ compatibility: "incompatible", confidence: 0.9, reasons: ["unit test"] }` and assert the conflict's `detectedBy` includes `"model_assisted"`.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-conflict-detector.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-conflict-detector.test.ts
git commit -m "test(conflict): cover ConflictDetector (create-once, update-on-repeat, model-assisted path)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E6: `tests/kernel/collaboration-conflict-store.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-conflict-store.test.ts`

**Covers (plan §21 "Persistence"):**
- create conflict
- fingerprint dedup
- update detectedBy
- preserve resolved history
- under-review transition
- resolve with authority
- unauthorized resolve rejected (covers A1 fix)
- accept divergence (covers B4)
- dismiss
- concurrent upsert safe
- legacy state normalized (covers A2)

- [ ] **Step 1: Create the file.** Use the `coordination-result-store.test.ts` template (mkdtemp + rmSync + `existsSync` checks).
- [ ] **Step 2: Add tests.** Cover each item. For "concurrent upsert safe," fire two `Promise.all([repo.upsertConflict(...), repo.upsertConflict(...)])` with the same fingerprint and assert only one is created.

  For "unauthorized resolve rejected," pass `{ kind: "worker", workerId: "w1" }` (no `allowedConflictIds`) to `resolveConflict` and assert the result is `null` (proves the A1 fix).

  For "legacy state normalized," pre-write a `state.json` with `schemaVersion: "1.0"` and no `conflicts` field, then load via `CollaborationStore`, and assert `state.conflicts` is `[]`.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-conflict-store.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-conflict-store.test.ts
git commit -m "test(conflict): cover ConflictRepository lifecycle (create, dedup, resolve, accept, dismiss, auth, normalize, concurrent)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E7: `tests/kernel/worker-collaboration-conflict-api.test.ts`

**Files:**
- Create: `tests/kernel/worker-collaboration-conflict-api.test.ts`

**Covers (plan §21 "Worker reporting"):**
- same-run findings accepted
- missing finding rejected
- cross-run finding rejected
- duplicate IDs rejected
- fewer than two IDs rejected
- worker cannot resolve
- bounded list output

- [ ] **Step 1: Create the file.** Template: `coordination-result-store.test.ts` (real disk).
- [ ] **Step 2: Add tests.** Use `WorkerCollaborationAPI` (or `BoundWorkerCollaborationAPI` — read the source to confirm the public surface) and assert on the validation errors.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/worker-collaboration-conflict-api.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/worker-collaboration-conflict-api.test.ts
git commit -m "test(conflict): cover worker report/list API (validation, no-resolve, bounded output)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E8: `tests/tools/collaboration-conflict-tools.test.ts`

**Files:**
- Create: `tests/tools/collaboration-conflict-tools.test.ts`

**Covers (plan §21 "Worker reporting" continued):**
- tool cannot set run/worker identity
- bounded list output (default 20, unresolved only)

- [ ] **Step 1: Create the file.** Pure-function test (the tool wrappers don't touch the store directly; they validate inputs and call the API).
- [ ] **Step 2: Add tests.** Import the two tools from `../../src/tools/collaboration-tools.js`. Call with sample inputs, assert the result shape.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/tools/collaboration-conflict-tools.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/tools/collaboration-conflict-tools.test.ts
git commit -m "test(conflict): cover collaboration.report_conflict and list_conflicts tools

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E9: `tests/kernel/collaboration-context-conflicts.test.ts`

**Files:**
- Create: `tests/kernel/collaboration-context-conflicts.test.ts`

**Covers (plan §21 "Context integration"):**
- relevant unresolved conflict included
- unrelated conflict omitted
- resolved conflict omitted by default
- conflict budget enforced (covers A3)
- findings per conflict capped (covers A3)
- omission counts correct
- renderer marks conflicts untrusted
- context fingerprint changes with conflict update

- [ ] **Step 1: Create the file.** Template: `coordination-result-store.test.ts` (real disk).
- [ ] **Step 2: Add tests.** Build a `CollaborationContextBuilder` with a small budget (`{ conflicts: { maxItems: 2, maxFindingsPerConflict: 1, maxTokens: 500 } }`), seed 5 conflicts, build the context, assert at most 2 are included and each carries at most 1 finding. For "renderer marks untrusted," assert the rendered text contains `<shared_conflicts trust="untrusted">`.
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/kernel/collaboration-context-conflicts.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/kernel/collaboration-context-conflicts.test.ts
git commit -m "test(conflict): cover context integration (budget, cap, omit, untrusted, fingerprint)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E10: `tests/cli/coordination-conflicts.test.ts`

**Files:**
- Create: `tests/cli/coordination-conflicts.test.ts`

**Covers (plan §21 "Visibility"):**
- CLI list/detail JSON (covers C1 and C2)
- `--actor` and `--reason` flag wiring
- `conflict-accept-divergence` works
- `alix coordination inspect` includes conflict count

- [ ] **Step 1: Create the file.** Template: `tests/cli/ownership.test.ts` (spawn `dist/src/cli.js` with `cwd: dir`).
- [ ] **Step 2: Add tests.** Pre-seed `state.json` via `CollaborationStore.mutate`, spawn the CLI, assert stdout.

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(process.cwd(), "dist", "src", "cli.js");
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "conflict-cli-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

it("lists conflicts for a run", () => {
  // pre-seed
  const runId = "r1";
  const collabDir = join(dir, ".alix", "coordination", "shared", runId);
  mkdirSync(collabDir, { recursive: true });
  writeFileSync(join(collabDir, "state.json"), JSON.stringify({
    schemaVersion: "1.0", runId, revision: 1,
    findings: [], artifacts: [],
    conflicts: [{
      id: "conflict_1", schemaVersion: "1.0", runId,
      conflictFingerprint: "fp1", topicKey: "t1", type: "contradiction",
      status: "detected", findingIds: ["f1", "f2"],
      claimComparisons: [], evidenceComparison: {
        ranking: [], confidence: "low", scoreMargin: 0,
        recommendation: "human_review", unresolvedReasons: []
      },
      detectedBy: ["deterministic"], criticality: "warning",
      blocksDownstreamByPolicy: false, history: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }],
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }, null, 2));
  const out = execFileSync(process.execPath, [CLI, "coordination", "conflicts", runId], { cwd: dir, encoding: "utf-8" });
  assert.ok(out.includes("conflict_1"));
});
```

Add similar tests for `conflict` (detail), `conflict-resolve` with `--actor --reason`, `conflict-accept-divergence`, and `inspect` showing conflicts.

- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/cli/coordination-conflicts.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/cli/coordination-conflicts.test.ts
git commit -m "test(conflict): cover CLI conflict subcommands (list, detail, resolve, dismiss, accept-divergence, inspect)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E11: `tests/tui/coordination-conflicts.test.ts`

**Files:**
- Create: `tests/tui/coordination-conflicts.test.ts`

**Covers (plan §21 "Visibility"):**
- TUI count/detail
- panel does NOT import runtime stores (architecture invariant)

- [ ] **Step 1: Create the file.** Template: `tests/tui/chronicle-panel.test.ts` (direct import + string output).
- [ ] **Step 2: Add tests.** Import `formatCoordinationPanel` from `../../src/tui/coordination-panel.js`. Build a `CoordinationPanelData` literal with `viewMode: "conflicts"` and a few `view.conflicts`, call the formatter, assert substring presence.

  Add the architecture-invariant test (mirror `ifamas-panel.test.ts`):

```ts
import { readFileSync } from "node:fs";
it("does NOT import ConflictRepository or CollaborationStore", () => {
  const source = readFileSync("src/tui/coordination-panel.ts", "utf-8");
  assert.ok(!source.includes("ConflictRepository"));
  assert.ok(!source.includes("CollaborationStore"));
});
```

- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/tui/coordination-conflicts.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/tui/coordination-conflicts.test.ts
git commit -m "test(conflict): cover TUI coordination conflict panel and no-runtime-import invariant

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E12: `tests/server/coordination-conflict-routes.test.ts`

**Files:**
- Create: `tests/server/coordination-conflict-routes.test.ts`

**Covers (plan §21 "Visibility"):**
- Inspector list/detail
- no GET side-effect

- [ ] **Step 1: Create the file.** Template: `tests/server.test.ts` (real `startServer` + `fetch` on port 0).
- [ ] **Step 2: Add tests.** Pre-seed `.alix/coordination/shared/<runId>/state.json` with one conflict, start the server, fetch the two routes, assert JSON shape.

  For "no GET side-effect," call `GET /api/coordination/<runId>/conflicts/<conflictId>` twice and assert the state file's `mtime` is unchanged (or that the file content byte-equals the seed).
- [ ] **Step 3: Run.**

```bash
npm run build && node --test dist/tests/server/coordination-conflict-routes.test.js
```

- [ ] **Step 4: Commit.**

```bash
git add tests/server/coordination-conflict-routes.test.ts
git commit -m "test(conflict): cover Inspector conflict routes (list, detail, no-side-effect)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task E13: `tests/integration/collaboration-conflicts.integration.test.ts`

**Files:**
- Create: `tests/integration/collaboration-conflicts.integration.test.ts`

**Covers (plan §21 "End-to-end"):**
- Worker A publishes structured claim
- Worker B publishes incompatible claim
- detector creates one conflict
- repeated detection updates, not duplicates
- downstream worker receives conflict summary
- run continues by default
- authorized resolver resolves conflict
- audit chain complete

- [ ] **Step 1: Create the file.** Template: `tests/integration/approval-lifecycle.integration.test.ts` (mkdtemp + real stores + serial).
- [ ] **Step 2: Add tests.** Drive a full flow:
  1. Create a `CoordinationStore` with one run containing two workers.
  2. Create a `CollaborationStore` for that run.
  3. Have worker A publish a finding with `claim: { subject: "db", predicate: "choice", value: "postgres" }`.
  4. Have worker B publish a finding with `claim: { subject: "db", predicate: "choice", value: "mysql" }`.
  5. Instantiate `ConflictDetector` (Task B1) and call `detectConflicts`.
  6. Assert exactly one conflict with `type: "competing_decision"`, `detectedBy: ["deterministic"]`.
  7. Call `detectConflicts` again, assert `updatedConflictIds.length === 1` and `createdConflictIds.length === 0`.
  8. Build a context with `CollaborationContextBuilder`; assert the conflict is in `snapshot.conflicts` and rendered as untrusted.
  9. Resolve with `{ kind: "operator", actorId: "test" }`, assert the conflict is now `resolved` with a `resolution`.
  10. Read `.alix/audit/audit.jsonl`, assert at least one `conflict.detected` and one `conflict.resolved` entry.
- [ ] **Step 3: Run.**

```bash
npm run build && npm run test:integration
```

- [ ] **Step 4: Commit.**

```bash
git add tests/integration/collaboration-conflicts.integration.test.ts
git commit -m "test(conflict): end-to-end coverage of detect → persist → inject → resolve with audit

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Phase F — Documentation

## Task F1: Update `README.md`

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the file.** Find the "Features" / "Commands" section.
- [ ] **Step 2: Add a conflict-detection section.** Include:
  - One-paragraph description of what M0.78f does (deterministic claim comparison + evidence ranking + worker reports + optional model assistance, non-blocking).
  - The 5 CLI subcommands with one-line descriptions.
  - The plan's safety boundaries (workers can report but not resolve; resolution requires explicit authority; conflicts are non-blocking by default).
  - A pointer to `docs/user-manual.md` for the detailed walkthrough.
- [ ] **Step 3: Commit.**

```bash
git add README.md
git commit -m "docs(conflict): document M0.78f conflict detection in README

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task F2: Update `docs/user-manual.md`

**Files:**
- Modify: `docs/user-manual.md`

- [ ] **Step 1: Read the file.** Find a relevant section (likely the chapter on coordination runs or shared context).
- [ ] **Step 2: Add a chapter.** Cover:
  - How findings are normalized and topics are computed.
  - How the detector decides which findings to compare and what to flag.
  - How to read the Inspector conflict routes.
  - How to read the TUI conflict panel.
  - Resolution flow: --actor, --reason, when to use resolve vs accept-divergence vs dismiss.
  - Audit chain: where to find the events, how to correlate.
  - The hard safety guarantees (no automatic truth resolution, no worker resolve, model is non-authoritative).
- [ ] **Step 3: Commit.**

```bash
git add docs/user-manual.md
git commit -m "docs(conflict): add user manual chapter for M0.78f detection and resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

# Verification

After all 27 tasks, run the full suite end-to-end:

```bash
npm run build
```

Expected: clean.

```bash
npm run test:node:ci
```

Expected: every test green. The 13 new test files plus the existing 200+ should all pass. Pay attention to the new test counts in the output to confirm all 13 ran.

```bash
npm run test:integration
```

Expected: the new `collaboration-conflicts.integration.test.ts` passes.

```bash
mcp__gitnexus__detect_changes
```

Expected: the changed-symbol list should now include `ConflictDetector` (Task B1), `normalizeStateV1_0` (A2), the new audit/metric union entries (D2/D4), the CLI flag handling (C1), and the test files. Risk level should be MEDIUM; no HIGH surprises.

```bash
git log --oneline m0.78e-relevance-budgeting-baseline..HEAD
```

Expected: 27 new commits following the suggested subjects from plan §25, plus this plan's additional subjects (A1, A3, C3, D3, F1, F2).

Finally, tag and create the PR per plan §25:

```bash
git tag -a m0.78f-conflict-detection-baseline -m "M0.78f Conflict Detection baseline"
gh pr create --title "feat(conflict): add M0.78f deterministic conflict detection" --body "..."
```

---

# Acceptance criteria checklist (from plan §22)

| Criterion | Task(s) |
|---|---|
| Shared tags alone never create a conflict. | B1 (ClaimComparator rejects compatible claims) |
| Candidate grouping and incompatibility classification are separate. | B1 |
| Only active current-attempt findings are compared. | B1 (isActive filter) |
| Claims have deterministic normalized topic identities. | E1 |
| Compatible claims are not persisted as conflicts. | B1 + E3 |
| Uncertain claims remain uncertain unless worker/model evidence supports conflict. | B1 |
| Conflict deduplication uses a stable fingerprint. | B1 (computeConflictFingerprint) + E6 |
| Conflict lifecycle mutations are explicit and lock-safe. | B4 + D1 + E6 |
| Workers can report but not resolve conflicts. | A1 + E7 |
| Resolution requires explicit authority. | A1 + E6 |
| Evidence comparison is conflict-specific and explainable. | E4 (reasons asserted) |
| No fake worker context is passed to RelevanceScorer. | (regression check — no task adds such a call) |
| Model assistance is optional, bounded, and non-authoritative. | B1 (useModelAssistance flag, timeout, try/catch) |
| Conflicts are non-blocking by default. | B1 (blocksDownstreamByPolicy: false) |
| Relevant conflicts are injected within hard budgets. | A3 + E9 |
| Conflict context is marked untrusted. | E9 |
| CLI, TUI, Inspector, and shared view agree. | C1-C3 + E10-E12 |
| No GET route mutates conflict state. | E12 |
| Events, audit, and metrics are emitted. | D1 + D2 + D3 + D4 |
| No placeholder tests remain. | E1-E13 |
| Full existing suite remains green. | Verification section |
