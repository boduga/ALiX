# R5 — Support Subsystem Convergence Plan

**Status:** in progress — R5.0 (plan) ✅, R5.1 (egress redaction) ✅, R5.2 (`models.*` cutover) ✅, R5.3a (tool catalogue taxonomy) ✅.
**Phase register:** `docs/refactors/r0-findings-r3-plan.md` (R5 row + "R5 security note (do not lose)").
**Provenance:** four read-only recon passes against HEAD `r4-complete` (`e9008d88`). Line numbers verified in that session.

## Contract (from the phase register)

> R5 — Support subsystems: finish `models.*` cutover (3 resolvers → 1, kill flat reads); ONE
> tool/capability catalogue + MCP/manifest adapters; **outbound redaction gate before any
> remote-provider call = security correction, not cleanup**; one metric vocabulary (Node-native
> collectors; psutil refs in the metrics doc are catalogue-only, Python).

## Verified current state (recon)

### A. `models.*` cutover

| Item | Current location | State | Allowlist |
|---|---|---|---|
| Canonical reader | `src/config/model-resolver.ts:16,50` (`tryResolveModelConfig`/`resolveModelConfig`) | Reads only canonical `models`; `models.default` fallback; invalid present tier shadows default; throws `NO_MODEL_CONFIGURED_MESSAGE` | `model-resolver-impls` entry lines 191-197, `R5` |
| Policy→id resolver | `src/providers/model-resolver.ts:164,284,351` (`selectModelFromDiscovery`/`resolveModelSelectionId`/`resolveConcreteFreeModel`) | Discovery/eligibility/ranking; no external `selectModelFromDiscovery` caller | entry lines 198-204, `R5` |
| Tier resolver | `src/decision/decisions/model-tier/resolution.ts:21` (`resolveTierModel`) | Fail-closed `assertEnabledTier` then `resolveModelConfig`; no external `src` caller | entry lines 205-211, `R5` |
| Port | `src/contracts/model-resolver.ts:12` (`ModelResolver.resolve/require`) | Exists, **zero consumers** | — |
| Canonical contract | `src/config/schema.ts:100-163,197-198,237-247` (`ModelConfig`/`ModelsConfig`/`isValidModelConfig`) | Authority doc comment lines 518-529: persisted truth = `models`/`modelProfile`/`apiKeys`; `model`/`subagents` are runtime projections | — |
| Flat read | `src/config/hardware-detect.ts:85-90` | Reads raw `config.model` + `config.models` cast to `Record` | — |
| Flat read | `src/providers/registry.ts:78` | `config.name ?? config.model` before `selection` overlay | — |
| Flat reads | `src/agent/agent.ts:152`; `src/runtime/runtime-builder.ts:79`; `src/daemon/daemon-server.ts:74`; `src/kernel/coordination-tools.ts:273`; `src/server/coordination-routes.ts:411` | `subagents.enabled` projection branches | — |
| Post-load mutation | `src/agent/agent.ts:86-87` | Mutates `config.models.default.streaming = false` after `loadConfig` | — |
| Projection writes | `src/config/loader.ts:40-75,295-296,305-306,315`; `src/config/persistence.ts:49-90` | `normalizeModelConfig` / `withoutDerivedModelProjections` (authorized) | — |

Tests: `tests/config/model-resolver.test.ts`, `tests/providers/model-resolver.vitest.ts`,
`tests/providers/free-model-resolver.vitest.ts`, `tests/config/model-selection-policy.vitest.ts`,
`tests/decision/model-tier.test.ts`, `tests/config/model-invariant.test.ts`.

### B. ONE tool/capability catalogue

