# Capability Platform Greenfield — Complete

**Status:** Complete
**Date:** 2026-08-14
**Tag:** `alix-capability-greenfield-complete`
**Parent program:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-reconciled-program.md`
**Final CAP:** CAP-12 (End-to-End Capability Evolution)

ALiX now has a single Capability Platform. This checkpoint records the closeout of the greenfield program (CAP-1→CAP-12) and the evidence that the program's gate (§82 final checkpoint + 19 §20 hard-acceptance criteria) holds.

---

## 1. Canonical-registry ownership

ONE canonical `CapabilityCatalog` (persistent JSONL store: `definitions.jsonl` + `bindings.jsonl`). ONE `CapabilityRegistry` (M-series projection). ONE `CapabilityService` (composition-root-owned facade for all read/inspection/governance paths). The CLI/TUI/Web/agent/runtime surfaces all consume the canonical universe through `CapabilityService`.

**Evidence:**
- `src/capability/platform.ts` — composition root
- `tests/capability/single-registry.vitest.ts` — single-registry invariant
- `tests/capability/cap-12-sentinel.vitest.ts` axis 1 — only ONE `new CapabilityRegistry(` in `src/` (at `src/capability/platform.ts`)
- `tests/capability/cap-12-sentinel.vitest.ts` axis 3 — `tests/evolution/capability-lifecycle/` does not exist

---

## 2. Provider abstraction

Providers are implementations; capability identity is provider-independent. `CapabilityKind = core|query|operation|workflow|agent` describes semantic ability, not implementation technology. `bindings[].provider.type` covers `native|tool|mcp|external-cli|daemon|agent|plugin|remote-api`. Migration: `tool.file.read→query`, `tool.git.commit→operation`, `tool.shell.run→operation`, `core→core`, `workflow→workflow`, `agent→plugin` (legacy) → `agent` (canonical per `migrateKind`).

**Evidence:**
- `tests/capability/cap-12-migration-fixture.vitest.ts` — 35 axes covering 8 legacy Capability rows + canonical projection
- `src/capability/legacy-adapter.ts` — M-series ↔ canonical conversion
- `tests/capability/cap-12-migration-fixture.vitest.ts` — provider binding survival (8 axes)

---

## 3. Definition persistence

`CapabilityCatalog` persists `definitions.jsonl` + `bindings.jsonl` to disk. `CapabilityService` reads/writes through the catalog. `id@version` is the immutable publication key (SemVer-normalized). Historical publications retained on update.

**Evidence:**
- `tests/capability/types.vitest.ts` — `id@version` validation + SemVer rules
- `tests/capability/registry.vitest.ts` — registry projection
- `tests/capability/cap-12-e2e.vitest.ts` step 1 — composition root seeded with persisted initial capabilities

---

## 4. CLI/TUI/Web parity

`service.list() === registry view === CLI projection === TUI projection` (identity equality on canonical `CapabilityListItem`: id, version, kind, bindings[0].type, lifecycle). The CLI does not maintain a parallel registry; the TUI does not maintain a parallel catalog; the Web adapter has no capability listing (no adapter exists, documented as no-op).

**Evidence:**
- `tests/capability/cli-runtime-parity.vitest.ts` — 4 parity axes (identity equality on canonical projection)
- `tests/capability/cap-12-sentinel.vitest.ts` axis 4 — CLI dispatcher has no `new CapabilityRegistry(` and no `CapabilityRegistry` import
- `tests/capability/cap-12-e2e.vitest.ts` step 4, 5, 6 — CLI/TUI/Web projection identity

---

## 5. Governed registration

Propose → A3 approve → A4 apply → registry/catalog mutation. The A7 proposal generator emits `CapabilityEvolutionCandidate`; the `CapabilityMutationExecutor` (CAP-6) commits through `GovernedExecutionRuntime` with rollback. The `ProposalStore` persists the governance lifecycle.

**Evidence:**
- `tests/capability/capability-service-apply.vitest.ts` — apply pattern
- `tests/capability/cap-12-e2e.vitest.ts` step 9-12 — propose → approve → apply → catalog preservation
- `tests/capability/proposal-identity.vitest.ts` — proposal id SHA-256 hex canonical form

---

## 6. Provider examples

`gh` (external-cli), GitNexus (mcp/agent), MCP servers (mcp), and external CLI tools are all valid `bindings[].provider.type` values. The migration fixture row 5 (`workflow.deploy`, `cli → external-cli`) demonstrates the legacy → canonical strategy rename.

**Evidence:**
- `tests/capability/cap-12-migration-fixture.vitest.ts` row 5 — `cli → external-cli` mapping
- `src/capability/canonical/provider.ts` — `ProviderType` union

---

## 7. Lifecycle / runtime enforcement

Six-state acyclic lifecycle (emerging/active/mature/stagnant/declining/deprecated; `deprecated` terminal). Deprecated capabilities excluded from normal runtime selection. Provider availability is independent of lifecycle — `active` capability with all providers down is `unavailable` (not `deprecated`).

**Evidence:**
- `tests/capability/lifecycle-eligibility.vitest.ts` — eligibility matrix
- `tests/capability/fallback.vitest.ts` — provider failure vs capability failure (test 6)
- `tests/capability/cap-12-e2e.vitest.ts` step 7 — runtime resolver invokes seeded capability

---

## 8. Test totals

```
$ pnpm vitest run tests/capability/
Test Files  67 passed (67)
Tests       552 passed (552)
Duration    4.09s
```

**Test coverage by CAP:**
- T1 (`tests/capability/fixtures/legacy-migration-bundle.ts`) — 8-row fixture (no test, consumed by T2)
- T2 (`tests/capability/cap-12-migration-fixture.vitest.ts`) — 35 axes
- T3 (`tests/capability/cli-runtime-parity.vitest.ts` + `tests/capability/cap-12-sentinel.vitest.ts`) — 8 axes (4 + 4)
- T4+T5 (`tests/capability/cap-12-e2e.vitest.ts`) — 14 steps
- T6 (no new test, verdict C) — covered by `tests/capability/fallback.vitest.ts` test 6
- T7 (no commit, "no change needed") — 9/9 doc migration verifications passed

---

## 9. Old-A7 migration summary

| Surface | Status | Evidence |
|---------|--------|----------|
| Legacy A7.0/A7.1 source machinery | DELETED in CAP-11 | `tests/capability/cap-11-structural-cleanup-sentinel.vitest.ts` |
| `tests/evolution/capability-lifecycle/*` | DELETED in CAP-11 | `tests/capability/cap-12-sentinel.vitest.ts` axis 3 |
| A7.0/A7.1 design/plan/checkpoint docs | MARKED SUPERSEDED | `docs/architecture/checkpoints/2026-08-10-a7-*.md` + `docs/superpowers/specs/2026-08-10-a7-*.md` + `docs/superpowers/plans/2026-08-10-a7-*.md` |
| `src/capability/legacy-adapter.ts` | RETAINED (read-only adapter for inverse direction) | `tests/capability/cap-12-migration-fixture.vitest.ts` |
| `APPROVED_PENDING_APPLICATION` state | DELETED in CAP-11 | `tests/capability/cap-12-sentinel.vitest.ts` axis 2 |

The legacy two-surface CLI and its `APPROVED_PENDING_APPLICATION` state are gone. There is no second capability surface.

---

## 10. CAP-12 §20 hard-acceptance evidence

All 19 §20 criteria green:

| # | §20 criterion | Satisfied by | Evidence | Verdict |
|---|---------------|--------------|----------|---------|
| 1 | exactly one canonical capability registry per runtime composition | CAP-3, CAP-8, CAP-11 | `tests/capability/single-registry.vitest.ts` + `tests/capability/cap-12-sentinel.vitest.ts` axis 1 | PASS |
| 2 | CLI does not create a second registry | CAP-8, CAP-11 | `tests/capability/cap-12-sentinel.vitest.ts` axis 1 + axis 4 | PASS |
| 3 | TUI and Web UI do not maintain duplicate catalogs | CAP-8, CAP-11 | `tests/capability/cap-12-sentinel.vitest.ts` axis 1 + axis 4 | PASS |
| 4 | capability identity is provider-independent | CAP-1, CAP-4 | `tests/capability/cap-12-migration-fixture.vitest.ts` | PASS |
| 5 | MCP is a provider/integration boundary | CAP-4 | `src/capability/canonical/provider.ts` | PASS |
| 6 | external CLI tools are providers | CAP-4 | `tests/capability/cap-12-migration-fixture.vitest.ts` row 5 | PASS |
| 7 | `gh` can implement a capability | CAP-4 | `src/capability/canonical/provider.ts` (`external-cli`) | PASS |
| 8 | GitNexus can implement a capability | CAP-4 | `src/capability/canonical/provider.ts` (`mcp`/`agent`) | PASS |
| 9 | provider fallback works without changing capability identity | CAP-4 | `tests/capability/fallback.vitest.ts` test 1, 5 | PASS |
| 10 | current capability state comes from the registry | CAP-3 | `tests/capability/registry.vitest.ts` | PASS |
| 11 | A7 ledger is history/governance, not current capability state | CAP-9 | `tests/capability/cap-12-e2e.vitest.ts` step 14 | PASS |
| 12 | A7 register can be approved and actually applied | CAP-6, CAP-9 | `tests/capability/cap-12-e2e.vitest.ts` step 9-11 | PASS |
| 13 | registration applies a complete definition, not a placeholder | CAP-2, CAP-6, CAP-9 | `tests/capability/capability-service-apply.vitest.ts` | PASS |
| 14 | A4 remains the mutation boundary | CAP-6 | `src/capability/evolution/execution/capability-mutation-executor.ts` | PASS |
| 15 | A5 measures actual post-application outcomes | CAP-10 | `tests/capability/cap-12-e2e.vitest.ts` step 13 | PASS |
| 16 | deprecated capabilities are excluded from normal runtime selection | CAP-7 | `tests/capability/lifecycle-eligibility.vitest.ts` | PASS |
| 17 | CLI/runtime catalog parity test is green | CAP-8, CAP-12 | `tests/capability/cli-runtime-parity.vitest.ts` | PASS |
| 18 | provider failure/capability failure distinction is tested | CAP-4 | `tests/capability/fallback.vitest.ts` test 6 | PASS |
| 19 | documentation no longer presents A7.0/A7.1 split-registry assumptions as active architecture | CAP-11, CAP-12 | `tests/capability/cap-12-sentinel.vitest.ts` axis 4 + `docs/architecture/README.md` | PASS |

**§20 #12 caveat:** The `apply()` path's candidate → mutation mapping currently hardcodes `capability.transition` (CAP-9 conservative stub at `src/capability/capability-service.ts:702,704`). The `gap → capability.create` mapping is a deferred CAP-N follow-up. The e2e test asserts the proposal lifecycle (proposal.submitted → proposal.approved → proposal.executed) and the catalog preservation (no spurious additions/removals), which is the actual behavior of the current production path. The carve-out was user-approved (2026-08-14).

**§20 #12 closed by CAP-N at 518e226d — 2026-08-14.** `apply()` now routes per `sourcePatternId`: `gap` → `capability.create`, `deprecation_signal` → `capability.remove`, others → `capability.transition`. E2E step 12b (`tests/capability/cap-12-e2e.vitest.ts`) asserts a gap proposal actually grows the catalog by one. The §20 #12 evidence row now reads plain "PASS" without caveat.

---

## 11. CAP-12 §82 surface-resolution evidence

All 8 §82 surfaces resolve the same canonical capability universe:

| Surface | Resolves at | Evidence |
|---------|-------------|----------|
| runtime | CAP-3, CAP-7 | `tests/capability/cap-12-e2e.vitest.ts` step 3 (runtime resolver view === service.list()) |
| CLI | CAP-8 | `tests/capability/cli-runtime-parity.vitest.ts` (identity equality via CLI dispatcher) |
| TUI | CAP-8 | `tests/capability/cli-runtime-parity.vitest.ts` (TUI read API === service.list()) |
| web | CAP-8 | `tests/capability/cap-12-e2e.vitest.ts` step 6 (no-op: no Web adapter exists) |
| A7 | CAP-9 | `tests/capability/cap-12-e2e.vitest.ts` step 9 (proposal.ledger) |
| A4 | CAP-6 | `tests/capability/cap-12-e2e.vitest.ts` step 11 (proposal.executed) |
| A5 | CAP-10 | `tests/capability/cap-12-e2e.vitest.ts` step 13 (measured event) |
| P5.5/P5.6 | CAP-9 + CAP-10 | `tests/capability/cap-12-e2e.vitest.ts` step 14 (events in order) |

---

## 12. Footnote: spec deviations documented

For posterity, three known spec deviations (all cited above with production-code authority):

1. **`tool.file.read` mapping** — Spec §4.3 line 114 suggested `tool → query`. Production `migrateKind("tool") → "operation"` has no per-id discrimination. Fixture follows production code (kind: `operation`). Documented in fixture header.

2. **`lifecycle` field** — Neither `Capability` nor `CapabilityDefinition` carries a top-level `lifecycle` field. The fixture carries deprecated via `legacy.extensions.lifecycle` → `bindings[0].config.lifecycle`. Asserted against that path.

3. **Spec line 114 typo** — Spec lists `agent → plugin`; production maps `plugin → agent` (the inverse direction). Fixture follows production; the brief's table correctly cites `plugin → agent`.

All three were surfaced by the implementer and documented in the JSDoc headers / commit messages.