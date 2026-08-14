# CAP-11 — Remove Legacy Capability Surfaces Design

**Status:** Decision-complete (locked rulings #1-#10, 2026-08-14)
**Date:** 2026-08-14
**Branch:** `cap-11-remove-legacy-capability-surfaces`
**Base:** `origin/main` (CAP-10 merged, `09548ac5`)
**Ticket:** #495
**Locked rulings:** `memory/cap-11-rulings-locked.md`

> **CAP-11 is the architectural cleanup ticket for the greenfield capability platform. It retires the A7.0/A7.1 legacy lifecycle subsystem — including the lifecycle overlay rehydration machinery, the legacy CLI surface, the canonical `CapabilityPlatform` accessor debt, and the A7.1 test suite — and installs a structural sentinel that mechanically prevents reintroduction.**

---

## 1. Document hierarchy

```text
ADR-0013
   │
   │ architectural authority
   ▼
Greenfield Architecture Design (§70/§72/§82)
   │
   │ architectural specification
   ▼
CAP-8 Spec (service surface)
CAP-9 Spec (proposal intelligence)
CAP-10 Spec (measurement integration)
   │
   │ architectural precedent
   ▼
CAP-11 Spec (this document)
   │
   │ implementation authority
   ▼
CAP-11 Implementation Plan (TBD)
   │
   ▼
Task briefs
```

CAP-11 inherits all CAP-8/9/10 conventions: composition-root boundary, optional ctor deps with graceful degradation, sentinel pattern, event-type discriminated unions, governance purity.

---

## 2. Core invariants

1. **One public capability surface.** `CapabilityPlatform.service` is the sole capability boundary. `catalog` and `registry` are composition-root internals; no external code reaches them through `platform.*`.
2. **Pure deletion.** CAP-11 ships no new behavior. Every change is removal + sentinel enforcement.
3. **CAP-10.5 stays separate.** M1 evolution-signal emission seam is a separate CAP-10.5 PR; CAP-11 does not bundle.
4. **Canonical lifecycle state preserved.** The `lifecycleState` field on `CapabilityRegistry` + 4 accessor methods stay. Only the A7.1 rehydration machinery is removed.
5. **No backward compatibility shims.** The plural `alix capabilities` command is removed entirely. No alias. No deprecation warning.
6. **Historical records preserved.** A7.0/A7.1 checkpoints get `SUPERSEDED` banners, not deletion. Historical CAP plans stay intact.

---

## 3. Locked decisions index

10 rulings locked via grilling on 2026-08-14. Full text in `memory/cap-11-rulings-locked.md`.

| # | Ruling | Gist |
|---|--------|------|
| 1 | CAP-10.5 stays separate | M1 signal emission is independent ticket; CAP-11 is pure deletion |
| 2 | CLI namespace | Create `src/cli/commands/capability.ts` (singular) as sole namespace dispatcher |
| 3 | Sentinel scope | New `cap-11-structural-cleanup-sentinel.vitest.ts` separate from `five-axis`; delete `four-axis-sentinel.vitest.ts` (M5 closure) |
| 4 | Overlay mechanics | Remove rehydration machinery only; keep canonical `lifecycleState` on `CapabilityRegistry` |
| 5 | Test removal | Wholesale deletion of 15 A7.1 tests + rollback test; update mutation-executor-integration in place |
| 6 | CLI registration | Singular `capability` only; no plural alias |
| 7 | Documentation cleanup | Banner A7 checkpoints; update current-state architecture docs; preserve historical plans |
| 8 | Platform surface | `service` is sole public field; `catalog`/`registry` are private |
| 9 | CAP-9 supersession | Update stale assertion to acknowledge CAP-11 retirement; retain CAP-10 guards as reintroduction protection |
| 10 | Test refactor | 5 platform-internals tests use injected fixtures + `platform.service` |

---

## 4. Architecture

### 4.1 Deletion shape (what goes away)

```text
BEFORE (post-CAP-10)
─────────────────────
src/evolution/capability-lifecycle/
├── capability-execution-projection.ts
├── capability-governance-bridge.ts
├── capability-lifecycle-analyzer.ts
├── capability-lifecycle-applier.ts
├── capability-lifecycle-cli.ts            ← hosts CAP-10 measure handler
├── capability-lifecycle-ledger.ts
├── capability-lifecycle-measurer.ts       ← CAP-11 deletion debt
├── capability-lifecycle-rehydration.ts    ← A7.1 overlay
├── capability-lifecycle-step-executor.ts
├── capability-proposal-builder.ts
├── contracts/
├── errors.ts
└── index.ts

src/capability/evolution/a7-proposals.ts   ← CAP-9 A7ProposalGenerator (KEEP)

src/cli/commands/capabilities.ts           ← CAP-8 re-export shim (DELETE)
src/cli.ts                                 ← has lifecycle overlay wiring (CLEAN)

tests/evolution/capability-lifecycle/      ← 15 files (DELETE)
tests/evolution/execution/
  capability-mutation-rollback.test.ts     ← (DELETE)
  integration/capability-mutation-executor-integration.test.ts
                                          ← (UPDATE in place: drop literal)
tests/capability/four-axis-sentinel.vitest.ts   ← (DELETE; CAP-10 M5 closure)


AFTER (post-CAP-11)
────────────────────
src/capability/evolution/a7-proposals.ts   ← unchanged (CAP-9 active)
src/cli/commands/capability.ts             ← NEW: sole namespace dispatcher
src/cli/commands/capability-proposals.ts   ← unchanged (CAP-9)
src/cli/commands/capability-measure.ts     ← unchanged (CAP-10)
src/cli/commands/capabilities.ts           ← DELETED

src/capability/platform.ts                 ← catalog/registry private; service public
src/cli.ts                                 ← singular `capability` block; no ledger

tests/capability/
├── five-axis-sentinel.vitest.ts           ← unchanged (CAP-10)
├── cap-11-structural-cleanup-sentinel.vitest.ts  ← NEW
└── cap-11-supersession.test.ts            ← NEW
tests/evolution/execution/
  capability-mutation-rollback.test.ts     ← DELETED
  integration/capability-mutation-executor-integration.test.ts ← UPDATED

# (15 lifecycle tests + 4-axis sentinel removed)
```

### 4.2 CapabilityPlatform surface (new)

```typescript
class CapabilityPlatform {
  // PRIVATE — composition-root internals only
  // (was public: readonly catalog, readonly registry)

  // PUBLIC — sole capability service boundary
  readonly service: CapabilityService;
}
```

The composition root still constructs and wires:

```text
catalog ──┐
          ├──► CapabilityMutationExecutor (CAP-4)
registry ─┤
          ├──► ProviderResolver (CAP-4)
          ├──► CapabilityService (CAP-8/9/10)
          └──► internal references
```

External consumers reach capabilities exclusively via `platform.service.*`. Tests that need registry/catalog construct their own fixtures via ctor opts and assert via the service surface.

### 4.3 CLI namespace shape

```typescript
// src/cli/commands/capability.ts (NEW)
export interface CapabilityCommandDeps {
  readonly service: CapabilityService;
  readonly cwd: string;
}

export async function handleCapabilityCommand(
  args: readonly string[],
  deps: CapabilityCommandDeps,
): Promise<number | void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case "proposals":
      return capabilityProposalsCommand(rest, { service: deps.service });
    case "measure":
      return capabilityMeasureCommand(rest, { service: deps.service });
    default:
      console.error(`Unknown capability subcommand: ${subcommand}`);
      return 2;
  }
}
```

Thin dispatcher: parses subcommand, delegates to existing CAP-9/10 handlers. No measurement/proposal/lifecycle/governance logic in the dispatcher.

### 4.4 cli.ts registration block

```typescript
if (command === "capability") {
  const { handleCapabilityCommand } = await import("./cli/commands/capability.js");
  const { CapabilityPlatform } = await import("./capability/platform.js");
  const { EventLog } = await import("./events/event-log.js");
  const cwd = process.cwd();
  const sessionDir = join(cwd, ".alix", "sessions", "capability-cmd");
  const eventLog = new EventLog(sessionDir);
  const platform = new CapabilityPlatform({
    catalogDir: join(cwd, ".alix", "capabilities"),
    eventLog,
  });
  const exitCode = await handleCapabilityCommand(args, { cwd, service: platform.service });
  if (typeof exitCode === "number") process.exit(exitCode);
}
```

No `JsonlCapabilityLifecycleLedger` import. No `rehydrateLifecycleOverlay` call. No `CapabilityEvolutionStore` for legacy lifecycle. The CAP-11-debt `registry` accessor comment in the deleted block is resolved.

### 4.5 Sentinel axes (new)

`cap-11-structural-cleanup-sentinel.vitest.ts` asserts deletion-purity:

| Axis | Asserts |
|------|---------|
| 1 | `APPROVED_PENDING_APPLICATION` literal not present in any source file |
| 2 | No `lifecycle-overlay` machinery; `rehydrateLifecycleOverlay` not called |
| 3 | No file under `src/evolution/capability-lifecycle/` exists |
| 4 | No second CLI registry construction; only `CapabilityPlatform` constructs `CapabilityRegistry` |
| 5 | Exactly one catalog/registry/service composition root |

`cap-11-supersession.test.ts` (node:test) provides direct file-existence guards:

```typescript
// Files that MUST NOT exist after CAP-11:
const DELETED_FILES = [
  "src/evolution/capability-lifecycle/capability-lifecycle-applier.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-cli.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts",
  "src/evolution/capability-lifecycle/capability-lifecycle-rehydration.ts",
  // ... 13 files total
  "src/cli/commands/capabilities.ts",  // CAP-8 shim
  "tests/capability/four-axis-sentinel.vitest.ts",
];

for (const f of DELETED_FILES) {
  expect(fs.existsSync(resolveProjectRoot() + "/" + f), `${f} must be deleted`).toBe(false);
}
```

---

## 5. Data flow — what gets removed

### 5.1 A7.1 lifecycle overlay (deleted)

```text
BEFORE:
A7.1 ledger ──► rehydrateLifecycleOverlay(platform.registry, ledger)
                                       │
                                       ▼
                            registry.applyLifecycleTransition()
                                       │
                                       ▼
                            registry.lifecycleState[id] = state

AFTER:
(No path — A7.1 ledger and rehydration no longer exist)
```

### 5.2 Legacy CLI surface (deleted)

```text
BEFORE:
alix capabilities proposals/measure/apply/...
       │
       ▼
handleCapabilitiesCommand() (re-exported from capability-lifecycle-cli.ts)
       │
       ▼
legacy A7 lifecycle command dispatchers

AFTER:
alix capability proposals         → capability-proposals.ts (CAP-9)
alix capability measure <id@ver>  → capability-measure.ts (CAP-10)
alix capabilities (plural)        → unknown command error
```

### 5.3 CAP-10 measure handler (moved)

The `case "measure"` handler that CAP-10 added to `capability-lifecycle-cli.ts` (with form-based dispatch) gets discarded with the file. CAP-11 establishes the new `alix capability measure` path through `capability.ts` → `capability-measure.ts` directly. The legacy `runMeasure` (with `@`-absent form) goes away — that form belonged to the deleted A7.1 lifecycle.

---

## 6. Composition root (new shape)

```text
EventLog
   │
   ▼
CapabilityPlatform
   │
   ├── constructs CapabilityCatalog
   ├── constructs CapabilityRegistry(catalog)
   ├── constructs CapabilityMutationExecutor
   ├── constructs ProviderResolver
   ├── constructs CapabilityService (CAP-8/9/10 surface)
   │
   └── exposes: { service }     ← sole public field
```

The platform accepts optional ctor deps for testing:

```typescript
new CapabilityPlatform({
  catalogDir?: string,
  catalog?: CapabilityCatalog,      // test injection
  eventLog: EventLog,
  proposalGenerator?: A7ProposalGenerator,
  a5CapabilityMeasurement?: A5CapabilityMeasurement,
});
```

External code never reaches `platform.registry` / `platform.catalog` — those are construction-time only.

---

## 7. Migration boundary

### 7.1 CAP-11 owns

- Deletion of `src/evolution/capability-lifecycle/*` (13 files)
- Deletion of `src/cli/commands/capabilities.ts` (CAP-8 shim)
- Creation of `src/cli/commands/capability.ts` (singular namespace dispatcher)
- Refactor of `src/capability/platform.ts` to make `catalog`/`registry` private
- Refactor of `src/cli.ts` to register only `command === "capability"` (singular)
- Deletion of `tests/evolution/capability-lifecycle/*` (15 files)
- Deletion of `tests/evolution/execution/capability-mutation-rollback.test.ts`
- Update of `tests/evolution/execution/integration/capability-mutation-executor-integration.test.ts` (drop `APPROVED_PENDING_APPLICATION` literal)
- Refactor of 5 platform-internals tests to use injected fixtures + `platform.service` (ruling #10)
- Update of `tests/capability/cap-9-supersession.test.ts` (acknowledge CAP-11 retirement)
- Deletion of `tests/capability/four-axis-sentinel.vitest.ts` (CAP-10 M5 closure)
- Addition of `tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts`
- Addition of `tests/capability/cap-11-supersession.test.ts`
- Doc banners on A7.0/A7.1 checkpoint docs
- Current-state updates to greenfield architecture design §10/§11 and reconciled program spec

### 7.2 CAP-11 forbids

- `src/capability/evolution/a7-proposals.ts` (CAP-9 active; do not delete)
- `src/capability/initial-capabilities.ts` (CAP-8 forbidden, preserved)
- `src/tools/tool-registry.ts` (CAP-8 forbidden)
- `src/policy/capability-registry.ts` (CAP-8 forbidden)
- `src/capability/canonical/*` (CAP-8 forbidden)
- `src/tui/capabilities/capability-service.ts` (CAP-7/9 forbidden TUI façade — pre-CAP-11 debt, NOT CAP-11's deletion)
- All CAP-8/9/10 production code (composition-root boundary, optional ctor deps, governance purity, sentinel axes preserved)
- Any behavior addition (CAP-11 ships no new behavior; pure deletion only)

### 7.3 CAP-12 owns

- End-to-end capability evolution loop closure (A7 → A4 → A5 → A7)
- CAP-10.5 M1 follow-up (signal emission seam) is sequenced before CAP-12 but is a separate ticket

---

## 8. Error handling

CAP-11 is deletion; minimal new error surface. The CLI namespace dispatcher returns `2` (standard CLI usage error) for unknown subcommands. No new error classes; existing `CapabilityServiceNotImplementedError` (CAP-8) remains the surface for unimplemented service operations.

---

## 9. Testing strategy

### 9.1 Deletion verification (node:test)

| Suite | Coverage |
|-------|----------|
| `cap-11-supersession.test.ts` | File-existence guard for all 13 + 2 deleted source files + 16 deleted test files |

### 9.2 Structural sentinel (vitest)

| Suite | Coverage |
|-------|----------|
| `cap-11-structural-cleanup-sentinel.vitest.ts` | 5 deletion-purity axes (R3, R4, R5, R7 enforcement) |

### 9.3 Test refactor

5 platform-internals tests refactored to:
- **Composition/wiring correctness**: test-owned registry/catalog fixtures via ctor opts
- **Public behavior**: assert via `platform.service.*`

### 9.4 CAP-9 supersession update

The "CAP-9 left `capability-lifecycle/*` untouched" assertion is rewritten to "CAP-9 originally protected that surface; CAP-11 subsequently retired it (see `cap-11-supersession.test.ts`)." The test becomes an audit pointer.

### 9.5 Pre-existing invariants preserved

- `five-axis-sentinel.vitest.ts` (CAP-10) — unchanged, continues to guard against regression of forbidden imports
- `cap-10-supersession.test.ts` (CAP-10) — unchanged, becomes trivially-true reintroduction guard
- `cap-9-supersession.test.ts` — updated per R9

### 9.6 Test invariants

- `pnpm exec vitest run tests/capability/` → all green
- `node scripts/run-node-tests.mjs` → all green
- `pnpm exec tsc --noEmit` → 0 errors

---

## 10. Forward compatibility

### 10.1 CAP-10.5 (Evolution Signal Emission)

M1 follow-up adds `emit(signal)` to `ProposalSignalSource` and wires A5 default decider. Independent ticket; sequenced before CAP-12 per user direction.

### 10.2 CAP-12 (End-to-End Capability Evolution)

Closes the A7 → A4 → A5 → A7 loop. Depends on CAP-10 (measurement seam) + CAP-10.5 (signal emission) + CAP-11 (legacy removal). CAP-11 enables CAP-12 by removing the legacy overlay that complicated A5/P5.5 wiring.

### 10.3 Future `capability` subcommands

The new `capability.ts` dispatcher accepts only existing subcommands (`proposals`, `measure`). Future subcommands add new `case` arms without restructuring. The dispatcher stays thin.

### 10.4 Test that never regresses

The `cap-11-supersession.test.ts` file is the permanent deletion-purity guard. If anyone reintroduces `capability-lifecycle/*` or `capability-lifecycle-measurer.ts`, the test fails.

---

## 11. Out of scope

- Behavior additions (CAP-11 ships no new behavior)
- CAP-10.5 M1 signal emission work
- CAP-12 e2e loop wiring
- Deletion of `src/tui/capabilities/capability-service.ts` (CAP-7/9 debt, not CAP-11)
- Capability-platform feature additions (focus on deletion)
- Migration tooling for any external A7.1 consumers (none exist in this repo)

---

## 12. References

- ADR-0013 — Capability System and Provider Architecture
- Greenfield Architecture Design — `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
- Greenfield Reconciled Program — `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md`
- CAP-8 Spec — locked rulings in `memory/cap-8-rulings-locked.md`
- CAP-9 Spec — locked rulings in `memory/cap-9-rulings-locked.md`
- CAP-10 Spec — locked rulings in `memory/cap-10-rulings-locked.md`
- CAP-11 Rulings — `memory/cap-11-rulings-locked.md` (10 locked)
- A7.0 Capability Marketplace — `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`
- A7.1 Capability Application — `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md`
- A4 Capability Mutation Executor — `src/evolution/execution/capability-mutation-executor.ts`
- A7 Proposal Generator (CAP-9, preserved) — `src/capability/evolution/a7-proposals.ts`