| Surface | Current location | State | Allowlist |
|---|---|---|---|
| Executable tool metadata | `src/tools/tool-registry.ts:29,62,108,145` (`ToolCapability`/`ToolRegistry`/`CapabilityIndex`/`buildDefaultToolIndex`) | Hardcoded 24-entry `defaults`; other modules derive from it | `tool-taxonomy-defs` entry lines 675-679, `R5` |
| Capability palette | `src/capability/registry.ts:62` (`CapabilityRegistry`) | Injected `CapabilityCatalog`; constructed once at `src/capability/platform.ts:106`; tool caps projected via `src/capability/registry-capabilities.ts:26-97` (`tool.<name>` vs `filesystem.read` id split) | entry lines 647-651, `R5` |
| Card registry | `src/registry/card-registry.ts:13` (`CardRegistry`) | `.alix/cards/*.json`; `defaultToolCards()` derives from `buildDefaultToolIndex()` (`card-loader.ts:132`) | entry lines 668-672, `R5` |
| MCP registry | `src/mcp/registry.ts:21` (`McpToolRegistry`) | Live `client.listTools()`; `fullName = server/tool`; opaque handle `mcp__<hash>` (`tool-deferral.ts:119`) | entry lines 661-665, `R5` |
| Manifest | `src/agents/tool-manifest.ts:2,55,70` (`ALIX_BUILTIN_EXECUTORS`/reverse map/`isCompletionToolName`) | Hand-maintained `alix_*`→executor map | entry lines 640-644, `R5` |
| Name-collision | `src/kernel/collaborative-planner.ts:82` (local `interface CapabilityRegistry`, an agentId map) | Not in the rule's `files` list; flagged by symbol collision | entry lines 654-658, `R5` |
| Port | `src/contracts/tool-capability-registry.ts:8,16` (`ToolCapabilityEntry`/`ToolCapabilityRegistry`) | Exists, **no impl/adapter** | — |
| Bridge | `src/tools/capability-map.ts:58-76` (`mcp.`→`mcp.invoke`); `tool-registry.ts:436-445` (`mcp.*` wildcard) | Only link between MCP and tool registry; concrete MCP tools never enter `ToolRegistry` | — |

Also `R5`: 8 `direct-tool-dispatch` entries (value imports of `src/tools/executor.ts`) —
`src/cli/commands/tui.ts`, `src/kernel/default-worker-review.ts`, `src/run/event-handlers.ts`,
`src/run/task-loop/main.ts`, `src/runtime/continuation-manager.ts`, `src/runtime/replay-plan.ts`,
`src/runtime/route-execution.ts`, `src/runtime/runtime-builder.ts`. These are tool-dispatch boundary
violations in R5 scope (route through a tool port).

### C. Outbound redaction gate (SECURITY — do first)

| Item | Current location | State |
|---|---|---|
| Send seams | `src/runtime/route-execution.ts:128-133,323-329,415-424`; `src/run/task-loop/main.ts:770-778,801-807`; `src/kernel/planner-model.ts:40-44`; `src/agents/subagent-cli.ts:723-727` | Provider-bound `systemPrompt`/`messages` sent raw |
| Prompt assembly (memory+repomap) | `src/agent/agent-loop.ts:410-463,521`; `src/agent/session/setup.ts:656-717`; `src/run/task-loop/context-phase.ts:42-61`; `src/run/task-loop/execution-state-phase.ts:148-187` | Memory (`utils/memory/recall.ts:143`) + repomap (`repomap/context-compiler.ts:37`, `agent/messages.ts:54`) embedded |
| Tracing redaction | `src/tracing/capture.ts:156,254,280,386` (`redactString`/`captureString`/`captureMessages`) | Applied only to the captured span copy (`langfuse-client.ts:515-532`); provider request stays raw (`provider-contract-validation.ts:113-119`) |
| Reusable redactor | `src/security/redaction/redactor.ts:184` (`redactValue`), `redaction-policy.ts:84`, `secret-detector.ts:170` | Wired only into Inspector server sinks; no provider importer |
| Port | `src/contracts/context-compiler.ts:1-22` (`OutboundContext.redacted`, `ContextCompiler`) | Exists, **no impl** |
| Remote/local predicate | `src/providers/keyless-providers.ts:16` (`isKeylessProvider`) | No explicit remote/local classification |

Tests: `tests/tracing/capture.vitest.ts`, `tests/security/redaction/*` — **no test asserts redaction
on a provider-bound prompt**.

### D. One metric vocabulary

