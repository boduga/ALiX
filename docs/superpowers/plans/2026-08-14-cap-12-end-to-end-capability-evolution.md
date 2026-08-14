# CAP-12 — End-to-End Capability Evolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the greenfield program. CAP-12 verifies the behavioral proof that runtime, CLI, TUI, web, A7, A4, A5, P5.5/P5.6 all resolve the same canonical capability universe; assemblies the migration fixture; populates the §20 evidence table; produces the annotated tag `alix-capability-greenfield-complete`.

**Architecture:** No new architecture. Three new test files (`cap-12-e2e.vitest.ts`, `cli-runtime-parity.vitest.ts`, `cap-12-migration-fixture.vitest.ts`), one fixture file (`legacy-migration-bundle.ts`), one sentinel file (`cap-12-sentinel.vitest.ts`), one checkpoint doc, one tag. Composition-root consumption only.

**Tech Stack:** TypeScript · Vitest · existing `CapabilityService` + composition root + legacy-adapter · existing CLI handlers · existing TUI/Web read adapters.

---

## Global Constraints

These constraints are copied verbatim from the spec (CAP-12 design §2, §3, §11). Every task's requirements implicitly include this section.

**Invariants (spec §2):**
1. North star: exactly one canonical catalog, one runtime registry projection, one mutation boundary (A4), one service surface (`CapabilityService`).
2. §82 surfaces: runtime, CLI, TUI, web, A7, A4, A5, P5.5/P5.6 all resolve the same canonical universe.
3. §20 hard acceptance: 19/19 green.
4. Lossless migration: bounded fixture verifies expected capability IDs survive, semantic `kind` mappings correct, provider bindings survive, versions normalized to SemVer, no duplicate semantic identities, deprecated/removed entries retain history.
5. Surface parity: identity equality on `service.list()` projection.
6. No new architecture: no new modules, no new contracts, no new mutation paths, no new persistence.
7. Documentation migration closure: no A7.0/A7.1 split-surface assumption presented as active architecture.

**Locked decisions (spec §3):**
- CAP-12-D1: e2e + parity + migration fixture = the only new test code.
- CAP-12-D2: e2e path is the §10 path verbatim.
- CAP-12-D3: "same resulting state" = identity equality on `service.list()` projection.
- CAP-12-D4: migration fixture is bounded, hand-authored, no live data.
- CAP-12-D5: §82 checkpoint = single annotated tag + checkpoint doc.
- CAP-12-D6: §20 verification is per-criterion with evidence pointer.
- CAP-12-D7: CLI/runtime parity is mechanical identity equality on handler return value.
- CAP-12-D8: provider/capability failure distinction updates existing fallback test only.

**Out of scope (spec §11):** No new architecture; no new unit tests beyond CAP-12's three files + sentinel; no new CAP-12.x increments; no TUI/Web UI redesign; no provider rewrites; no A0/A2.5/A3/A5/P5.5/P5.6 contract changes; no fixture resurrection.

**Rejected options (preserved for posterity):**
- E2E byte-for-byte CLI stdout equality (D3 ruling — identity equality is the contract).
- Snapshot of real A7.0/A7.1 pre-CAP-1 definitions.jsonl (D4 ruling — fixture is bounded + hand-authored).
- §20 cross-reference to reconciled program §8 (D6 ruling — checkpoint doc carries per-criterion evidence).

**Forbidden files (no edits):**
- `src/capability/capability-service.ts` body — must not change for CAP-12.
- `src/capability/platform.ts` body — composition root must not change for CAP-12.
- `src/capability/legacy-adapter.ts` body — must not change for CAP-12.
- `src/capability/registry.ts` body — must not change for CAP-12.
- `src/capability/provider-resolver.ts` body — must not change for CAP-12.
- All CAP-1…CAP-11 sentinel tests — must not change for CAP-12.

If a task discovers a CAP-1…CAP-11 regression, the task files a `BLOCKED` report and the work pauses for design review.

**Required co-files (read-only references):**
- `tests/capability/five-axis-sentinel.vitest.ts` — sentinel pattern reference
- `tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts` — sentinel pattern reference
- `tests/capability/single-registry.vitest.ts` — single-registry invariant

