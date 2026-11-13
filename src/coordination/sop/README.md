# Standard Operating Procedures (SOP) Pack

## Overview

Built-in, deterministic workflow packs that each build a `TaskGraph` for a fixed procedure. An SOP defines node structure only — it does not ask a model to plan the graph. Two packs ship here: the six-node deep research report and the single-node Docker Compose audit. A shared registry exposes them to the CLI and TUI, and an artifact writer persists research outputs under `.alix/reports/<reportId>/`.

## Interface

- `SopManifest` — optional author, version, tags, node count, and required capabilities [sop-registry.ts:SopManifest]
- `SopDefinition` — `id`, `name`, `description`, optional manifest, and `buildGraph(input)` returning `{ graph, reportDir }` [sop-registry.ts:SopDefinition]
- `registerSop(def)` / `getSop(id)` / `listSops()` — module-level registry accessors [sop-registry.ts:registerSop] [sop-registry.ts:getSop] [sop-registry.ts:listSops]
- `buildResearchDeepReportGraph(topic, reportId)` — builds the six-node research graph and returns `{ graph, reportDir, reportId }` [research-deep-report.ts:buildResearchDeepReportGraph]
- `getResearchDeepReportDef()` — `research.deep_report` SOP definition [research-deep-report.ts:getResearchDeepReportDef]
- `getInfraDockerComposeAuditDef()` — `infra.docker_compose_audit` SOP definition [infra-docker-compose-audit.ts:getInfraDockerComposeAuditDef]
- `ReportArtifacts` — `finalReport`, `sources`, `claims`, `criticReview` payloads [artifact-writer.ts:ReportArtifacts]
- `WriteReportOpts` — `cwd`, `reportId`, `artifacts`, `graphId`, `sopId`, `topic`, optional `nodeResults` [artifact-writer.ts:WriteReportOpts]
- `writeReportArtifacts(opts)` — writes the report directory and returns its path [artifact-writer.ts:writeReportArtifacts]

## Invariants

- SOPs are deterministic: they define node structure, not model planning [sop-registry.ts]
- The registry is a `Map` keyed by `SopDefinition.id`; `registerSop` is last-write-wins for a duplicate id [sop-registry.ts:registerSop]
- Both built-in SOPs are registered as a side effect of importing the registry module [sop-registry.ts]
- The research graph is a fixed six-node `requires` chain: `scope_topic → search_sources → extract_claims → synthesize → critic_review → write_artifacts` [research-deep-report.ts:buildResearchDeepReportGraph]
- Research nodes run with `executionProfile: "research"`, `riskLevel: "low"`, and `approvalMode: "auto"` [research-deep-report.ts:makeNode]
- Research capabilities widen by stage: scope/search/extract declare `web.search`, synthesize and critic declare none, and only `write_artifacts` declares `filesystem.write` [research-deep-report.ts:buildResearchDeepReportGraph]
- Research prompts confine each stage to its own inputs: search and extract may not read local files; synthesize and critic may not access the web or local files; the writer may only write under `.alix/reports/` [research-deep-report.ts:buildResearchDeepReportGraph]
- Research graph status starts `draft`; the Docker Compose graph starts `ready` with a single node and no edges [research-deep-report.ts:buildResearchDeepReportGraph] [infra-docker-compose-audit.ts:getInfraDockerComposeAuditDef]
- Each SOP's declared `manifest.nodeCount` matches the graph it builds (6 and 1) [research-deep-report.ts:getResearchDeepReportDef] [infra-docker-compose-audit.ts:getInfraDockerComposeAuditDef]
- Research `reportDir` is exactly `.alix/reports/<reportId>`; the audit SOP uses `report_<timestamp>` [research-deep-report.ts:buildResearchDeepReportGraph] [infra-docker-compose-audit.ts:getInfraDockerComposeAuditDef]
- The artifact writer always stamps `status: "completed"` and emits a fixed artifact filename set [artifact-writer.ts:writeReportArtifacts]

## Side Effects

- Importing the registry registers both built-in SOPs into the process-local `Map` [sop-registry.ts]
- `buildGraph` allocates fresh graph and workflow ids with `randomUUID()` and timestamps with `new Date().toISOString()` [research-deep-report.ts:buildResearchDeepReportGraph] [infra-docker-compose-audit.ts:getInfraDockerComposeAuditDef]
- `writeReportArtifacts` creates `.alix/reports/<reportId>/` recursively and writes `final_report.md`, `sources.json`, `claims.json`, `critic_review.md`, and `run_manifest.json` [artifact-writer.ts:writeReportArtifacts]
- `writeReportArtifacts` overwrites existing files at those paths and is the only disk-writing function in this directory [artifact-writer.ts:writeReportArtifacts]
- No network calls and no locks are issued from this directory [artifact-writer.ts:writeReportArtifacts]

## Verification

- Run: `pnpm test`