| Vocabulary | Current location | State | Allowlist |
|---|---|---|---|
| Kernel counters | `src/kernel/minimal-metrics.ts:65` (`MinimalMetrics`, 25-name `MetricName`) | Emits `observability.metric` rows to EventLog via `agent/session/turn.ts:688-693` | entry lines 163-169, `R5` |
| Observability registry | `src/observability/metric-registry.ts:36,666` (`MetricRegistry`/`createMetricRegistry`) | `PRODUCTION_METRIC_DEFINITIONS` re-lists the same 25 names with a different type system; only consumer builds `StateTelemetry` (`run/task-loop/main.ts:500`) | entry lines 170-176, `R5` |
| Tracing spans | `src/tracing/client-factory.ts:127,147` (`createTraceClient`/`getProcessTraceClient`) | Span vocabulary, not metric observation | entry lines 177-183, `R5` |
| TUI daemon snapshot | `src/tui/daemon-metrics-collector.ts:12,98` (`DaemonMetricsSnapshot`/`DaemonMetricsCollectorImpl`) | CPU/RAM/disk snapshot struct; second `DaemonMetricsCollector` interface in `snapshot-builder.ts:13` | entry lines 184-190, `R5` |
| Port | `src/contracts/metrics-sink.ts:7,14` (`MetricObservation`/`MetricsSink.observe`) | Exists, **no impl** | — |
| Duplication | `MetricsLike` in `kernel/collaboration-{conflict-detector,context-builder,conflict-repository}.ts:83,173,48` | Three identical structural mirrors of `MinimalMetrics` | — |

All system collectors are Node-native (`/proc`, `os`, `fs.statfs`, `process.memoryUsage`); no
Python/psutil runtime path exists (`psutil` is doc-only). The daemon path hardcodes `cpuPercent: 0`
(`daemon-metrics-collector.ts:178`).

## Sub-steps