**Branch:** `cap-12-end-to-end-capability-evolution` (worktree per `superpowers:using-git-worktrees`).

**Verification per task:** Each task ends with `pnpm test:node -- tests/capability/<task-test-file>` green, plus the covering suite for any touched module. The e2e task additionally runs the full capability vitest suite to confirm 0 regressions.

---

## Task 1: Bounded legacy migration fixture (data only)

**Files:**
- Create: `tests/capability/fixtures/legacy-migration-bundle.ts`
- Test: `tests/capability/cap-12-migration-fixture.vitest.ts` (assertions; T1 produces the data, T2 produces the assertions per project SDD convention)

**Interfaces:**
- Consumes: legacy `Capability` type from `src/capability/types.ts` (read-only)
- Produces: `LEGACY_MIGRATION_BUNDLE: readonly LegacyMigrationRow[]` — each row is `{ legacy: Capability; expectedCanonical: {...} }`

**Step 1: Create the fixture module**

Write `tests/capability/fixtures/legacy-migration-bundle.ts` exporting `LEGACY_MIGRATION_BUNDLE`. The bundle contains 8 rows covering:

| # | Legacy kind | Strategy | Version | Notes |
|---|-------------|----------|---------|-------|
| 1 | `tool` | `tool` | `1.0.0` | tool.file.read → query |
| 2 | `tool` | `tool` | `1.0.0` | tool.git.commit → operation |
| 3 | `tool` | `tool` | `1.0.0` | tool.shell.run → operation |
| 4 | `core` | `native` | `2.0.0` | core.session.list → core |
| 5 | `workflow` | `cli` | `3.0.0` | workflow.deploy → workflow (strategy maps to external-cli) |
| 6 | `plugin` | `agent` | `1.0.0` | plugin.orchestrate → agent |
| 7 | `tool` | `mcp` | `1.0` | unnormalized version (must normalize to SemVer) |
| 8 | `tool` | `tool` | `1.0.0` | deprecated entry (lifecycle: deprecated) |

Each row's `expectedCanonical` field asserts:
- `kind` (canonical)
- `bindings[].type` (canonical)
- `version` (normalized SemVer)
- `id` (preserved)
- expected registry projection fields

**Step 2: Verify the bundle compiles**

Run: `pnpm tsc --noEmit -p .`
Expected: PASS (no type errors in the fixture module).

**Step 3: Commit**

```bash
git add tests/capability/fixtures/legacy-migration-bundle.ts
git commit -m "test(capability): CAP-12 T1 bounded legacy migration fixture (8 rows)"
```

---

## Task 2: Migration fixture assertion test

**Files:**
- Create: `tests/capability/cap-12-migration-fixture.vitest.ts`
- Touches: `src/capability/legacy-adapter.ts` (read-only — interface imports only)

**Step 1: Write the test file**

The test asserts for each row in `LEGACY_MIGRATION_BUNDLE`:
1. `legacyAdapter.toCanonical(legacy)` produces a `CapabilityDefinition` whose `kind` matches `expectedCanonical.kind`
2. `version` is normalized to SemVer (matches `SemVer` regex)
3. `bindings[0].type` matches `expectedCanonical.bindings[0].type`
4. `id` is preserved
5. Deprecated entry (row 8) round-trips back through `canonicalToLegacyCapability` with `lifecycle: deprecated` intact

Add a final assertion: `Promise.all` of all rows produces 8 unique canonical IDs (no duplicate semantic identities).

**Step 2: Run the test**

Run: `pnpm test:node -- tests/capability/cap-12-migration-fixture.vitest.ts`
Expected: PASS, 8/8 assertion groups + 1 dedup assertion = 9 axes.

**Step 3: Commit**

```bash
git add tests/capability/cap-12-migration-fixture.vitest.ts
git commit -m "test(capability): CAP-12 T2 migration fixture assertions (8 rows + dedup)"
```

---

## Task 3: CLI/runtime catalog parity test + structural sentinel

