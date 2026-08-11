# Wayfinder T8 — Legacy Capability Surface Removal Inventory

**Ticket:** [#482 — "Task: Inventory legacy capability surfaces to remove"](https://github.com/boduga/ALiX/issues/482)
**Date:** 2026-08-10
**Repo:** `/home/babasola/Projects/Monolith` (branch `research/wf-t8-legacy-inventory`)
**Type:** Facts-only audit. No decisions, no code changes. Feeds CAP-11/12 reconciliation.
**Feeds:** `docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md` (the locked greenfield design) — specifically its §13 Bootstrap Sources, §14 Capability Registry, §37 Governance Ledger, §39 Rehydration, §43-52 CLI Architecture, §70 Migration Stages, and §26 A7 Responsibility.

The greenfield replaces the A7/M-series capability stack with ONE canonical `CapabilityCatalog` (persisted definitions + bindings) → `CapabilityRegistry` (runtime projection) → `CapabilityService` (CLI/TUI/Web), five A4 mutations (create/update/transition/consolidate/remove), semantic `CapabilityKind` (core|query|operation|workflow|agent) + `bindings[].provider.type`, `id@version` versioning, six-state lifecycle, and availability. Everything below is a surface that surface is removing, refactoring, or reconciling.

Disposition labels (facts + suggested label, not a decision):
- **REMOVE** — legacy surface with no greenfield counterpart.
- **REFACTOR-INTO-GREENFIELD** — logic/contract retained but rebuilt against the new catalog/registry/service architecture.
- **RECONCILE** — legitimately shared/proven contract or read model; needs alignment (renames, vocabulary, or wiring), not deletion.
- **PRESERVE** — proven cross-cutting contract the greenfield explicitly reuses (A0/A2.5/A3/A4/A5/P5.5/P5.6, ledger-history role).

---

## Summary (per area)

| # | Area | REMOVE | REFACTOR-INTO-GREENFIELD | RECONCILE | PRESERVE | Total entries |
|---|------|--------|--------------------------|-----------|----------|---------------|
| 1 | A7 capability CLI surface | 4 | 0 | 0 | 0 | 4 |
| 2 | A7 lifecycle machinery | 8 | 4 | 1 | 0 | 13 |
| 3 | Capability definition sources (duplicate registration) | 0 | 5 | 6 | 0 | 11 |
| 4 | Old `kind` / `execution.strategy` representations | 0 | 5 | 3 | 0 | 8 |
| 5 | Split-surface / second-registry assumptions | 4 | 3 | 8 | 1 | 16 |
| 6 | Cross-cutting legacy | 0 | 2 | 6 | 4 | 12 |
| — | Preserved contracts (cross-cutting) | 0 | 0 | 0 | 10 | 10 |

**Top removal targets:** (1) `src/cli.ts:2211-2229` capabilities command block (constructs a second `CapabilityRegistry`), (2) the A7 lifecycle applier `capability-lifecycle-applier.ts` (Stage 9 "A7-specific lifecycle applier"), (3) the ledger-rehydration `capability-lifecycle-rehydration.ts` (Stage 9 "A7 direct mutation"; greenfield rehydrates from the catalog store, spec §39), (4) the lifecycle overlay in `src/capability/registry.ts:100-122` (Stage 5), (5) `APPROVED_PENDING_APPLICATION` projection state (spec §17 explicitly forbids it).

---

## 1. The A7 capability CLI surface

| # | File:line | What it is | Disposition |
|---|-----------|-----------|-------------|
| 1.1 | `src/evolution/capability-lifecycle/capability-lifecycle-cli.ts:28-305` | `handleCapabilitiesCommand` — the `alix capabilities` subcommand dispatcher. Eight subcommands: `list` (:52-54, `renderList` :93-117), `inspect` (:55-56, `renderInspect` :119-152), `history` (:57-58, `renderHistory` :155-172), `health` (:59-60, `renderHealth` :174-190), `recommend` (:61-62, `runRecommend` :192-215), `propose` (:63-64, `runPropose` :216-256), `apply` (:65-66, `runApply` :270-302), `measure` (:67-68, `runMeasure` :304-305). `CapabilitiesCLIDeps` (:19-26) carries `ledger`/`registry`/`store`. Fatal-exit `failFatal` (:258-268, A7.0 86e323f2). | **REMOVE** — the greenfield CLI (§43-52) rebuilds `capabilities list/inspect/recommend/propose/apply/measure` behind `CapabilityService` over the catalog; this command reads the ledger + overlay directly. |
| 1.2 | `src/cli/commands/capabilities.ts:4` | Thin barrel re-exporting `handleCapabilitiesCommand` from the lifecycle module. | **REMOVE** — deleted with 1.1. |
| 1.3 | `src/cli.ts:2211-2229` | `if (command === "capabilities")` block. Constructs a **second** `CapabilityRegistry` (`new CapabilityRegistry()` :2221), a `JsonlCapabilityLifecycleLedger(DEFAULT_CAPABILITY_LIFECYCLE_FILE)` (:2222), a `CapabilityEvolutionStore` (:2223), calls `rehydrateLifecycleOverlay` (:2226), then dispatches (:2227). This is spec §3's "CapabilityRegistry instance B" and Stage 4's `new CapabilityRegistry()` to remove. | **REMOVE** — Stage 4: inject the same application-level `CapabilityService`; never construct a registry in the CLI. |
| 1.4 | `tests/evolution/capability-lifecycle/capability-cli.test.ts`, `tests/alix-capabilities.test.ts` | Tests pinning the legacy CLI surface (the `alix capabilities` command + its 8 subcommands; the alix-capabilities test is `skip`-tagged feature-gap documentation). | **REMOVE** with the CLI; replaced by greenfield CLI tests. |

---

## 2. The A7 lifecycle machinery

Module: `src/evolution/capability-lifecycle/` (whole module is A7-specific and superseded by the greenfield as *implementation architecture*, spec §6 header; Stage 9 "Retire old surfaces").

| # | File:line | What it is | Disposition |
|---|-----------|-----------|-------------|
| 2.1 | `src/evolution/capability-lifecycle/capability-lifecycle-applier.ts:27-125` | `CapabilityLifecycleApplier` — the **A7 lifecycle applier**. Rehydrates the latest `decided` ledger record (:36-37), checks `registry.find` (:50), `authorizeExecution` (:73), snapshots pre-state (:79-83), builds a plan via `createExecutionPlan` (:91), drives `GovernedExecutionRuntime` (:94-95), appends `applied` record (:116), compensating rollback (:119). | **REMOVE** — Stage 9 "A7-specific lifecycle applier". Greenfield applies governed mutations exclusively through the A4 `CapabilityMutationExecutor` (spec §32-33); A7 never mutates (§26). |
| 2.2 | `src/evolution/capability-lifecycle/capability-lifecycle-rehydration.ts:23-36` | `rehydrateLifecycleOverlay` — **A7 ledger-based rehydration**: replays `applied` records onto the registry overlay after restart. | **REMOVE** — Stage 9 "A7 direct mutation". Greenfield rehydration (§39) reads the catalog store + lifecycle state store; it MUST NOT reconstruct the universe from A7 history (§39: "The system MUST NOT reconstruct the capability universe solely from A7 history"). |
| 2.3 | `src/evolution/capability-lifecycle/capability-lifecycle-step-executor.ts:15-69` | `CapabilityLifecycleStepExecutor` (A4-binding `StepExecutor`) — drives the `capability.transition` operation, pre-state capture + compensating `rollbackApplied()` (:64-68). | **REMOVE** — replaced by the A4 `CapabilityMutationExecutor` step executor over catalog/registry/lifecycle-state stores (spec §32). |
| 2.4 | `src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts:38-86` | `JsonlCapabilityLifecycleLedger` — append-only JSONL ledger (`.alix/capability-lifecycle/lifecycle.jsonl`, `DEFAULT_CAPABILITY_LIFECYCLE_FILE` :14-16). | **REFACTOR-INTO-GREENFIELD** — the ledger's *historical traceability role is preserved* (spec §37: "A7 retains an append-only lifecycle ledger... responsibility is historical governance traceability"), but it must NOT be the canonical catalog (§37: "The ledger MUST NOT become the canonical capability catalog"). New event shape `CapabilityGovernanceEvent` (spec §37) replaces `CapabilityLifecycleRecord`. |
| 2.5 | `src/evolution/capability-lifecycle/capability-governance-bridge.ts:90-135` | `runCapabilityGovernance` (A7→A3 bridge: builds `VerificationEvidence` + A2.5 `GovernanceRecommendation`, calls A3 `generateDecision`) + `toLedgerRecord`. | **REFACTOR-INTO-GREENFIELD** — the A2.5→A3 decision pipeline is preserved (spec §37 Artifact Ownership); the bridge re-targets from `CapabilityLifecycleCandidate` to `CapabilityEvolutionCandidate` + `CapabilityMutation` (spec §27) and `capability.create` proposals (§29). |
| 2.6 | `src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts:20-122` | `analyzeCapabilityLifecycle` — consumes P5.5/P5.6 health/gap/overlap/drift + adoption + A5 outcome, emits lifecycle candidates (register/promote/deprecate/consolidate/modify). | **REFACTOR-INTO-GREENFIELD** — A7 becomes an **intelligence and proposal layer** (spec §26); the signal→candidate mapping (spec §28 table) is preserved and retargeted to `CapabilityEvolutionCandidate` with intents create/promote/update/consolidate/deprecate (spec §27). |
| 2.7 | `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts:14-56` | `CapabilityLifecycleMeasurer` — A5 post-application observation evidence + `measured` ledger append. | **RECONCILE** — A5 remains the outcome authority (spec §4.1). Measurement becomes A5-over-catalog; the `measured` ledger event stays in `CapabilityGovernanceEvent` (spec §37), the ad-hoc measurer wiring does not. |
| 2.8 | `src/evolution/capability-lifecycle/capability-execution-projection.ts:20-38` | `CapabilityExecutionProposal` = `EvolutionProposal & { changes: CapabilityChangeStep[] }` — bridges the A7 decided record onto A4 steps (`capability.transition`). | **REMOVE** — greenfield carries the concrete `CapabilityMutation` in the candidate/proposal (spec §27), replacing the `changes` overlay projection; `EvolutionProposal` itself is preserved. |
| 2.9 | `src/evolution/capability-lifecycle/capability-proposal-builder.ts:26-64` | `buildCapabilityProposals` — builds A0 `EvolutionIntent`/`EvolutionProposal` with `target: { kind: "capability", id }` (:43). | **REFACTOR-INTO-GREENFIELD** — A0 proposal/intent artifacts are preserved (spec §38 Artifact Ownership); the builder re-targets from `CapabilityLifecycleCandidate` to `CapabilityEvolutionCandidate` + `CapabilityMutation`. |
| 2.10 | `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts` | A7 ledger record types: `CapabilityLifecycleRecord` (:56-78), `CapabilityProjectionState` (:174-179) **including `APPROVED_PENDING_APPLICATION` (:177)**, `deriveCapabilityProjectionState` (:185-193), validator (:92-145). | **REFACTOR-INTO-GREENFIELD** — the six P5.5 lifecycle states (:84-86) are preserved; the `APPROVED_PENDING_APPLICATION` projection state is **REMOVED** (spec §17: "No artificial lifecycle value such as APPROVED_PENDING_APPLICATION is required" — lifecycle, governance, and requested state are separate dimensions). Ledger record shape migrates to `CapabilityGovernanceEvent` (§37). |
| 2.11 | `src/evolution/capability-lifecycle/errors.ts:15-19` | `CapabilityNotExecutableError` — A7.1 deferred-intent guard ("register/modify not executable"). | **REMOVE** — greenfield makes register/modify real governed mutations (§21-22); the deferral concept is gone. |
| 2.12 | `src/evolution/capability-lifecycle/index.ts:1-14` | Module barrel re-exporting all of the above. | **REMOVE** with the module. |
| 2.13 | `src/capability/registry.ts:100-122` | **A7 lifecycle overlay on the runtime registry**: `applyLifecycleTransition` (:100-103), `getLifecycleState` (:105-107), `clearLifecycleState` (:111-113), `listLifecycleStates` (:118-122), plus the `lifecycle` map (:29). | **REMOVE** — Stage 5 "Migrate lifecycle overlay": lifecycle state moves out of the ad-hoc registry overlay into the canonical runtime-state model (`CapabilityLifecycleState` + `RegisteredCapability`, spec §16/§15). |
| 2.14 | `.alix/capability-lifecycle/lifecycle.jsonl` | Runtime artifact — the A7 ledger file (created at runtime by `JsonlCapabilityLifecycleLedger`; default path `DEFAULT_CAPABILITY_LIFECYCLE_FILE`). Existing history is preserved as governance history; the file path/convention is superseded by `.alix/capabilities/definitions.jsonl` + `bindings.jsonl` (spec §70 Stage 2). | **RECONCILE** — history retained, path convention superseded. |

**A7 lifecycle tests** (remove/refactor with the module): `tests/evolution/capability-lifecycle/` — `capability-cli.test.ts`, `capability-execution-projection.test.ts`, `capability-governance-bridge.test.ts`, `capability-lifecycle-analyzer.test.ts`, `capability-lifecycle-applier.test.ts`, `capability-lifecycle-contract-a71.test.ts`, `capability-lifecycle-ledger.test.ts`, `capability-lifecycle-measurer.test.ts`, `capability-lifecycle-record.test.ts`, `capability-lifecycle-rehydration.test.ts`, `capability-lifecycle-step-executor.test.ts`, `capability-proposal-builder.test.ts`, `evolution-target-contract.test.ts`, `integration/a7-1-capability-application-integration.test.ts`, `integration/a7-capability-lifecycle-integration.test.ts`; plus `tests/capability/registry-lifecycle-overlay.test.ts`.

**Superseded design docs** (mark as superseded by the greenfield): `docs/superpowers/specs/2026-08-10-a7-capability-marketplace-design.md`, `docs/superpowers/specs/2026-08-10-a7-1-capability-application-design.md`.

---

## 3. Capability definition sources (duplicate registration paths)

Spec §13 / §70 Stage 1: `initial-capabilities.ts`, `tool-registry.ts`, and tool-adapter cards become **bootstrap providers**, not authorities. `initial-capabilities.ts` MUST NOT remain an independent definition universe (§13).

| # | File:line | What it is | Disposition |
|---|-----------|-----------|-------------|
| 3.1 | `src/capability/initial-capabilities.ts:9-54` | `registerInitialCapabilities` — the current **sole definition database**: 4 hard-coded `Capability` objects (`core.session.list`, `core.session.show`, `tool.file.read`, `tool.shell.run`) registered directly into the runtime registry (:53). | **REFACTOR-INTO-GREENFIELD** — becomes a `CapabilityBootstrapProvider` (spec §13) feeding the persistent catalog at init; MUST NOT stay an independent definition universe (§13/Stage 1). |
| 3.2 | `src/tools/tool-registry.ts:40-117,123-216` | `ToolRegistry` / `CapabilityIndex` / `ToolRetriever` + `buildDefaultToolIndex` — 8 tool capabilities (`file.read`, `file.create`, `file.delete`, `file.exists`, `dir.search`, `shell.run`, `patch.apply`, `done`) with `capabilityId` values (`filesystem.read`, `shell.exec`, `code.patch`, ...). | **REFACTOR-INTO-GREENFIELD** — becomes a bootstrap provider; its `name → capabilityId` vocabulary is the raw material for catalog bindings (`bindings[].provider.type`, spec §9). |
| 3.3 | `src/tools/capability-map.ts:23-63` | `LEGACY_TO_CANONICAL` (:23-43), `legacyCapabilityToCanonical` (:45-47), `TOOL_CAPABILITY_MAP` (:49-59), `inferCapability` (:61-63) — the tool-name → canonical-capability discovery path used by `ToolExecutor`. | **RECONCILE** — this mapping vocabulary feeds the canonical catalog's binding vocabulary; the *ad-hoc infer/fallback* (`?? "tool.invoke"`, `mcp.invoke` catch-alls) is superseded by explicit bindings + availability (spec §10 invariants #9-10). |
| 3.4 | `src/tools/executor.ts:138-139,464-467` | `inferCapability(name)` + `legacyCapabilityToCanonical(capability)` in the tool executor — runtime tool→capability resolution, emits `canonicalCapability` in tool telemetry (:156,207,236,247,254). | **RECONCILE** — tool execution remains; the capability string resolution should come from the catalog binding, not a hardcoded map. `canonicalCapability` telemetry contract is reused by the TUI projection (see 5.16). |
| 3.5 | `src/integrations/session-capabilities.ts:7-46` | `registerSessionCapabilities` — wires real session handlers (`core.session.list`, `core.session.show`) + the composed `core.session.summary` (:27-38). | **REFACTOR-INTO-GREENFIELD** — becomes a bootstrap provider + native-handler binding. |
| 3.6 | `src/capability/tool-adapter.ts:8-16` | `createToolExecutorAdapter` — adapts `ToolExecutor.execute()` to the capability executor seam (`ToolExecutorAdapter`). | **RECONCILE/REMOVE** — the tool executor becomes a provider binding resolved by the greenfield provider-resolver, not a separately-registered strategy executor. |
| 3.7 | `src/capability/platform.ts:13` | `readonly registry = new CapabilityRegistry()` — the runtime platform's registry ("CapabilityRegistry instance A", spec §3). | **REFACTOR-INTO-GREENFIELD** — the runtime registry becomes a projection of the catalog (spec §14 `CapabilityRegistry` interface: get/list/isAvailable/resolve). |
| 3.8 | `src/policy/capability-registry.ts:19-76` | **A second, policy-facing `CapabilityRegistry`** — `ToolCapability` with `riskLevel`/`requiresApproval`, hardcoded defaults (:60-75). | **REFACTOR-INTO-GREENFIELD** — policy's risk/approval metadata moves to the catalog definition; the separate registry + hardcoded defaults are superseded. |
| 3.9 | `src/policy/policy-engine.ts:8,54,410,421` | `withCapabilityRegistry(registry)` — injects the policy `CapabilityRegistry` into `PolicyGate` evaluation. | **RECONCILE** — the injection seam stays; the registry type becomes the catalog-backed definition source. |
| 3.10 | `src/registry/capability-resolver.ts:39-67` | `resolveCapabilities` — graph-node preflight resolving required capabilities against agent/tool **cards** (`CardRegistry`) via `src/cli.ts:474-492`. | **RECONCILE** — a duplicate discovery path keyed by card tags, not the catalog; re-align to the catalog or keep as a card-level filter that consumes catalog capability ids. |
| 3.11 | `src/capability/executors.ts:7-42` | `ExecutorRegistry` (strategy-keyed), `NativeExecutor`, `ToolExecutorAdapter` — executor dispatch keyed by `execution.strategy` strings. | **RECONCILE** — native handlers + tool adapters survive as provider implementations; the strategy-string key gives way to `bindings[].provider.type`. |

---

## 4. The old `Capability.kind` / `execution.strategy` representations

Greenfield replaces `kind: "core"|"tool"|"skill"|"custom"|"workflow"|"plugin"` with semantic `CapabilityKind` (core|query|operation|workflow|agent) and `execution.strategy` with `bindings[].provider.type` (spec §7.1, §9; research `docs/research/wf-r1-capability-classification.md`).

| # | File:line | What it is | Disposition |
|---|-----------|-----------|-------------|
| 4.1 | `src/capability/types.ts:4-25` | The `Capability` definition — `kind: "core" \| "tool" \| "skill" \| "custom" \| "workflow" \| "plugin"` (:7), `execution: { strategy: string; ... }` (:18-22), flat `version: string`. | **REFACTOR-INTO-GREENFIELD** — becomes `CapabilityDefinition` with semantic `CapabilityKind` + `bindings[]` + `id@version` identity (spec §7-9). |
| 4.2 | `src/capability/initial-capabilities.ts:12,25,34,44` | `kind: "core"` / `kind: "tool"`, `execution: { strategy: "native" }` (:22,31) / `execution: { strategy: "tool" }` (:40,49), `extensions: { toolName }` (:41,50). | **REFACTOR-INTO-GREENFIELD** — provider binding vocabulary. |
| 4.3 | `src/integrations/session-capabilities.ts:28,37` | `kind: "core"`, `execution: { strategy: "native" }` on the composed `core.session.summary`. | **REFACTOR-INTO-GREENFIELD** — provider binding. |
| 4.4 | `src/capability/execution-resolver.ts:83` | `executor: cap.execution.strategy` — `ExecutionResolver` maps strategy strings to executors. | **REFACTOR-INTO-GREENFIELD** — replaced by the greenfield provider-resolver that resolves `bindings[].provider.type` against provider availability (spec §9, §31). |
| 4.5 | `src/capability/runtime.ts:145-146,151` | `this.executors.get(step.executor)` — `CapabilityRuntime` dispatches steps by strategy string. | **REFACTOR-INTO-GREENFIELD** — dispatch resolves the capability's binding provider. |
| 4.6 | `src/capability/registry.ts:79` | `q.kinds` query filter compares against `c.kind` (legacy kind strings). | **REFACTOR-INTO-GREENFIELD** — filter over semantic `CapabilityKind`. |
| 4.7 | `src/tui/capabilities/capabilities-view.ts:84,87` | Renders `kind: ${detail.kind}` and `strategy: ${ex.strategy}` in the capability detail pane. | **RECONCILE** — view re-renders the new kind + provider vocabulary. |
| 4.8 | `src/tools/executor.ts:219` | `kind: "tool"` on the approval `ContinuationStore` continuation record. | **RECONCILE** — continuation payload uses the canonical capability id/kind. |

---

## 5. Split-surface / second-registry assumptions

| # | File:line | What it is | Disposition |
|---|-----------|-----------|-------------|
| 5.1 | `src/cli.ts:2221` | `new CapabilityRegistry()` — "CapabilityRegistry instance B" (spec §3). | **REMOVE** — Stage 4. |
| 5.2 | `src/capability/platform.ts:13` | `new CapabilityRegistry()` — "CapabilityRegistry instance A" (spec §3). | **REFACTOR-INTO-GREENFIELD** — registry becomes catalog projection (§14). |
| 5.3 | `src/tui/capabilities/capability-service.ts:46-125` | `CapabilityService` — TUI façade over `CapabilityPlatform`: owns the platform, wires `registerInitialCapabilities` (:67) + `registerSessionCapabilities` (:74-75) + tool executor adapter (:83), bridges events to EventLog (:90-96), module singleton accessor (:129-135). | **REFACTOR-INTO-GREENFIELD** — becomes the canonical application-level `CapabilityService` shared by CLI/TUI/Web (spec §43); its platform-internal registry becomes the projection. |
| 5.4 | `src/cli/commands/tui.ts:265-283` | TUI bootstrap constructs `new CapabilityService(...)` + `setCapabilityService(...)` (:267-281) and injects the `ToolExecutor` as the tool seam. | **REFACTOR-INTO-GREENFIELD** — becomes the single bootstrap of the shared `CapabilityService`; tool executor becomes a provider binding. |
| 5.5 | `src/tui/app.ts:53-55,164,191-192,878` | `TuiApp` accepts an optional `capabilityService`, passes it to `PaletteController`, binds the chat presenter, and gates palette activation. | **RECONCILE** — consumes the shared service; no second registry. |
| 5.6 | `src/tui/palette-controller.ts:7,18-19` | `capabilityService?` option + `hasCapabilityService()` gate. | **RECONCILE** — consumes the shared service. |
| 5.7 | `src/tui/capabilities/palette.ts:43-56` | `CapabilityProvider` — palette entries sourced from `getCapabilityService().query()`. | **RECONCILE** — queries the shared service/catalog. |
| 5.8 | `src/tui/capabilities/capabilities-view.ts:27-159` | `CapabilitiesView` — the TUI "Capabilities" tab: search, list, detail, invoke-on-Enter, per-capability runtime activity from `CapabilityProjection` (:104-113). | **RECONCILE** — consumes the shared service; the projection (5.16) remains the activity read model. |
| 5.9 | `src/tui/capabilities/invocation-presenter.ts:77-135` | `ChatInvocationPresenter` — routes capability invocations into the chat timeline + emits the single `chat.response` EventLog entry at settlement. | **RECONCILE** — presentation contract reused by the greenfield runtime. |
| 5.10 | `src/tui/capabilities/schema-renderer.ts` | Schema shape rendering (args/result schema → terminal lines). | **RECONCILE** — reused; schemas move onto `CapabilityDefinition`. |
| 5.11 | `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts:174-179,185-193` | `CapabilityProjectionState` incl. **`APPROVED_PENDING_APPLICATION`** (:177) + `deriveCapabilityProjectionState` (:185-193). | **REMOVE** — spec §17: lifecycle / governance / requested are three separate dimensions; the artificial projection state is unnecessary. |
| 5.12 | `src/evolution/contracts/evolution-contract.ts:75-85,97,321` | `EvolutionTargetKind` (incl. `"capability"`) + `VALID_EVOLUTION_TARGET_KINDS` — A0 contract, used by `EvolutionProposal.target`. | **RECONCILE/PRESERVE** — A0 contract kept; `capability` target remains but now references a catalog capability id. |
| 5.13 | `src/evolution/capability-lifecycle/capability-proposal-builder.ts:43` | `target: { kind: "capability", id: candidate.target.capabilityId }` — A7 proposal targeting. | **REFACTOR-INTO-GREENFIELD** — A0 `EvolutionIntent` retained; target id becomes catalog `CapabilityId` (spec §8). |
| 5.14 | `src/evolution/pattern-discovery/evolution-proposal-generator.ts:24,80` | `CATEGORY_TARGET_KIND_MAP: Record<PatternCategory, EvolutionTargetKind>` — generic (non-capability) pattern→target mapping. | **RECONCILE** — unaffected by the capability refactor beyond the shared `EvolutionTargetKind` type. |
| 5.15 | `src/tui/runtime/capability-projection.ts:82-235` | `CapabilityProjection` — durable EventLog projection over capability invocation events + tool telemetry (`canonicalCapability`), explicitly "Never queries the CapabilityRegistry — independent read model sharing only capabilityId" (:75-76). | **RECONCILE/PRESERVE** — this is a legit runtime-activity read model (tool/capability telemetry), not a second registry; greenfield reuses it for availability/activity stats. |
| 5.16 | `src/capability/event-bus.ts` | `EventBus` + `toAlixEvent` — bridges platform `CapabilityEvent`s into `capability.*` EventLog entries. | **RECONCILE** — the `capability.*` EventLog event types are consumed by 5.15; preserved as the telemetry bridge. |

---

## 6. Cross-cutting legacy

| # | File:line | What it is | Disposition |
|---|-----------|-----------|-------------|
| 6.1 | `src/mcp/capability-mapper.ts:10-39` | `mapServerCapabilities` — maps MCP server capabilities + tools to policy rules (`mcp.<server>.*`, `mcp.<server>.<tool>`). Consumed by `src/mcp/manager.ts:67-69,110,124`. | **RECONCILE** — MCP tool/operation handling becomes provider bindings (`provider.type: "mcp"`); the `mcp.<server>.<tool>` capability naming feeds the catalog. |
| 6.2 | `src/capability/execution-resolver.ts:27-89` | `ExecutionResolver` — resolves a capability to an `ExecutionPlan` from dependencies + `cap.execution.strategy`. | **REFACTOR-INTO-GREENFIELD** — replaced by the provider-resolver that resolves `bindings[].provider.type` (spec §9, §31); the dependency-composition logic (depth-first, cycle detection :54-78) is retained. |
| 6.3 | `src/evolution/execution/execution-planner.ts:163-185,312-370` | A4 execution planner: `createExecutionPlan`, `createDefaultRollbackResolver` — includes the A7 `capability.transition` / `capability.restore_transition` rollback mapping (:173-183). | **RECONCILE** — A4 planner preserved; the `capability.transition` rollback mapping is re-homed into the A4 `CapabilityMutationExecutor` (spec §32, §35 Rollback). |
| 6.4 | `src/evolution/execution/execution-runtime.ts:63-73,93-135` | A4 `GovernedExecutionRuntime` + `StepExecutor` interface — sequential governed execution with pre/post-condition validation, checkpointing, rollback. | **PRESERVE** — A4 runtime retained; the mutation executor is a new `StepExecutor` implementation (spec §32). |
| 6.5 | `src/evolution/execution/execution-authorization.ts:81-143` | A4 `authorizeExecution` — 7 pre-flight checks (decision exists/APPROVE/integrity/proposal-match/expiry/revoke/duplicate). | **PRESERVE** — A4 gate retained for all governed mutations (spec §34). |
| 6.6 | `src/evolution/execution/execution-cli.ts:126-331` | A4.5 `runExecute` — the `alix governance evolution execute` CLI (`src/governance/evolution-cli.ts:134`). Shares `GovernedExecutionRuntime`/`createExecutionPlan` with the A7 applier; not capability-specific. | **RECONCILE** — retained for A4 evolution execution; aligns to the mutation-executor seam. |
| 6.7 | `src/evolution/execution/execution-evidence-bridge.ts` | `buildExecutionEvidence` — A4 execution evidence (EvolutionExecutionEvidence). | **PRESERVE** — A4 evidence contract (spec §38). |
| 6.8 | `src/evolution/execution/contracts/execution-contract.ts:48-61,92-111` | `ExecutionStep` / `ExecutionPlan` / `RollbackStep` / `ExecutionEnvironment` A4 contracts. | **PRESERVE** — A4 contracts (spec §38). |
| 6.9 | `src/evolution/execution/contracts/execution-lifecycle.ts` | `ExecutionState` lifecycle enum (approved/executing/completed/failed/rolling_back/rolled_back). | **PRESERVE** — A4 state model. |
| 6.10 | `src/governance/execution-plans.ts:171` | `createExecutionPlanFromRemediation` — a second A4 plan builder for P-series remediation. | **RECONCILE** — parallel A4 planner; unaffected by the capability refactor beyond the shared plan contract. |
| 6.11 | `src/runtime/execution-authorization.ts:31-128` | Runtime `ExecutionAuthorization` — the policy/composition authorization boundary (`CapabilityResolver → PolicyGate → ApprovalStore → OwnershipGate → Audit`) using the **policy** `CapabilityRegistry` (:14,25,49). | **RECONCILE** — the runtime auth boundary stays; its capability-metadata source (policy registry) re-aligns to the catalog. |
| 6.12 | `src/capability/hook-registry.ts` | `HookRegistry` — approve/policy/audit/metrics hook surface outside Capability metadata. | **RECONCILE** — hook seam retained on the greenfield runtime; hooks keyed by capability id. |

---

## PRESERVED — proven contracts the greenfield reuses

| # | Contract | File:line | Why preserved |
|---|----------|-----------|---------------|
| P1 | A0 `EvolutionProposal` / `EvolutionIntent` / `EvolutionTargetKind` | `src/evolution/contracts/evolution-contract.ts:75-85,97,321` | Greenfield proposals are A0 artifacts (§38 Artifact Ownership); `capability` target retained. |
| P2 | A2.5 `GovernanceRecommendation` | `src/verification/contracts/recommendation-contract.ts` | A7→A3 bridge builds A2.5 recommendations (§38); greenfield candidates carry evidenceRefs (§27). |
| P3 | A3 `GovernanceDecision` + `generateDecision` / `computeDecisionIntegrityHash` | `src/governance/decision-engine.ts`, `src/governance/contracts/decision-contract.ts` | A3 remains the governance authority (§4.1); full decision artifact persisted on decided records. |
| P4 | A4 governed execution (planner, runtime, authorization, contracts, evidence bridge) | `src/evolution/execution/` | The A4 `CapabilityMutationExecutor` is built on the A4 execution machinery (§32-35). |
| P5 | A5 `VerificationEvidence` + evidence builders | `src/verification/contracts/verification-contract.ts`, `src/verification/evidence/verification-evidence.ts` | A5 remains the outcome authority (§4.1); A7 evidence built on the same builder. |
| P6 | P5.5/P5.6 capability intelligence (six-state `LifecycleState`, health/gap/overlap/drift report) | `src/adaptation/capability-evolution-types.ts:15-21`, `src/adaptation/capability-evolution-store.ts` | Greenfield `CapabilityLifecycleState` is exactly the six P5.5 states (§16); A7 consumes P5.5/P5.6 signals (§28). |
| P7 | Ledger **history role** (append-only governance traceability) | `src/evolution/capability-lifecycle/capability-lifecycle-ledger.ts` (rebuilt as `CapabilityGovernanceEvent`, spec §37) | Ledger records proposed/decided/applied/measured history; it is NOT the canonical catalog (§37, §39). |
| P8 | Tool/capability telemetry events (`capability.*`, `canonicalCapability`) | `src/capability/event-bus.ts`, `src/tools/executor.ts:156,207,236,247,254`, `src/tui/runtime/capability-projection.ts` | Runtime activity/availability read model (5.15/5.16) survives as the projection over catalog capability ids. |
| P9 | Provider vocabulary research (feeds `CapabilityKind` + `bindings[].provider.type`) | `docs/research/wf-r1-capability-classification.md` | Prior research (#473/#474) that the greenfield §7.1/§9 adopt directly. |
| P10 | Definition versioning research (feeds `id@version`) | `docs/research/wf-r2-definition-versioning.md` | Prior research (#474) that the greenfield §8/§65/§66 adopt directly. |

---

## Notes for the CAP-11/12 reconciliation

1. **Two registries, one class.** `src/capability/platform.ts:13` (runtime) and `src/cli.ts:2221` (CLI) both construct `new CapabilityRegistry()` from `src/capability/registry.ts`. The greenfield deletes the class's registry-role and replaces both sites with a catalog-backed projection (§3, §14, Stage 4).
2. **Three independent definition databases today**: `src/capability/initial-capabilities.ts` (4 defs), `src/tools/tool-registry.ts` `buildDefaultToolIndex` (8 defs), `src/policy/capability-registry.ts` `registerDefaults` (8 defs). All three become bootstrap providers (§13, Stage 1); none remains an authority.
3. **`APPROVED_PENDING_APPLICATION` is explicitly deleted** by spec §17 — the projection state in `lifecycle-contract.ts:174-193` and its CLI consumer (`capability-lifecycle-cli.ts:102,113,115`) go with the CLI.
4. **Ledger ≠ catalog.** The `.alix/capability-lifecycle/lifecycle.jsonl` keeps history only; definitions move to `.alix/capabilities/definitions.jsonl` + `bindings.jsonl` (Stage 2). Rehydration must read the catalog store, never replay A7 history (§39).
5. **The A7 "register/modify deferred" guard** (`errors.ts` `CapabilityNotExecutableError`, `applier.ts:44-46`) is removed because greenfield makes create/update real governed mutations (§21-22).
6. **Tool/MCP/CLI-specific capability representations collapse** into `bindings[].provider.type` — the executor-strategy key (`execution.strategy`), tool-adapter registration, and MCP capability-mapper policy rules all reconcile onto provider bindings (§9, §31).
7. **TUI split-surface is a consumer, not a second registry** — `CapabilityService` (5.3) is refactored into the shared service; `CapabilityProjection` (5.15) is a read model and is preserved.
