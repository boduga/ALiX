# Executive Health Adapters

## Overview

Tier-2, read-only health adapters used by the executive aggregator. Each
builder derives a 0-100 subsystem score plus a short summary and issue list
from on-disk `.alix/**` state or the latest adaptation report; none of them
executes agent work. All builders are defensive: any thrown error degrades to
`score: 0` with an explicit failure summary so aggregation can continue.

## Interface

- `buildAdaptationHealth(opts: AdaptationHealthOptions)` → `AdaptationHealthReport`; reads `CapabilityEvolutionStore` at `<cwd>/.alix/capability-evolution` and scores the active+mature lifecycle share minus drift penalties (`adaptation-health.ts:buildAdaptationHealth`).
- `buildAgentHealth(opts: AgentHealthOptions)` → `AgentHealthReport`; 60% adoption coverage + 40% average keep rate from `report.healthAnalysis` (`agent-health.ts:buildAgentHealth`).
- `buildMemoryHealth(opts: MemoryHealthOptions)` → `MemoryHealthReport`; inspects `<cwd>/.alix/memory` (`memory-health.ts:buildMemoryHealth`).
- `buildSecurityHealth(opts: SecurityHealthOptions)` → `SecurityHealthReport`; inspects `<cwd>/.alix/credentials` (`security-health.ts:buildSecurityHealth`).
- `buildToolHealth(opts: ToolHealthOptions)` → `ToolHealthReport`; scans `.alix/{proposals,recommendations,outcomes,evidence}` with `SecretDetector` (`tool-health.ts:buildToolHealth`).
- `buildWorkflowHealth(opts: WorkflowHealthOptions)` → `WorkflowHealthReport`; maps `PipelineHealthBuilder` status through `STATUS_SCORE` and refines by confidence (`workflow-health.ts:buildWorkflowHealth`).
- Shared option shape: `cwd` (required) plus optional `windowDays` / `generatedAt` (`adaptation-health.ts:AdaptationHealthOptions`, `workflow-health.ts:WorkflowHealthOptions`).
- `AdaptationHealthReport` / `AgentHealthReport` / `MemoryHealthReport` / `SecurityHealthReport` / `ToolHealthReport` / `WorkflowHealthReport` — all expose `score`, `summary`, `topIssues` (`adaptation-health.ts:AdaptationHealthReport`, `tool-health.ts:ToolHealthReport`).

## Invariants

- Every builder clamps its score to an integer in `[0, 100]` through a local `clampScore`; non-finite input becomes 0 (`adaptation-health.ts:clampScore`, `workflow-health.ts:clampScore`).
- Absence of a store is healthy rather than missing data: no adaptation report, no memory store, and no credentials store all return `score: 100` (`adaptation-health.ts:buildAdaptationHealth`, `memory-health.ts:buildMemoryHealth`, `security-health.ts:buildSecurityHealth`).
- A thrown read/parse failure returns `score: 0` with a `"<name> health builder failed"` summary rather than propagating (`adaptation-health.ts:buildAdaptationHealth`, `tool-health.ts:buildToolHealth`).
- Adaptation score penalizes 5 points per split candidate and 2 per gap, capped at 40 (`adaptation-health.ts:buildAdaptationHealth`).
- Agent coverage treats a missing keep rate as `1` when no finite keeps exist, and reports issues below 0.5 coverage or 0.6 keep (`agent-health.ts:buildAgentHealth`).
- Tool health penalizes 10 points per high-confidence secret span, capped at 100, and skips unreadable files instead of failing the scan (`tool-health.ts:buildToolHealth`).
- Workflow refinement is `base * (0.7 + 0.3 * confidence)` with confidence clamped to `[0, 1]` (`workflow-health.ts:buildWorkflowHealth`).

## Side Effects

- All builders are read-only: `existsSync`/`readdirSync`/`readFileSync` against `<cwd>/.alix/**`, plus `CapabilityEvolutionStore.loadLatest()` (`adaptation-health.ts:buildAdaptationHealth`, `tool-health.ts:buildToolHealth`, `memory-health.ts:buildMemoryHealth`, `security-health.ts:buildSecurityHealth`).
- `buildToolHealth` instantiates `SecretDetector` and reads at most `MAX_FILES = 50` files per directory, each truncated to `MAX_FILE_BYTES = 65536` (`tool-health.ts:SCAN_DIRS`, `tool-health.ts:MAX_FILES`, `tool-health.ts:MAX_FILE_BYTES`).
- No network calls, no writes, and no process spawning occur in these adapters (`workflow-health.ts:buildWorkflowHealth`).

## Verification

- Run: `pnpm test`