**Files:**
- Create: `tests/capability/cli-runtime-parity.vitest.ts`
- Create: `tests/capability/cap-12-sentinel.vitest.ts`

**Step 1: Write the parity test**

The test:
1. Constructs a `CapabilityService` via the composition root with a known seed (5–10 capabilities).
2. Calls `service.list()` and captures the result.
3. Imports the CLI handler for `capabilities list` (the underlying function, not the shell command) and invokes it with the same composition root.
4. Asserts identity equality on the projected list (same `id@version`, same `kind`, same `bindings[].type`).

**Step 2: Write the structural sentinel**

The sentinel file contains 4 axes:
- **Axis 1:** No `new CapabilityRegistry()` outside `src/capability/platform.ts` (CAP-1 invariant regression guard).
- **Axis 2:** No `registerLifecycleApplier`/`applyLifecycleTransition`/`APPROVED_PENDING_APPLICATION` strings in source (CAP-11 regression guard).
- **Axis 3:** No `tests/evolution/capability-lifecycle/*` test files exist (CAP-11 deletion guard).
- **Axis 4:** `docs/architecture/README.md` does not present A7.0/A7.1 as active architecture (CAP-12-documentation-migration guard).

Use the same pattern as `tests/capability/five-axis-sentinel.vitest.ts`: a Vitest test that uses `fs.readFileSync` + `execSync('grep -r ...')` to assert the static properties.

**Step 3: Run the tests**

Run: `pnpm test:node -- tests/capability/cli-runtime-parity.vitest.ts tests/capability/cap-12-sentinel.vitest.ts`
Expected: PASS, parity test green + 4/4 sentinel axes.

**Step 4: Commit**

```bash
git add tests/capability/cli-runtime-parity.vitest.ts tests/capability/cap-12-sentinel.vitest.ts
git commit -m "test(capability): CAP-12 T3 CLI/runtime parity test + structural sentinel (4 axes)"
```

---

## Task 4: Critical e2e test — §10 path steps 1–7 (seed → registry → runtime → invoke)

**Files:**
- Create: `tests/capability/cap-12-e2e.vitest.ts`

**Step 1: Compose the test harness**

The test file:
1. Imports the composition root (`src/capability/platform.ts`) and constructs a `CapabilityService` with a tempdir-backed canonical catalog and an in-memory event log.
2. Provides 2 fake providers: one `native` (always-available), one `tool` (sometimes-fails — used in T5).
3. Imports the runtime resolver's `list()` and the CLI handler's `list()`.

**Step 2: Write the §10 path steps 1–7**

```
// Step 1: seed initial-capabilities → canonical catalog
//   (composition root already seeds; assert service.list() returns seed)
//
// Step 2: register provider binding for a test capability (via applyProposal)
//   - propose a NEW capability with id@version not in seed
//   - approve
//   - apply
//   - assert service.list() now contains the new capability
//
// Step 3: runtime list == service.list() (identity equality)
//   - assert deep-equal on normalized CapabilityListItem projection
//
// Step 4: CLI list handler == service.list() (identity equality)
//   - same as step 3 but via the CLI handler
//
// Step 5: TUI list adapter == service.list() (identity equality)
//   - TUI list adapter is a thin projection; assert identity equality
//
// Step 6: Web list adapter == service.list() (identity equality)
//   - same as step 5 but via the Web adapter
//
// Step 7: invoke a test capability via runtime resolver
//   - service.inspect(id@version) returns runtime availability
//   - execute via resolver → execution result
```

**Step 3: Run the e2e test**

Run: `pnpm test:node -- tests/capability/cap-12-e2e.vitest.ts`
Expected: PASS, 7/7 steps green.

**Step 4: Commit**

```bash
git add tests/capability/cap-12-e2e.vitest.ts
git commit -m "test(capability): CAP-12 T4 e2e path steps 1-7 (seed → runtime → invoke)"
```

---

## Task 5: Critical e2e test — §10 path steps 8–14 (health → propose → approval → apply → measure → history)

**Files:**
- Modify: `tests/capability/cap-12-e2e.vitest.ts` (append steps 8–14)

