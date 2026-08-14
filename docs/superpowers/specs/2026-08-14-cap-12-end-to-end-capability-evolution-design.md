# CAP-12 — End-to-End Capability Evolution Design

**Status:** Proposed
**Date:** 2026-08-14
**Parent:** #484 — Spec: Greenfield Capability Platform — CAP-1…CAP-12 Program
**Issue:** #496
**Execution authority:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md` (CAP-12 section only)
**Architectural authorities:** ADR-0013 + greenfield architecture design `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md`
**Tag on completion:** `alix-capability-greenfield-complete`

Closes the greenfield program. CAP-12 is **terminal** and **additive** — no new architecture, no new contracts. It produces the **behavioral proof** that the eight surfaces the program promised now resolve one canonical capability universe, that the critical governed-path holds end-to-end, that the legacy migration is lossless, and that the documentation migration leaves no A7.0/A7.1 split-surface assumption standing as active architecture.

---

## 1. Document hierarchy

This spec sits below the reconciled program (CAP-12 section, §10 and §8/§9) and the architectural authorities (ADR-0013 + greenfield architecture design). It does not amend either. It defines the **what and where** of CAP-12's deliverables; the plan defines the **how**.

Conflicts are resolved upward: program > this spec > plan. Where this spec restates a locked acceptance criterion, the criterion is binding, not the paraphrase.

---

## 2. Core invariants

These hold across CAP-12 and are not relaxable by plan/implementation:

1. **North star.** Exactly one canonical capability catalog, exactly one runtime registry projection, exactly one mutation boundary (A4), exactly one service surface (`CapabilityService`). Providers are implementations; A7 is proposal intelligence; A5 is observation; CLI/TUI/Web are consumers. (Reconciled program §2; ADR-0013 §1.)
2. **§82 surfaces.** The checkpoint at design §82 is declared only when **eight** surfaces resolve the same canonical universe: runtime, CLI, TUI, web, A7, A4, A5, P5.5/P5.6. (Reconciled program §9; architecture design §82.)
3. **§20 hard acceptance.** All 19 plan §20 criteria green. CAP-12 owns **none** of the substantive implementation behind them — those landed in CAP-1…CAP-11 — but CAP-12 owns the **verification** that each still holds. (Reconciled program §8.)
4. **Lossless migration.** A pre-canned legacy-fixture bundle must survive migration to canonical, then to registry projection, then to runtime: every expected capability ID present, semantic `kind` mappings correct, provider bindings survive, versions normalized to SemVer, no duplicate semantic identities, deprecated/removed entries retain history. (Reconciled program §10 acceptance.)
5. **Surface parity.** `service.list() === registry.list() === runtime-resolver.list() === CLI.list()` (subject to identity-only projection of each surface). (Reconciled program §10 acceptance; architecture design §69, §45.)
6. **No new architecture.** CAP-12 introduces **no new modules, no new contracts, no new mutation paths, no new persistence**. Only: a critical e2e test, a parity test, a migration fixture, a checkpoint doc, the tag. (Reconciled program §10.)
7. **Documentation migration closure.** Wherever A7.0/A7.1 split-surface assumptions were presented as active architecture (READMEs, ADRs, roadmap, design doc references), the references now point to ADR-0013 + greenfield architecture design; A7/A7.1 design/plan/checkpoint docs carry the SUPERSEDED notice. **No A7.0/A7.1 doc is deleted** — they are historical record. (Reconciled program §10 + §19.)

---

## 3. Locked decisions index

CAP-12 inherits all rulings from CAP-1…CAP-11. It introduces no new rulings of its own. The CAP-12-locked decisions are the **gating set**:

| # | Decision | Source |
|---|----------|--------|
| CAP-12-D1 | The e2e test is the **only** new test code in CAP-12's implementation surface, plus a parity assertion and a migration fixture. No new unit tests beyond what those three files need. | §10 acceptance |
| CAP-12-D2 | The e2e test exercises the **§10 path verbatim**: `create/register → provider binding → runtime list → CLI list → TUI/Web list → invoke → A7 health signal → propose → A3 approve → A4 apply → registry changes → runtime behavior changes → A5 measure`. | §10 test/invariants |
| CAP-12-D3 | "Same resulting state through each surface" is asserted by **identity equality** on `service.list()` projection, not by byte-for-byte CLI/render output. CLI surfaces render by definition; identity equality is the surface-invariant contract. | Architecture design §45, §69 |
| CAP-12-D4 | The migration fixture is **bounded** — a hand-authored bundle of legacy `Capability` objects (no M-series runtime dependency) that round-trips through `legacy-adapter → canonical → registry projection → runtime`. No fixture depends on the live repo, no fixture reuses production seed data. | §10 acceptance |
| CAP-12-D5 | The §82 checkpoint is a **single annotated tag** (`alix-capability-greenfield-complete`) plus a **checkpoint doc** (`docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md`) with the eight items named in the reconciled program §10. The tag is annotated with the eight-surface resolution statement. | §10 checkpoint/tag |
| CAP-12-D6 | The §20 verification is **per-criterion** in the checkpoint doc's table, with a one-line evidence pointer to the test or sentinel that proves each. Verdicts are PASS, not "covered by another CAP". | §8, §10 |
| CAP-12-D7 | The CLI/runtime catalog parity test is **mechanical identity equality** after normalizing CLI output to the `CapabilityListItem` shape that `service.list()` returns. No parse/regex on CLI stdout — the test exercises the CLI handler's return value, not the rendered table. | §20 #17, §69 |
| CAP-12-D8 | Provider failure / capability failure distinction (plan §20 #18) is tested as a **fallback test** in the existing `tests/capability/fallback.vitest.ts` only if the existing assertions do not cover the **runtime-resolver** distinction. If covered, the test file is updated to assert the distinction explicitly; no new test file is added. | §20 #18 |

---

## 4. Architecture

CAP-12 has four deliverables, each independently testable, each mapping to one acceptance criterion:

```
CAP-12 deliverables
    │
    ├── D1: Critical e2e test           (tests/capability/cap-12-e2e.vitest.ts)
    │
    ├── D2: CLI/runtime catalog parity  (tests/capability/cli-runtime-parity.vitest.ts)
    │
    ├── D3: Migration fixture           (tests/capability/fixtures/legacy-migration-bundle.ts
    │                                   + tests/capability/cap-12-migration-fixture.vitest.ts)
    │
    └── D4: Checkpoint doc + tag        (docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md
                                        + tag alix-capability-greenfield-complete)
