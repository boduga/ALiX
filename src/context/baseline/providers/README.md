# Baseline Providers

## Overview
Nine `BaselineProvider` sensors that capture subsystem health metrics for the baseline/drift framework. Providers only observe and return `BaselineArtifact` data; comparison, scoring, and recommendations are owned outside this directory. Persistent providers read `.alix/**` JSON state; runtime health providers dynamically import Executive health adapters; `DemoBaselineProvider` is a pure in-memory fixture.

## Interface
- Every class implements `BaselineProvider` with `subsystem`, `version`, `description`, `state`, `capabilities`, `captureBaseline()`, and `captureCurrent()` `[adaptation-provider.ts:AdaptationBaselineProvider]` `[governance-provider.ts:GovernanceBaselineProvider]` `[security-provider.ts:SecurityBaselineProvider]` `[skills-provider.ts:SkillsBaselineProvider]` `[agent-runtime-health-provider.ts:AgentRuntimeHealthProvider]` `[memory-health-provider.ts:MemoryHealthProvider]` `[tools-health-provider.ts:ToolsRuntimeHealthProvider]` `[workflow-runtime-health-provider.ts:WorkflowRuntimeHealthProvider]` `[demo-provider.ts:DemoBaselineProvider]`.
- `AdaptationBaselineProvider` — proposal counts by status from `.alix/adaptation/proposals/*.json` `[adaptation-provider.ts:capture]`.
- `GovernanceBaselineProvider` — calibration, lens-registry, and policy-coverage metrics `[governance-provider.ts:capture]`.
- `SecurityBaselineProvider` — policy count, evidence-chain integrity, and credential-file count `[security-provider.ts:capture]` `[security-provider.ts:POLICIES_DIR]` `[security-provider.ts:EVIDENCE_DIR]` `[security-provider.ts:CREDENTIALS_DIR]`.
- `SkillsBaselineProvider` — skill count, invalid skills, total and average steps from `.alix/skills/workflow` `[skills-provider.ts:capture]` `[skills-provider.ts:SKILLS_DIR]`.
- `AgentRuntimeHealthProvider`, `MemoryHealthProvider`, `WorkflowRuntimeHealthProvider` — `healthScore`/`issueCount` from Executive `buildAgentHealth`, `buildMemoryHealth`, and `buildWorkflowHealth` adapters `[agent-runtime-health-provider.ts:capture]` `[memory-health-provider.ts:capture]` `[workflow-runtime-health-provider.ts:capture]`.
- `ToolsRuntimeHealthProvider` — registered tool count from `buildDefaultToolIndex()` `[tools-health-provider.ts:capture]`.
- `MemoryHealthProvider.classifyDrift(metric, delta)` — maps `healthScore` to `performance`, `issueCount` to `behavior`, defaulting to `performance` `[memory-health-provider.ts:classifyDrift]`.
- `DemoBaselineProvider` — fixed baseline `{uptime:100, responseTime:200, errorRate:0}` and degraded current `{uptime:95, responseTime:350, errorRate:2}` `[demo-provider.ts:BASELINE_DATA]` `[demo-provider.ts:CURRENT_DATA]`.

## Invariants
- `captureBaseline()` memoizes the first artifact in `baselineCache`; `captureCurrent()` always re-captures `[adaptation-provider.ts:captureBaseline]` `[governance-provider.ts:captureCurrent]` `[security-provider.ts:captureCurrent]`.
- Missing directories, unreadable files, and malformed JSON degrade to zero metrics rather than throwing `[adaptation-provider.ts:capture]` `[governance-provider.ts:capture]` `[skills-provider.ts:capture]` `[security-provider.ts:capture]`.
- Adaptation proposals with an unrecognized status are not counted in `proposalCount` `[adaptation-provider.ts:capture]`.
- Evidence `chainIntegrityOk` is `0` when any record is unparseable, `1` for zero or one valid record, and otherwise requires each record's `previousFingerprint` to equal the prior record's `fingerprint` `[security-provider.ts:capture]`.
- Every provider declares `capabilities: ["capture"]` and `state: "ready"` `[governance-provider.ts:GovernanceBaselineProvider]` `[demo-provider.ts:DemoBaselineProvider]`.
- Adapter failures in runtime health providers are swallowed and reported as `{healthScore: 0, issueCount: 0}` `[agent-runtime-health-provider.ts:capture]` `[memory-health-provider.ts:capture]` `[workflow-runtime-health-provider.ts:capture]`.
- `ToolsRuntimeHealthProvider` currently reports `healthyTools === registeredTools`, `failedTools: 0`, and `averageLatency: 0` because instrumentation is reserved `[tools-health-provider.ts:capture]`.

## Side Effects
- Reads `.alix/adaptation/proposals`, `.alix/governance`, `.alix/policies`, `.alix/security/evidence.jsonl`, `.alix/credentials`, and `.alix/skills/workflow` relative to `process.cwd()` `[adaptation-provider.ts:PROPOSALS_DIR]` `[governance-provider.ts:GOV_DIR]` `[security-provider.ts:capture]` `[skills-provider.ts:capture]`.
- Dynamically imports Executive adapters and the default tool registry at capture time `[agent-runtime-health-provider.ts:capture]` `[tools-health-provider.ts:capture]`.
- Performs no writes, network calls, or locks.
- `DemoBaselineProvider` performs no I/O `[demo-provider.ts:DemoBaselineProvider]`.

## Verification
- Run: `pnpm test`