**Step 1: Append the §10 path steps 8–14 to the e2e test**

```
// Step 8: A7 health signal — read service.health() for the test capability
//   - assert health result has expected provider status
//
// Step 9: propose a register proposal for a NEW capability (different id@version)
//   - service.propose(candidate) → proposalId
//   - assert proposalStore contains a new proposal
//
// Step 10: A3 approve → proposalStore stores APPROVE decision
//   - service.approve(proposalId) → committed proposal
//   - assert proposalStore.get(id) returns APPROVE
//
// Step 11: A4 apply → mutationExecutor commits → registry changes
//   - service.apply({ proposalId }) → committed
//   - assert registry changes (new capability appears)
//
// Step 12: runtime behavior changes — runtime resolver now sees the new capability
//   - service.inspect(id@version) returns AVAILABLE for the new capability
//
// Step 13: service.measure() → A5 records `measured` event
//   - service.measure({ id@version, observation: ... }) → measured outcome
//   - assert EventLog has a capability.governance.measurement.measured event
//
// Step 14: history reads back measured event in the right order
//   - service.history(id@version) → [proposal, decision, apply, measured] in order
```

**Step 2: Run the e2e test**

Run: `pnpm test:node -- tests/capability/cap-12-e2e.vitest.ts`
Expected: PASS, 14/14 steps green.

**Step 3: Run the full capability vitest suite**

Run: `pnpm test:node -- tests/capability/`
Expected: PASS, 0 regressions (all CAP-1…CAP-11 tests still green).

**Step 4: Commit**

```bash
git add tests/capability/cap-12-e2e.vitest.ts
git commit -m "test(capability): CAP-12 T5 e2e path steps 8-14 (health → measure → history)"
```

---

## Task 6: Provider failure / capability failure distinction verification

