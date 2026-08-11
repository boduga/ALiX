# ALiX Capability Platform — Reconciled CAP Program (Execution Authority)

**Status:** Decision-complete (wayfinder map #472)
**Date:** 2026-08-11
**Supersedes:** the *execution ordering* of `docs/superpowers/plans/2026-08-10-capability-platform-greenfield-refactor.md`. ADR-0013 and the greenfield architecture design remain the architectural authorities; this document reconciles them into the executable CAP-1…CAP-12 program.
**Inputs:** ADR-0013 (Accepted) · greenfield architecture design §70/§82/§72 · refactor plan §19/§20 · wayfinder decisions #473-#481 · legacy-surface inventory #482.

> **This document supersedes the execution ordering of the earlier refactor plan. ADR-0013 and the greenfield design remain the architectural authorities; this document reconciles them into the executable CAP-1…CAP-12 program.**

---

## 1. Document hierarchy

```text
ADR-0013
   │
   │ architectural authority
   ▼
Greenfield Design (docs/superpowers/specs/2026-08-10-capability-platform-greenfield-architecture-design.md)
   │
   │ architectural specification
   ▼
Reconciled CAP Program (this document)
   │
   │ execution authority
   ▼
CAP-1 ... CAP-12
   │
   ▼
Implementation plans / tasks
```

The older refactor plan remains provenance. It is **not** the execution authority; its §19 execution order is superseded by §5 of this document.

---

## 2. Core invariants (from ADR-0013 + locked decisions)

1. **One canonical capability universe.** One `CapabilityRegistry` per runtime composition; one capability identity; one governed mutation path; one historical governance ledger. No second capability surface.
2. **Three independent axes** (#481, #476): **Definition** (immutable `id@version`) · **Lifecycle** (six states) · **Availability** (available / missing_binding / provider_unavailable). No dormant state; unbound = available:false.
3. **Kind is semantic, never implementation.** `CapabilityKind = core | query | operation | workflow | agent` (#475). Provider technologies (`native|tool|mcp|external-cli|daemon|agent|plugin|remote-api`) live in `bindings[].provider.type` (#476, ADR-0013 §4). Invariant: provider technologies MUST NOT be kinds.
4. **A4 is the only mutation boundary.** Every definition mutation — create/update/transition/consolidate/remove — crosses A4 (`authorizeExecution` → plan → `GovernedExecutionRuntime` → rollback). A7 proposes; A3 decides; A4 mutates; A5 measures; P5.5/P5.6 signal (#481, ADR-0013 §6).
5. **Registries are projections; the catalog is truth.** Registry = current runtime state, projected from the persistent catalog. Ledger = governance history. Neither is the catalog (§39, §37).

---

## 3. Locked decisions index

| # | Decision | Resolution (gist) |
|---|----------|-------------------|
| #473 | Classification + fallback research | Convergent `CapabilityKind` + provider-fallback = ordered priority + `allowFallbacks` + bounded single-pass + error classes. |
| #474 | Versioning research | Full-SemVer `id@version`; immutable publications; history retained; governance pins exact `id@version`. |
| #475 | CapabilityKind vocabulary | Semantic-form `core\|query\|operation\|workflow\|agent`; no `custom`; provider tech ≠ kind. |
| #476 | Provider/binding vocabulary + fallback | ADR-0013 `bindings[].provider.type` verbatim; `allowFallbacks` default true; exhaustion → `CapabilityAvailability{available:false}`. |
| #477 | Consolidation semantics | True governed merge with explicit proposed target definition + `sourceDisposition`; no silent redefinition. |
| #478 | Create-definition authorship | Two-phase authoring (`DefinitionAuthoringStatus = required\|incomplete\|valid`); A7 proposes gaps, operator authors definitions; no invented defaults. |
| #479 | Versioning policy | Full SemVer, immutable `id@version`, executor-classified bump, governance pins exact publication; versioning ≠ second lifecycle authority. |
| #480 | Update executability | `capability.update` executable, versioning-consistent: governed source `id@version`, executor-determined bump, failed update = no-op. |
| #481 | Lifecycle graph + dormant | Six states, fixed acyclic graph, `deprecated` terminal, no dormant, transitions governed not metric-driven. |
| #482 | Legacy-surface inventory | 74 entries: 26 REMOVE / 19 REFACTOR / 27 RECONCILE / 10 PRESERVE. Top removals listed in §7 CAP-11. |

---

## 4. Decision-to-increment traceability matrix

If someone proposes changing a CAP, this matrix shows which locked architectural decision they may be violating.

| Locked decision | Primary CAP | Also affects |
|-----------------|-------------|--------------|
| Semantic `kind` vocabulary (#475) | CAP-1 | CAP-11 |
| `provider.type` + bindings (#476) | CAP-1 | CAP-4, CAP-6, CAP-8 |
| Provider fallback + availability (#476) | CAP-4 | CAP-7, CAP-11 |
| Two-phase create authoring (#478) | CAP-2 | CAP-6, CAP-9 |
| Immutable SemVer `id@version` (#474/#479) | CAP-1 | CAP-2, CAP-5, CAP-6, CAP-9 |
| True governed consolidation (#477) | CAP-5 | CAP-6, CAP-9, CAP-10 |
| Executable update (#480) | CAP-5 | CAP-6, CAP-9 |
| Fixed lifecycle graph + deprecated terminal (#481) | CAP-5 | CAP-6, CAP-7, CAP-9 |
| No dormant state — availability axis (#481) | CAP-5 | CAP-4, CAP-7 |
| **CapabilityService facade + read surfaces** (#480 → design §72) | **CAP-8** | CAP-9, CAP-10 |
| CapabilityService governed methods (propose/apply/measure/history) | CAP-8 (contract), wired in | CAP-9, CAP-10 |
| Legacy-surface removal + structural sentinel (#482) | CAP-11 | CAP-8, CAP-12 |

> **Correction to the Q1 draft:** the draft matrix listed "Service unification → CAP-10". The Q2 ruling is binding: the unified `CapabilityService` facade is established at **CAP-8** (read surfaces implemented immediately; governed method contracts forward-wired), with the *governed methods themselves* arriving as their dependencies land in CAP-9/CAP-10. This keeps the service the architectural seam rather than creating another surface later.

---

## 5. Program shape (order + boundary redraws)

**The CAP-1 → CAP-12 order is preserved** (design §82), dependency-correct and contracts-first.

**Three boundaries are redrawn** by the locked decisions:

1. **CAP-4 is a real provider-resolution boundary**, not a bindings add-on. It carries the full R1 fallback contract (#476) as acceptance proof (ordered bindings → `allowFallbacks` → health/error class → bounded single pass → available/unavailable(reason)).
2. **CAP-5 is deliberately the largest increment** — all mutation semantics + the lifecycle policy in one contract (#477/#479/#480/#481). CAP-6 then merely *executes* the already-defined mutations.
3. **CAP-8 establishes the unified service contract early** — read methods implemented, governed methods capability-gated/forward-wired — rather than deferring the facade until A7/A5 land.

**CAP-11 is an architectural deletion gate**, not cleanup: its acceptance mechanically asserts the invariants of §2 via a structural sentinel test.

---

## 6. Graduated fog (from map #472 "Not yet specified")

All four fog items sharpened to concrete placement:

| Fog item | Sharpened by | Placement |
|----------|-------------|-----------|
| MCP resource→capability threshold | #476 (binding model) + ADR-0013 MCP rule + plan Task 6.3 | CAP-4 (provider/binding rule: resources remain provider resources unless a meaningful semantic operation) |
| Plugin/remote-api provider mechanics | #476 (provider classes) + ADR-0013 §4 | CAP-4 (provider executors) |
| `CapabilityService` exact method surface vs design §72 | #480 (update-executability → apply() forward-wiring) | CAP-8 (design §72 surface adopted verbatim) |
| Legacy-surface structural sentinel | #482 (inventory) + plan Workstream 13 | CAP-11 (acceptance gate) |

---

## 7. The reconciled increments

Each CAP records: **Purpose · Scope · Dependencies · Locked decisions incorporated · Files/modules affected · Migration boundary · Acceptance criteria · Tests/invariants · Checkpoint/tag · What subsequent CAPs may assume.**

---

### CAP-1 — Canonical Capability Definition

**Purpose.** The single canonical `CapabilityDefinition` contract: semantic identity, immutable SemVer versioning, provider bindings separate from kind.

**Scope.** `CapabilityDefinition` type (replaces `src/capability/types.ts` `Capability`); semantic `CapabilityKind` (`core|query|operation|workflow|agent`); `id@version` identity; `bindings[]` + `provider.type` union; canonical validation (reject short SemVer, empty provider IDs, non-serializable handles, kind=provider-technology); migration vocabulary from `initial-capabilities.ts` and `tool-registry.ts`.

**Dependencies.** None (first increment). Consumes research #473/#474 findings.

**Locked decisions incorporated.** #475 (kind vocabulary, provider-tech ≠ kind), #476 (binding vocabulary), #479 (SemVer `id@version`).

**Files/modules affected.** `src/capability/types.ts`; `src/capability/initial-capabilities.ts` (vocabulary only — behavior unchanged, see CAP-2); `src/tools/tool-registry.ts` (capabilityId vocabulary); `src/policy/capability-registry.ts` (risk/approval metadata → definition fields); `docs/research/wf-r1-*.md`, `wf-r2-*.md`.

**Migration boundary.** Contract stands alone; **no runtime behavior change** (design §70 Stage 1 "do not change behavior yet"). The old `Capability` type is superseded in-place; consumers migrate over later CAPs.

**Acceptance criteria.**
- No semantic `kind` means `tool`, `mcp`, `cli`, `gh`, or `gitnexus`.
- Provider technology appears only in `bindings[].provider.type`.
- All current capabilities representable without information loss.
- `id@version` validated full SemVer; `"1.0"` rejected.
- Every definition is pure data; no live executor instance embedded.

**Tests/invariants.** Kind/provider-separation contract tests; SemVer validation; serialization round-trip; backward-compatible representation of the existing 20+ capabilities.

**Checkpoint/tag.** CAP-1 contract green (unit). Final tag only at CAP-12 (`alix-capability-greenfield-complete`); intermediate increments commit but do not tag.

**What subsequent CAPs may assume.** CAP-2 persists this definition shape; CAP-4 consumes `bindings[]`; CAP-5 mutates it.

---

### CAP-2 — Persistent Capability Catalog

**Purpose.** Durable catalog store; bootstrap providers replace the three independent definition databases; two-phase create authoring contract.

**Scope.** `CapabilityDefinitionStore` (`.alix/capabilities/definitions.jsonl` + `bindings.jsonl`); source precedence (built-in → project-local → plugins → provider discovery → governed registrations → explicit overrides); bootstrap providers from `initial-capabilities.ts`, `tool-registry.ts buildDefaultToolIndex`, `session-capabilities.ts`, `policy/capability-registry.ts registerDefaults`; `DefinitionAuthoringStatus = required|incomplete|valid`; two-phase create authoring contract.

**Dependencies.** CAP-1.

**Locked decisions incorporated.** #478 (two-phase authoring, no invented defaults), #479 (immutable publications retained, corrections = new artifacts), #476 (bindings persisted alongside definitions).

**Files/modules affected.** New `CapabilityDefinitionStore` + `.alix/capabilities/*`; `src/capability/initial-capabilities.ts` → bootstrap provider (no longer the sole definition database); `src/tools/tool-registry.ts`; `src/integrations/session-capabilities.ts`; `src/policy/capability-registry.ts`; `src/capability/registry/capability-resolver.ts` (card-discovery re-aligned to catalog ids).

**Migration boundary.** Catalog populated from bootstrap sources (Stage 2); runtime behavior unchanged. No independent definition universe remains.

**Acceptance criteria.**
- The three definition databases converge into one catalog; none remains an authority.
- Source precedence deterministic and tested.
- `DefinitionAuthoringStatus` enforced: incomplete → authoring required; complete → valid → can become a proposal (CAP-9).
- A capability cannot enter the catalog without a complete explicitly-authored definition passing canonical validation (+ later A3 approval). A7 never invents defaults.
- Store: atomic updates, corruption handling, deterministic ordering.

**Tests/invariants.** Store round-trip; source precedence; authoring-state validation; duplicate-identity rejection; catalog list determinism.

**Checkpoint/tag.** Store + bootstrap parity green.

**What subsequent CAPs may assume.** CAP-3 projects the registry from this catalog; CAP-9 A7 proposes gaps against it; CAP-6 executes create from an authored definition.

---

### CAP-3 — Runtime Registry Projection

**Purpose.** The registry becomes a projection of the catalog — the current-state authority that owns definitions only via the catalog, never independently.

**Scope.** Refactor `src/capability/registry.ts` to the design §14 interface (`register/unregister/get/list/query/getLifecycleState/setLifecycleState/getProviders/getAvailableProviders/export/import`); runtime platform's registry (instance A) becomes the projection; lifecycle state is current registry state (no A7-only overlay authority).

**Dependencies.** CAP-2.

**Locked decisions incorporated.** #481 (registry = current state; ledger = history), #476 (availability in registry), #479 (versioning: `get` by `id@version`, list shows eligible versions).

**Files/modules affected.** `src/capability/registry.ts`; `src/capability/platform.ts`; consumers (`src/capability/runtime.ts` read paths).

**Migration boundary.** Stage 3: runtime init becomes `load catalog → build registry → resolve bindings`.

**Acceptance criteria.**
- Registry `list()` == catalog current state.
- Lifecycle state is current registry state, not a second authority.
- No consumer constructs a second canonical registry.
- Registry provides provider + availability reads (`getProviders`, `getAvailableProviders`).

**Tests/invariants.** Registry/catalog parity; lifecycle-state read; no-second-registry composition check (test-level, sentinel hardens at CAP-11).

**Checkpoint/tag.** Registry-as-projection green.

**What subsequent CAPs may assume.** CAP-4 binds/resolves providers against this registry; CAP-7 gates eligibility on it; CAP-8 surfaces it.

---

### CAP-4 — Execution Binding Model

**Purpose.** Provider bindings + ordered fallback + availability = the execution-resolution boundary. Provider selection is explicit, deterministic, and never changes capability identity.

**Scope.** `CapabilityProviderRegistry` (binding type → executor/adapter); provider resolver replacing `ExecutionResolver` strategy-keyed dispatch; **full R1 fallback model**: ordered priority, `allowFallbacks` (default true, pins when false), bounded single-pass iteration, fallback-eligible error classes (unavailable/timeout/429/5xx) vs fatal (400-class/auth/contract), existing CircuitBreaker/checkProvider as health mechanism; `CapabilityAvailability{available, reason}` (available / missing_binding / provider_unavailable); provider executors for native, tool, MCP, external-cli, daemon, agent, plugin, remote-api; MCP resource→capability threshold; external CLI rule (`gh`, `gitnexus` as providers).

**Dependencies.** CAP-1, CAP-3.

**Locked decisions incorporated.** #476 (full R1 fallback, exhaustion → availability not lifecycle), #481 (availability axis; unbound = missing_binding), ADR-0013 §4/§5/§7 (providers; MCP rule; external CLI rule).

**Files/modules affected.** `src/capability/execution-resolver.ts` → provider-resolver; `src/capability/runtime.ts` dispatch; `src/mcp/capability-mapper.ts` → MCP provider bindings; new provider registry + external-cli executor; `src/capability/executors.ts` (strategy-keyed executor registry → provider implementations).

**Migration boundary.** **Redrawn boundary.** Provider resolution becomes a first-class boundary; fallback is acceptance, not an add-on. Tool/MCP/CLI capability representations collapse into `bindings[].provider.type`.

**Acceptance criteria.**
- Ordered bindings → `allowFallbacks` → health/error classification → bounded single pass → `available`/`unavailable(reason)`.
- Fallback never changes capability identity (`code.repository.impact` stays `code.repository.impact` across GitNexus/MCP/native).
- Provider outage does not mutate lifecycle (active + unavailable is legal).
- MCP protocol plumbing is not registered as capabilities; MCP resources stay provider resources unless a meaningful semantic operation.
- `gh` and `gitnexus` can each implement a capability.

**Tests/invariants.** Provider tests per class; fallback ordering; error-class classification (429/5xx/timeout vs fatal); exhaustion → availability; provider-failure vs capability-failure distinction; deterministic selection for equivalent inputs.

**Checkpoint/tag.** Provider-resolution + fallback suite green.

**What subsequent CAPs may assume.** CAP-6 executes resolved bindings; CAP-7 eligibility gates selection; CAP-8 shows availability.

---

### CAP-5 — Capability Mutation Contract

**Purpose.** Define **all** mutation semantics and the lifecycle policy: what mutations are legal and what state transitions they produce. The largest increment; CAP-6 executes exactly these.

**Scope.** The five governed mutations: `create`, `update`, `transition`, `consolidate`, `remove`. Six-state lifecycle graph. Terminal `deprecated`. No dormant. Availability as separate axis. Immutable publication behavior. True governed consolidation. Executable update. Mutation payloads and transition table.

**Dependencies.** CAP-1, CAP-2 (authoring feeds create), CAP-4.

**Locked decisions incorporated.** #477 (consolidation = true governed merge: `{sources, target, definition, sourceDisposition: deprecate|remove}`, conservative merge rules, `remove` only when safe), #480 (update = immutable publication from governed source `id@version`, executor-determined bump, failed update = no-op), #479 (immutability; governance pins exact `id@version`), #481 (six-state fixed acyclic graph: emerging→active/deprecated, active→mature/declining, mature→declining, stagnant→active/deprecated, declining→deprecated, deprecated terminal; transitions governed not metric-driven), #475 (targets reference semantic kind).

**Files/modules affected.** New mutation-contract module (payloads, transition table); `src/evolution/contracts/evolution-contract.ts` (`EvolutionTargetKind` reconcile — `capability` target references catalog id); `src/evolution/capability-lifecycle/contracts/lifecycle-contract.ts` (three-axis separation; the A7 `APPROVED_PENDING_APPLICATION` projection state is **not** part of the new contract — its deletion is CAP-11).

**Migration boundary.** Contracts-first; **no executor yet** (CAP-6). The old A7 lifecycle overlay (`registry.ts:100-122`) is not extended.

**Acceptance criteria.**
- Five mutation contracts defined with exact payloads and pre/post conditions.
- Lifecycle graph fixed acyclic; `deprecated` terminal; no dormant.
- `update` produces a new immutable publication; no in-place mutation of latest/current.
- `consolidate` requires an explicit proposed target definition; `sources-deprecated-with-no-canonical-target` = deprecation, never consolidation.
- Lifecycle and availability are independent axes.

**Tests/invariants.** Mutation-contract tests; transition-table tests (all legal/illegal transitions); consolidation merge-rule tests; update bump-classification tests.

**Checkpoint/tag.** Mutation + lifecycle contract green.

**What subsequent CAPs may assume.** CAP-6 executes these mutations via A4; CAP-9 A7 proposes these intents; CAP-10 measures their outcomes.

---

### CAP-6 — A4 Capability Mutation Executor

**Purpose.** Execute the five defined mutations through A4 (`authorizeExecution` → `createExecutionPlan` → `GovernedExecutionRuntime` → compensating rollback). A4 remains the only mutation boundary.

**Scope.** `CapabilityMutationExecutor` (new A4 `StepExecutor` implementation); re-home the `capability.*` rollback mappings into the executor (`execution-planner.ts:173-183`); per-mutation execute paths (create/update/transition/consolidate/remove); A4 gate preserved verbatim.

**Dependencies.** CAP-4, CAP-5.

**Locked decisions incorporated.** #480 (update executes an immutable publication from governed source; executor-classified bump; failed update = no-op), #477 (consolidate executes the approved merge), #478 (create executes the authored, approved definition — no placeholder), #481 (transitions are governed executions, not metric-driven).

**Files/modules affected.** New `CapabilityMutationExecutor`; `src/evolution/execution/execution-planner.ts` (rollback re-homing); `src/evolution/execution/execution-runtime.ts`; `src/evolution/execution/execution-authorization.ts` (preserved).

**Migration boundary.** Stage 6. A7 no longer mutates (Stage 7 rewrites A7 in CAP-9). Governed `register` becomes a real, executable operation.

**Acceptance criteria.**
- Every mutation crosses A4; no gate-then-mutate shortcut.
- A4 `register`/`create` can be approved and actually applied (no `APPROVED_PENDING_APPLICATION` dead-end).
- Registration applies a complete definition, not a placeholder.
- Failed mutation = no new definition, no lifecycle mutation (compensating rollback).
- Every governed mutation has immutable input + output artifacts.

**Tests/invariants.** Governance tests: complete proposal → A3 approval without mutation → A4 mutation → rejection-no-mutation → rollback → A5 measure; atomicity (byte-identical registry on append failure); rollback invariants.

**Checkpoint/tag.** Mutation-executor + governance suite green.

**What subsequent CAPs may assume.** CAP-7 eligibility sees the resulting state; CAP-8 `apply()` wires the executor; CAP-9 proposals feed it; CAP-10 measures its outcomes.

---

### CAP-7 — Runtime Lifecycle Eligibility

**Purpose.** Runtime selection respects lifecycle + availability. Governance application changes runtime behavior immediately in-process.

**Scope.** Provider resolver excludes `deprecated` from normal selection (subject to an explicit administrative-override contract); availability distinct from lifecycle (active + unavailable resolves to fallback or unavailable, never lifecycle mutation); runtime dispatch consumes catalog-backed resolution; post-A4 state immediately observable in the same process.

**Dependencies.** CAP-3, CAP-4, CAP-5, CAP-6.

**Locked decisions incorporated.** #481 (deprecated excluded; no dormant; active+unavailable legal), #476 (availability never mutates lifecycle).

**Files/modules affected.** `src/capability/runtime.ts`; `src/capability/execution-resolver.ts`; `src/runtime/execution-authorization.ts` (metadata source re-aligned to catalog).

**Migration boundary.** Stage 8 (runtime eligibility integrated).

**Acceptance criteria.**
- `deprecated` capabilities excluded from normal runtime selection.
- A capability may be `active` while its preferred provider is unavailable; resolver fails over or reports `unavailable` without mutating lifecycle.
- Runtime resolution observes a governed transition immediately after A4 applies it (same process).
- Runtime resolver and `CapabilityService` see the same selection result.

**Tests/invariants.** Eligibility tests; resolver/service parity; active+unavailable scenario; post-apply immediate observability.

**Checkpoint/tag.** Runtime-eligibility suite green.

**What subsequent CAPs may assume.** CAP-8 surfaces availability/eligibility; CAP-12 e2e proves behavior change on apply.

---

### CAP-8 — CLI/TUI/Web Capability Service

**Purpose.** The unified `CapabilityService` facade (design §72) — the architectural seam every surface consumes. Read surfaces implemented now; governed methods forward-wired as their dependencies land.

**Scope.** `CapabilityService` with design §72 surface: `list/inspect/search/health/recommend/propose/apply/measure/history`. **Read methods** (`list/inspect/search/health`) implemented immediately over registry+catalog+provider availability. **Governed methods** (`propose/apply/measure/history`) — contracts defined now, implementations capability-gated/forward-wired: `propose`→CAP-9, `apply`→CAP-6/CAP-9, `measure`→CAP-10, `history`→catalog/ledger. CLI `capabilities` command rebuilt over the service; TUI Capabilities view + palette + invocation presenter + schema renderer consume it; Web UI consumes the same service/read model.

**Dependencies.** CAP-3, CAP-4 (read surfaces). Governed method wiring lands as CAP-6/9/10 complete.

**Locked decisions incorporated.** #480/§72 (service surface adopted verbatim; `apply` forward-wired because update-executability is now real), #479 (list shows `id@version`; inspect shows eligibility), #476 (availability in `inspect`/`health`).

**Files/modules affected.** `src/tui/capabilities/capability-service.ts` → shared application-level service; `src/cli.ts` capabilities block (rebuild over service; **no `new CapabilityRegistry()`**); `src/cli/commands/tui.ts` bootstrap (single shared-service bootstrap); `src/tui/app.ts`, `src/tui/palette-controller.ts`, `src/tui/capabilities/palette.ts`, `capabilities-view.ts`, `invocation-presenter.ts`, `schema-renderer.ts`.

**Migration boundary.** **Redrawn boundary.** Service established early; no second registry created anywhere; the old A7 CLI (`capability-lifecycle-cli.ts`) remains until CAP-11 but is no longer the model — the service is.

**Acceptance criteria.**
- `CLI list == registry list == service list`.
- CLI does not construct a second registry.
- TUI and Web consume the shared service; no duplicate catalog store.
- Governed method contracts present with declared forward-wiring (which CAP implements them).
- `capability.*` EventLog telemetry preserved as the projection source (CAP-15 §5.16 read model).

**Tests/invariants.** Cross-surface catalog parity (CLI/TUI/Web); no-second-registry structural test (loose here, hard sentinel at CAP-11); service contract tests for the design §72 surface.

**Checkpoint/tag.** Service facade + read surfaces + parity green.

**What subsequent CAPs may assume.** CAP-9 wires `propose` (and `apply` full path); CAP-10 wires `measure`; CAP-11 removes the old CLI against this replacement.

---

### CAP-9 — A7 Greenfield Proposal Integration

**Purpose.** A7 becomes intelligence + proposal generation only — it never mutates. Analyze → propose → decide → apply (via CAP-6).

**Scope.** `analyzeCapabilityLifecycle` → `CapabilityEvolutionCandidate` (intents create/promote/update/consolidate/deprecate, per #481 transition graph); proposal builder re-targeted from `CapabilityLifecycleCandidate` to `CapabilityEvolutionCandidate` + `CapabilityMutation`; governance bridge re-targeted (A2.5 → A3; `capability.create` proposals per #478); ledger becomes `CapabilityGovernanceEvent` (append-only history — never the catalog); A7 `recommend`/`propose` service methods live.

**Dependencies.** CAP-5, CAP-6, CAP-8.

**Locked decisions incorporated.** #478 (create proposals carry a gap + suggested identity; operator authors the definition; `REQUEST_MORE_EVIDENCE` stays an A3 outcome), #477 (consolidate proposals carry the explicit target definition), #480 (update proposals target a governed source `id@version`), #481 (transitions proposed, not applied), #479 (governance pins exact `id@version` at write).

**Files/modules affected.** `src/evolution/capability-lifecycle/capability-lifecycle-analyzer.ts`; `capability-proposal-builder.ts`; `capability-governance-bridge.ts`; `capability-lifecycle-ledger.ts` (→ `CapabilityGovernanceEvent`, §37); `capability-execution-projection.ts` (superseded — concrete `CapabilityMutation` replaces the `changes` overlay).

**Migration boundary.** Stage 7 (rewrite A7). A7 no longer holds a registry overlay or mutates.

**Acceptance criteria.**
- A7 produces complete, proposal-shaped artifacts; create proposals never invent implementations.
- A3 approval pins the exact `id@version`; A4 executes the exact approved publication.
- Ledger is history/governance only; the catalog is current truth.
- `recommend` (read-only) and `propose` (governed) service methods operational.

**Tests/invariants.** Proposal-generation tests; governance pin (`id@version`) tests; ledger/catalog separation test; `REQUEST_MORE_EVIDENCE` path.

**Checkpoint/tag.** A7-proposal suite green.

**What subsequent CAPs may assume.** CAP-10 measures applied outcomes; CAP-11 removes the obsolete A7 machinery (applier, rehydration, step-executor, overlay).

---

### CAP-10 — A5 Measurement Integration

**Purpose.** A5 outcome observation over the catalog: post-application observation vs baseline, closing the evolution loop.

**Scope.** Measurer reconciled to A5-over-catalog (no ad-hoc wiring); evidence bridge (baseline + post-observation refs); `measured` events in `CapabilityGovernanceEvent`; outcome signals feed P5.5/P5.6 for the next A7 round.

**Dependencies.** CAP-6, CAP-9.

**Locked decisions incorporated.** #477 (consolidation effectiveness measured), #481 (deprecation outcome measured), design §4.1 (A5 remains outcome authority), #479 (measurement references exact `id@version`).

**Files/modules affected.** `src/evolution/capability-lifecycle/capability-lifecycle-measurer.ts` (reconcile); `src/evolution/observation/observation-evidence-bridge.ts` (baseline + post refs); A5 evidence builders (preserved).

**Migration boundary.** A5 remains the outcome authority; no new security infra.

**Acceptance criteria.**
- A5 measures actual post-application outcomes; measured records carry baseline + post observation refs.
- `measure` service method operational (forward-wired at CAP-8).
- Measurement feeds P5.5/P5.6 signals for subsequent A7 proposals.

**Tests/invariants.** Measurement tests (baseline/post evidence); measurement→signal round-trip.

**Checkpoint/tag.** Measurement suite green.

**What subsequent CAPs may assume.** CAP-11 removes the ad-hoc measurer wiring; CAP-12 e2e proves measure.

---

### CAP-11 — Remove Legacy Capability Surfaces

**Purpose.** Architectural deletion gate: mechanically prevent regression to two capability surfaces.

**Scope.** Remove the inventory's REMOVE set: A7 capability CLI surface (`capability-lifecycle-cli.ts`, `src/cli/commands/capabilities.ts` barrel, `src/cli.ts:2211-2229` block incl. the **second `new CapabilityRegistry()`**); A7 lifecycle machinery (applier, ledger-rehydration `rehydrateLifecycleOverlay`, step-executor, execution-projection, `CapabilityNotExecutableError`, module `index.ts`); `APPROVED_PENDING_APPLICATION` + the A7 `CapabilityProjectionState`; the lifecycle overlay in `src/capability/registry.ts:100-122`; obsolete A7 lifecycle tests. **Install the structural sentinel test** (plan Workstream 13).

**Dependencies.** CAP-8 (replacement surfaces exist), CAP-9, CAP-10.

**Locked decisions incorporated.** #482 (inventory REMOVE list), #475 (no retained `tool` kind), #476 (bindings replace strategy keys).

**Files/modules affected.** `src/cli.ts` capabilities block; `src/evolution/capability-lifecycle/*` (applier, rehydration, step-executor, execution-projection, errors, index, cli); `src/capability/registry.ts` overlay; `lifecycle-contract.ts` (A7 projection state); removed legacy tests.

**Migration boundary.** Stage 9 (retire old surfaces). Removal only after replacement surfaces (CAP-8/9/10) exist.

**Acceptance criteria.** The structural sentinel asserts, mechanically:
```text
one CapabilityRegistry
one canonical definition catalog
one CapabilityService
no legacy capability CLI
no APPROVED_PENDING_APPLICATION
no lifecycle overlay
no second CLI registry construction
no obsolete A7 lifecycle machinery
```

**Tests/invariants.** Structural sentinel (grep/import-graph test rejecting `new CapabilityRegistry()` in CLI handlers, `APPROVED_PENDING_APPLICATION`, overlay methods); full suite green after removal.

**Checkpoint/tag.** Sentinel + full-suite green. No two capability surfaces remain.

**What subsequent CAPs may assume.** CAP-12 e2e runs over clean surfaces; documentation migration completes.

---

### CAP-12 — End-to-End Capability Evolution

**Purpose.** Full integration + migration completion + checkpoint + tag: the Capability Platform milestone.

**Scope.** Critical e2e test; documentation migration (superseded notices on A7/A7.1 design/plan/checkpoint docs; active architecture references point to ADR-0013 + greenfield design); final checkpoint; tag `alix-capability-greenfield-complete`.

**Dependencies.** CAP-1…CAP-11.

**Locked decisions incorporated.** All; §82 final checkpoint condition; plan §20 hard acceptance.

**Files/modules affected.** e2e test suite; `docs/architecture/README.md`; A7 superseded notices; checkpoint doc.

**Migration boundary.** Final. ALiX has a Capability Platform, not a runtime registry plus a governance surface.

**Acceptance criteria.** All 19 plan §20 criteria green (see §8); design §82 checkpoint holds — **runtime, CLI, TUI, web, A7, A4, A5, P5.5/P5.6 all resolve the same canonical capability universe** (see §9).

**Tests/invariants.** Critical e2e: create/register → provider binding → runtime list → CLI list → TUI/Web list → invoke → A7 health signal → propose → A3 approve → A4 apply → registry changes → runtime behavior changes → A5 measure.

**Checkpoint/tag.** `alix-capability-greenfield-complete` (annotated tag + checkpoint doc with canonical-registry ownership, provider abstraction, definition persistence, CLI/TUI/Web parity, governed registration, provider examples, lifecycle/runtime enforcement, test totals, old-A7 migration).

**What subsequent CAPs may assume.** None — terminal increment.

---

## 8. Plan §20 hard-acceptance confirmation

Each plan §20 criterion is satisfied by the named CAP(s):

| # | §20 criterion | Satisfied by |
|---|---------------|--------------|
| 1 | exactly one canonical capability registry per runtime composition | CAP-3, CAP-8, CAP-11 |
| 2 | CLI does not create a second registry | CAP-8, CAP-11 |
| 3 | TUI and Web UI do not maintain duplicate catalogs | CAP-8, CAP-11 |
| 4 | capability identity is provider-independent | CAP-1, CAP-4 |
| 5 | MCP is a provider/integration boundary | CAP-4 |
| 6 | external CLI tools are providers | CAP-4 |
| 7 | `gh` can implement a capability | CAP-4 |
| 8 | GitNexus can implement a capability | CAP-4 |
| 9 | provider fallback works without changing capability identity | CAP-4 |
| 10 | current capability state comes from the registry | CAP-3 |
| 11 | A7 ledger is history/governance, not current capability state | CAP-9 |
| 12 | A7 `register` can be approved and actually applied | CAP-6, CAP-9 |
| 13 | registration applies a complete definition, not a placeholder | CAP-2, CAP-6, CAP-9 |
| 14 | A4 remains the mutation boundary | CAP-6 |
| 15 | A5 measures actual post-application outcomes | CAP-10 |
| 16 | deprecated capabilities are excluded from normal runtime selection | CAP-7 |
| 17 | CLI/runtime catalog parity test is green | CAP-8, CAP-12 |
| 18 | provider failure/capability failure distinction is tested | CAP-4 |
| 19 | documentation no longer presents A7.0/A7.1 split-registry assumptions as active architecture | CAP-11, CAP-12 |

---

## 9. Design §82 final-checkpoint confirmation

| Surface | Resolves the canonical universe at |
|---------|------------------------------------|
| runtime | CAP-3, CAP-7 |
| CLI | CAP-8 |
| TUI | CAP-8 |
| web | CAP-8 |
| A7 | CAP-9 |
| A4 | CAP-6 |
| A5 | CAP-10 |
| P5.5/P5.6 | CAP-9 (consumes signals), CAP-10 (feeds signals) |

The final checkpoint (design §82) is declared only when all eight surfaces above resolve the same canonical capability universe — the CAP-12 gate.

---

## 10. Execution order (single line)

```text
CAP-1 → CAP-2 → CAP-3 → CAP-4 → CAP-5 → CAP-6 → CAP-7 → CAP-8 → CAP-9 → CAP-10 → CAP-11 → CAP-12
```

Contracts first, dependency-correct, order preserved, three boundary redraws (CAP-4 / CAP-5 / CAP-8), CAP-11 as the architectural deletion gate.