| Step | Scope | Status |
|---|---|---|
| R5.0 | Persist this recon/plan | ✅ |
| R5.1 | **Outbound redaction gate:** remote/local provider predicate + shared redactor applied to every provider-bound `systemPrompt`/`messages` before send; fail-closed for remote. Owner seams: `route-execution.ts`, `run/task-loop/main.ts`, `planner-model.ts`, `subagent-cli.ts` (and siblings). Tests assert a secret in assembled prompt never reaches a remote adapter. | ✅ |
| R5.2 | **`models.*` cutover:** route all reads through the `ModelResolver` port / one resolver; kill flat reads (`hardware-detect.ts`, `providers/registry.ts`, `subagents.enabled` branches) and the post-load `agent.ts` mutation; remove the 3 `model-resolver-impls` allowlist entries. | ✅ |
| R5.3a | **ONE tool/capability catalogue (taxonomy):** wire the `ToolCapabilityRegistry` port over the canonical catalogue; scope the freeze rule (exempt each definition's home module); rename the collaborative-planner's colliding `CapabilityRegistry` interface; remove the 6 `tool-taxonomy-defs` entries. | ✅ |
| R5.3b | **Tool dispatch:** move `hashArgs` out of `executor.ts` and route `ToolExecutor` construction through a sanctioned seam; remove the 8 `direct-tool-dispatch` entries. Agent-execution path — separate sub-step. | ⬜ |
| R5.4 | **One metric vocabulary:** implement the `MetricsSink` port; reconcile `MinimalMetrics`/`MetricRegistry`/tracing/TUI; only then remove the 4 `metrics-vocabs` entries. | ⬜ |
| R5.5 | Resolve/reclassify the 4 `status-store-writes` `R5` entries (`src/cli/commands/adaptation/main.ts`, `executive-evaluate-handler.ts`, `executive-orchestrate-handler.ts`, `executive.ts` → `src/executive/execution-state-store.ts`) — decide whether they belong to R5 or move to R6. | ⬜ |
| R5.6 | DOX (`src/config`, `src/providers`, `src/tools`, `src/capability`, `src/security`, `src/observability` + ports) + full gates + `check:dox --base origin/main` + `detect_changes` + tag `r5-*`. | ⬜ |

### Order / rationale

The register lists models → tools → redaction → metrics, but the register's own security note calls
the redaction gate "a security correction, not cleanup" and a vulnerability class. **Do R5.1 first.**

## Notes / risks

- All four R1 ports (`ModelResolver`, `ToolCapabilityRegistry`, `MetricsSink`, `ContextCompiler`) exist
  but are **unwired**; wiring one is the concrete unification move for each area. The freeze test only
  checks the port files exist.
- The freeze suite is shrink-only: each allowlist entry removal must land with the offending import
  removal in the same commit.
- `direct-tool-dispatch` and `status-store-writes` `R5` entries are additional scope beyond the four
  register bullets; confirm classification before touching.
- Presentation/authority boundary: R5 changes runtime behavior (redaction, dispatch, metrics), unlike
  the presentation-only R4.

## R5.1 (egress redaction) — ✅ done
Central gate: `withProviderContracts` (the wrapper every `createProvider` adapter passes through) redacts secrets from `systemPrompt`, message text content, and tool-result content before the physical provider call.
1. Added `src/security/redaction/redactor.ts:redactText` — span-in-place redaction that preserves the full surrounding prompt (the existing `redactString` truncates to a preview, which would destroy a large system prompt); `redactString` now delegates to it.
2. Added `src/providers/provider-locality.ts` (`isLocalProvider`/`isRemoteProvider`, fail-closed: unknown = remote) and `src/providers/outbound-redaction.ts` (`redactOutboundRequest`/`redactOutboundText`, strict `public` profile).
3. Wired the gate into `withProviderContracts.complete`/`stream`; local providers (keyless + eval mock) pass through unredacted.
4. Tests: `tests/providers/outbound-redaction.vitest.ts` (locality, request redaction, remote-vs-local through the wrapper for complete + stream) and `redactText` cases in `tests/security/redaction/redactor.test.ts`.
5. DOX: added the outbound-redaction contract to `src/providers/AGENTS.md`.

## R5.2 (`models.*` cutover) — ✅ done
The freeze rule `model-resolver-impls` watched six exported symbol names across all of `src` (its `files` field was dead), so entries could only be removed by eliminating those names.
1. `src/config/model-resolver.ts` now exports the single canonical `createModelResolver(config): ModelResolver` factory (port methods `resolve`/`require`); the old `resolveModelConfig`/`tryResolveModelConfig` free functions are gone. ~20 call sites migrated.
2. `src/decision/decisions/model-tier/resolution.ts` deleted; the fail-closed helpers (`resolveEnabledTierModel`/`describeCurrentRouting`/`tierMatchesCurrentRouting`) moved into `tiers.ts`. `src/providers/model-resolver.ts` symbols renamed to discovery-flavored names (`selectDiscoveredModel`/`resolveSelectionModelId`/`resolveConcreteFreeSelection`).
3. Flat reads killed: `config/hardware-detect.ts` reads canonical `models.*` only; the post-load `agent.ts` mutation of `models.default.streaming` is replaced by a local non-mutating override.
4. Freeze rule: `DEF_RULES` gained an `exempt` list; `model-resolver-impls` now watches `createModelResolver` everywhere except `src/config/model-resolver.ts`, so a second resolver definition fails the freeze. Removed the 3 `model-resolver-impls` allowlist entries.
5. Tests updated (`tests/config/model-resolver.test.ts`, `tests/decision/model-tier.test.ts`, `tests/config/hardware-detect.test.ts`, provider tests); DOX updated (`src/providers/AGENTS.md`, `src/decision/decisions/model-tier/AGENTS.md`).
6. Deferred (documented): `providers/registry.ts`'s `config.name ?? config.model` is registry input normalization, not a canonical-`models` read; the `subagents.enabled` projection branches are loader-produced compatibility reads (a caller-facing migration, not a flat source-of-truth read) — left for a follow-up.

## R5.3a (tool catalogue taxonomy) — ✅ done
Same freeze-rule shape as R5.2: `tool-taxonomy-defs` watched five symbol names across all of `src` (its `files` field is dead), so the entries could only go by scoping the rule.
1. `src/tools/tool-registry.ts` now implements the R1 `ToolCapabilityRegistry` port via `createToolCapabilityRegistry()` (`resolve`/`list` over the 24-entry catalogue) — the one tool/capability resolution surface.
2. Renamed the collaborative-planner's colliding local `CapabilityRegistry` interface to `AgentCapabilityMap` (the only genuine name collision; updated `replan-impact-analyzer.ts` + a test).
3. Freeze rule `tool-taxonomy-defs`: added the port symbol; every watched definition is now allowed only in its home module via `exempt` (rule-level file list). Removed the 6 `tool-taxonomy-defs` entries.
4. Added `tests/tools/tool-capability-registry.vitest.ts` (port resolve/list shape) and DOX in `src/tools/AGENTS.md`.
5. Deferred to **R5.3b**: the 8 `direct-tool-dispatch` entries (moving `hashArgs` out of `executor.ts`; routing `ToolExecutor` construction through a sanctioned seam) — an agent-execution-path change.

## Resume here (fresh session)

1. Read this file, root `AGENTS.md`, and the owning child AGENTS.md for the target area.
2. `git log --oneline origin/main..HEAD` to re-anchor; run GitNexus `impact` before symbol edits and
   `detect_changes` before every commit.
3. Start at the first ⬜ sub-step (R5.1).