**Files:**
- Modify: `tests/capability/fallback.vitest.ts` (if existing assertions don't cover the runtime-resolver distinction)

**Step 1: Verify existing fallback test coverage**

Read `tests/capability/fallback.vitest.ts` and confirm:
- It asserts that a transient provider error (5xx/timeout) triggers next provider.
- It asserts that a fatal error (400/auth) does NOT trigger next provider.
- It asserts that all-providers-exhausted → `CapabilityAvailability{available: false, reason: provider_unavailable}`.

**Step 2: If covered, add explicit assertion**

If the existing assertions cover the runtime-resolver distinction but not in CAP-12 terms, add a new test case in the same file that:
- Mocks a `provider_unavailable` vs `capability_not_in_bindings` distinction.
- Asserts the runtime resolver returns the correct `CapabilityAvailability` per the CAP-12 §82 surface.

**Step 3: If not covered, file a BLOCKED report**

If the existing test does not cover the runtime-resolver distinction, file a BLOCKED report and pause for design review. Do **not** extend the test in this task — surface the gap.

**Step 4: Run the test**

Run: `pnpm test:node -- tests/capability/fallback.vitest.ts`
Expected: PASS, all existing axes + new CAP-12 axis (if added).

**Step 5: Commit**

```bash
git add tests/capability/fallback.vitest.ts
git commit -m "test(capability): CAP-12 T6 explicit provider/capability failure distinction"
```

---

## Task 7: Documentation migration verification

**Files:**
- Read-only: `docs/architecture/README.md`, `docs/architecture/ALiX_MASTER_ROADMAP.md`, `docs/architecture/adrs/ADR-0013-capability-system-and-provider-architecture.md`, `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`, `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md`
- Touches (no edits): same files via grep/Read only

**Step 1: Verify README.md, ROADMAP.md, ADR-0013**

For each file:
- A7.0/A7.1 is referenced as historical/superseded, not active architecture.
- "Active architecture" is presented as ADR-0013 + greenfield architecture design.

**Step 2: Verify the A7.0/A7.1 checkpoint docs carry SUPERSEDED notices**

Read the header of each:
- `docs/architecture/checkpoints/2026-08-10-a7-capability-marketplace-checkpoint.md`
- `docs/architecture/checkpoints/2026-08-10-a7-1-capability-application-checkpoint.md`

Both should have a SUPERSEDED notice pointing to ADR-0013 + greenfield.

**Step 3: If any file is missing the SUPERSEDED notice**

Add a `> **SUPERSEDED by CAP-12 — 2026-08-14.**` blockquote at the top of the file pointing to the greenfield-complete tag. This is the only edit allowed in this task — strictly additive, no content removal.

**Step 4: If all files are clean, no commit**

If everything is already in order, the task produces no commit. The next task (§20 evidence table) cites these files as evidence.

**Step 5: Commit (if edits were made)**

```bash
git add [modified files]
git commit -m "docs(capability): CAP-12 T7 documentation migration closure"
```

---

## Task 8: Checkpoint doc + §20 evidence table + tag

**Files:**
- Create: `docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md`
- Tag: `alix-capability-greenfield-complete` (annotated)

**Step 1: Write the §20 evidence table**

The table has 19 rows, each with:
- # (1–19)
- §20 criterion (verbatim from reconciled program §8)
- satisfied by (CAP name)
- evidence pointer (one-line: test file + assertion name or sentinel axis)
- verdict (PASS)

**Step 2: Write the §82 surface-resolution table**

The table has 8 rows, each with:
- surface (runtime / CLI / TUI / web / A7 / A4 / A5 / P5.5/P5.6)
- resolves at (CAP name)
- evidence (test or sentinel)

**Step 3: Write the deliverable sections**

The 9 spec-required sections:
1. canonical-registry ownership
2. provider abstraction
3. definition persistence
4. CLI/TUI/Web parity
5. governed registration
6. provider examples (`gh`, GitNexus, MCP, external CLI)
7. lifecycle/runtime enforcement
8. test totals (count: `pnpm test:node -- tests/capability/` → number of files + number of tests)
9. old-A7 migration summary

**Step 4: Run all CAP-12 tests one final time**

Run: `pnpm test:node -- tests/capability/`
Expected: PASS, all files including the new ones.

**Step 5: Commit the checkpoint doc**

```bash
git add docs/architecture/checkpoints/2026-08-14-capability-platform-greenfield-complete.md
git commit -m "docs(capability): CAP-12 T8 checkpoint + §20 + §82 evidence tables"
```

**Step 6: Add the annotated tag**

```bash
git tag -a alix-capability-greenfield-complete -m "Capability Platform greenfield complete.

runtime, CLI, TUI, web, A7, A4, A5, P5.5/P5.6 all resolve the same canonical
capability universe. All 19 plan §20 hard-acceptance criteria green. The
Capability Platform is now one catalog, one registry, one mutation boundary,
one service surface."
```

**Step 7: Push the tag**

```bash
git push origin alix-capability-greenfield-complete
```

---

## Summary

| Task | Deliverable | Lines (est) |
|------|-------------|-------------|
| T1 | Bounded legacy migration fixture | ~120 |
| T2 | Migration fixture assertions | ~80 |
| T3 | CLI/runtime parity + sentinel | ~100 |
| T4 | E2e steps 1–7 | ~120 |
| T5 | E2e steps 8–14 | ~120 |
| T6 | Provider failure distinction | ~30 |
| T7 | Documentation migration verification | ~10 |
| T8 | Checkpoint + §20 + §82 + tag | ~250 |

Total: ~830 lines of new code/docs, 8 commits, 1 tag.

**Pre-existing failures to ignore:**
- `unit` linux Vitest hang (pre-existing main CI failure)
- `tui-smoke` CI failure (pre-existing main CI failure)
- `supply-chain` CI failure (pre-existing main CI failure)
- `pr_agent` CI failure (pre-existing main CI failure)
- 12 pre-existing node-test failures (already on main)
- 3 pre-existing TUI consumer tsc errors (`src/tui/capabilities/capability-service.ts` — out of scope per CAP-11)

**Final review:** Opus whole-branch review dispatched after T8 commits clean. The reviewer checks the 19 §20 criteria + 8 §82 surfaces against the checkpoint doc's evidence table.