```

### 4.1 D1 — Critical e2e test

E2e test that walks the §10 path. The test is a **scenario script**, not a unit test: it composes a real `CapabilityService` via the composition root, exercises every step, and asserts the world-state at each step.

**Path (program §10):**
```
1. seed initial-capabilities → canonical catalog
2. register provider binding for a test capability (via Service)
3. runtime list == service.list() (identity equality)
4. CLI list handler == service.list() (identity equality)
5. TUI list adapter == service.list() (identity equality, via shared read-API)
6. Web list adapter == service.list() (identity equality, via shared read-API)
7. invoke a test capability via runtime resolver → execution result
8. A7 health signal — read service.health() for the capability
9. propose a register proposal for a NEW capability (different id@version)
10. A3 approve → proposalStore stores APPROVE decision
11. A4 apply → mutationExecutor commits → registry changes
12. runtime behavior changes — runtime resolver now sees the new capability
13. service.measure() → A5 records `measured` event
14. history reads back measured event in the right order
```

The test uses the **composition root** (`src/capability/platform.ts`) to construct the service, fakes only the providers and the event log, and asserts identity equality at each step. No mocks of `CapabilityService` itself.

### 4.2 D2 — CLI/runtime catalog parity test

A test that asserts CLI handler output and registry resolver output agree on the same capability universe. The test:
- boots the composition root with a known seed
- invokes `service.list()` (registry projection)
- invokes the CLI handler `capabilities list` (returns the same `CapabilityListResult` shape)
- asserts identity equality after normalizing both to the same list shape

This is a **sentinel** test — if it ever fails, the two-surface architecture has regressed. The existing `tests/capability/single-registry.vitest.ts` and `tests/capability/five-axis-sentinel.vitest.ts` enforce the same invariant at the static level; this test enforces it at runtime.

### 4.3 D3 — Migration fixture

A hand-authored fixture of legacy `Capability` objects (the **M-series** shape) that represents the implicit universe of A7.0/A7.1-era capabilities. The fixture:
- 6–10 legacy definitions covering: tool/mcp/cli strategies, missing-version cases, deprecated/removed entries, version variants (e.g. `1.0`, `1.0.0`, `1.0.0+build1`)
- exercises `legacy-adapter.toCanonical(cap)` for each
- projects each canonical definition into the registry
- asserts the resulting runtime universe matches the expected canonical universe:
  - expected capability IDs survive (no silent loss)
  - semantic `kind` mappings correct (`tool.file.read→query`, `tool.git.commit→operation`, `tool.shell.run→operation`, `core→core`, `workflow→workflow`, `agent→plugin`)
  - provider bindings survive (legacy `execution.strategy` → canonical `bindings[].type`)
  - versions normalized to SemVer
  - no duplicate semantic identities
  - deprecated/removed entries retain history (legacy history records preserved as canonical metadata)

The fixture is **bounded** — a single `tests/capability/fixtures/legacy-migration-bundle.ts` exporting an array of legacy `Capability` objects plus an expected canonical projection table. No live data, no async, no I/O.

### 4.4 D4 — Checkpoint doc + tag

A checkpoint doc at `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md` with the eight spec-required sections (per program §10):

1. canonical-registry ownership — current state authority
2. provider abstraction — kinds/strategies mapping
3. definition persistence — catalog + bindings storage
4. CLI/TUI/Web parity — service.list() == each surface's list
5. governed registration — propose → A3 → A4 → apply
6. provider examples — `gh`, GitNexus, MCP, external CLI
7. lifecycle/runtime enforcement — eligibility + deprecation
8. test totals — count of capability vitest files + tests passing
9. old-A7 migration — legacy-machine retirement summary

The tag `alix-capability-greenfield-complete` is annotated with the eight-surface resolution statement.

---

## 5. Data flow

The e2e test data flow follows the §10 path:

```
composition-root (platform.ts)
   ├── CapabilityCatalog (canonical, persistent)
   ├── CapabilityRegistry (projection)
   ├── CapabilityResolver (provider resolution)
   ├── CapabilityMutationExecutor (A4)
   ├── EventLog (governance + measurement events)
   ├── ProposalStore (proposal persistence)
   ├── ProposalSignalChannel (CAP-10.5)
   └── CapabilityService (composition of all above)
            │
            ├── list() ─────────► runtime.list() / CLI list() / TUI list adapter / Web list adapter
            │                     (all identity-equal)
            │
            ├── inspect(id@version) ─► runtime resolver view
            │
            ├── history(id@version) ─► EventLog projection
            │
            ├── propose(candidate) ─► ProposalStore.write()
            ├── listProposals() ─► A3 decision feed
            ├── approve(id) / reject(id) ─► A4 mutation trigger
            ├── apply(input) ─► A4 CapabilityMutationExecutor
            ├── measure(input) ─► A5 → measured event → ProposalSignalChannel
            └── health(id@version) ─► A7 health signal
```

The migration fixture data flow:

```
legacy fixture (M-series Capability[])
   │
   ▼
legacy-adapter.toCanonical(cap) [src/capability/legacy-adapter.ts]
   │  maps execution.strategy → bindings[].type
   │  maps legacy kind → canonical kind
   │  normalizes version to SemVer
   │  preserves extensions as binding.config
   ▼
CapabilityDefinition[] (canonical)
   │
   ▼
Catalog.write(def) [src/capability/canonical/catalog.ts]
   │
   ▼
Registry projection [src/capability/registry.ts]
   │
   ▼
Runtime resolver view [src/capability/provider-resolver.ts]
   │
   ▼
assertions (per fixture row, vs expected table)
```

---

## 6. Composition root

No new composition root. CAP-12 **consumes** the existing `src/capability/platform.ts` composition root. The e2e test bootstraps it with:
- a temp directory for the canonical catalog (via `mkdtemp`)
- a fake event log (in-memory)
- fake providers (one per provider type covered by the test)
- the existing `CapabilityService` shape

CAP-12 does **not** add a new constructor parameter, a new wiring line, or a new module to the composition root. If the e2e test reveals that the composition root is missing a wiring line for the e2e path, that is a **CAP-1…CAP-11 regression** — flagged for fix, not silently extended.

---

## 7. Migration boundary

CAP-12 is **terminal**. There is no migration *to* CAP-12. The migration CAP-12 owns is **documented**, not executed:

- **Source-of-truth migration:** Already executed in CAP-1…CAP-11. CAP-12 verifies with the bounded fixture.
- **Documentation migration:** Already largely executed in CAP-11 (A7/A7.1 docs carry SUPERSEDED notices). CAP-12 verifies the README, ADRs, and roadmap no longer present A7.0/A7.1 split-surface assumptions as active architecture.
- **Test-file migration:** Already executed in CAP-11 (legacy `tests/evolution/capability-lifecycle/*` removed). CAP-12 verifies no orphan tests reference the legacy machine.

What stays after CAP-12:
- A7/A7.1 design/plan/checkpoint docs (historical record, marked SUPERSEDED)
- Legacy-adapter (`src/capability/legacy-adapter.ts`) — the inverse direction is still needed for runtimes that haven't migrated to canonical reads
- The reconciliation roadmap P29/P30 if still referenced

What leaves after CAP-12:
- **Nothing.** CAP-12 does not delete code, tests, or docs; it adds evidence.

---

## 8. Error handling

CAP-12 introduces no new error paths. The e2e test relies on the existing `CapabilityService` error contract:
- `CapabilityNotFoundError` — test expects this on missing `id@version`
- `CapabilityProposalStaleError` — test expects this on stale epochs
- `CapabilityServiceNotImplementedError` — covered by existing tests, not by CAP-12

If the e2e test requires a new error class to make a clean assertion, that is a sign the design is missing a contract — flag, do not silently extend.

The migration fixture asserts **no** errors during the legacy → canonical → registry → runtime path. Any thrown error is a CAP-1…CAP-11 regression.

---

## 9. Testing strategy

Three new test files, one sentinel file, one commit check:

| File | Purpose | Touches |
|------|---------|---------|
| `tests/capability/cap-12-e2e.vitest.ts` | Critical e2e path (D1) | composition root, service, runtime, CLI handler import, TUI/Web adapters if exercised by the §10 path |
| `tests/capability/cli-runtime-parity.vitest.ts` | CLI/runtime catalog parity (D2) | `service.list()`, CLI handler return value |
| `tests/capability/fixtures/legacy-migration-bundle.ts` | Bounded legacy fixture (D3) | legacy `Capability` type (read-only) |
| `tests/capability/cap-12-migration-fixture.vitest.ts` | Migration fixture assertions (D3) | `legacy-adapter`, catalog, registry, runtime resolver |
| `tests/capability/cap-12-sentinel.vitest.ts` | §82 surface-read sentinel (D2 sentinel) | static checks: no second registry, no legacy CLI path, no orphan tests |

The sentinel file is the **structural** static check; the parity test is the **runtime** check. Both must pass.

The e2e test runs **once** per CAP-12. It is the gating test for the greenfield-complete tag.

---

## 10. Forward compatibility

CAP-12 is terminal. The risk being closed is the multi-surface split; the risk being opened is none — no new architecture, no new contracts.

If a future CAP (e.g. CAP-13) needs to extend the capability platform, it does so by extending the **CAP-12 surface invariants** (which becomes part of the §82 checklist). The e2e test is the regression net for any future change.

The migration fixture is forward-compatible: if a future capability kind is added, the fixture grows by one row. If a future provider type is added, the fixture grows by one row. The fixture does not become stale.

---

## 11. Out of scope

- **No new architecture.** No new modules, no new contracts, no new mutation paths, no new persistence.
- **No new tests beyond CAP-12's three files + sentinel.**  No new unit tests for §20 items already covered by CAP-1…CAP-11 sentinels.
- **No new CAP-12.5/12.6.** CAP-12 is single-increment; the program is one tag.
- **No TUI/Web UI redesign.** Surfaces consume `CapabilityService`; visual/UX rebuild is separate.
- **No provider rewrites.** Provider implementations (gh, GitNexus, MCP, external CLI) are covered by the existing tests; CAP-12 exercises them only via the fixture.
- **No A0/A2.5/A3/A5/P5.5/P5.6 contract changes.** Governance machinery is reused, not rebuilt.
- **No fixture resurrection.** Legacy A7.0/A7.1 source code is not reinstated for the migration fixture; the fixture is hand-authored from the type definitions.

---

## 12. References

- `#496` — CAP-12 issue
- `#484` — Greenfield program spec
- `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md` — CAP-12 section, §10 acceptance, §8/§9 hard-acceptance/checkpoint
- `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md` — §20 governance, §69 CLI/runtime, §70 migration, §82 checkpoint
- `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md` — greenfield architecture
- `docs/superpowers/specs/2026-08-10-a7-capability-marketplace-design.md` — A7.0 superseded design (historical)
- `docs/superpowers/specs/2026-08-10-a7-1-capability-application-design.md` — A7.1 superseded design (historical)
- `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md` — A7.0 superseded checkpoint
- `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md` — A7.1 superseded checkpoint
- `tests/capability/cap-10-5-emission-sentinel.vitest.ts` — prior CAP sentinel pattern
- `tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts` — prior CAP sentinel pattern
- `src/capability/legacy-adapter.ts` — M-series ↔ canonical adapter
- `src/capability/platform.ts` — composition root
- `src/capability/capability-service.ts` — service surface
