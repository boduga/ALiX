# P4 — ALiX Productionization, Observability, and Adoption

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Status:** Proposed next-phase roadmap
> **Builds on:** Completed P0–P3 roadmap, M0.77 coordination kernel, M0.78 shared context/conflict/replanning stack
> **Primary objective:** Turn ALiX from a feature-complete engineering platform into a production-ready, observable, supportable, and adoptable product.

**Goal:** Productionization, observability, and adoption — making ALiX installable, observable, recoverable, measurable, debuggable, supportable, documented, benchmarkable, adoptable, and extractable.

**Architecture:** Six independent tracks (P4.0–P4.5) executed in dependency order. No new orchestration subsystems. Focus on hardening, monitoring, UX depth, adoption tooling, and kernel extraction readiness.

**Tech Stack:** TypeScript, Node `node:test`, `better-sqlite3`, existing event/audit/metrics infrastructure, vanilla JS Inspector UI

## Global Constraints

- All new tests use `node:test` + `node:assert/strict` — no vitest, no chai
- Stateful tests use `mkdtempSync` + `rmSync`
- No framework migration for the Inspector UI (keep vanilla JS)
- No premature package extraction — mark boundaries, don't split packages
- All imports use `.js` extensions (NodeNext)
- No run/worker IDs as metric labels (cardinality control)
- Metrics vocabulary is closed — registry validation
- Recovery tools are read-only by default, dry-run first, explicit before mutation

---

## Recommended Milestone Sequence

```
P4.0 Architecture consolidation → certify
P4.1 Hardening (skipped tests → crash → concurrency → soak → fault injection → recovery → cross-platform)
P4.2 Monitoring (metrics contract → system/agent/provider/tool metrics → SQLite → health → alerts → API → CLI → trends)
P4.3 UX depth (timeline → agent cards → replan viewer → approval inbox → replay → diff → responsive TUI → error UX)
P4.4 Adoption (reference apps → quickstart → support bundle → documentation)
P4.5 Kernel extraction readiness (dependency audit → ports/adapters → public API → boundary linting → consumer tests → extraction gate)
```

### P4.0 — Release Consolidation

**Goal:** Create one authoritative baseline release representing the completed ALiX roadmap.

**Files:**
- Create: `docs/architecture/{system-overview,coordination-kernel,collaboration-system,approval-and-policy,replanning,observability}.md`
- Create: `docs/support-matrix.md`
- Create: `docs/migrations/`, `docs/compatibility.md`
- Create: `src/cli/commands/certify.ts`
- Update: `README.md`, `CHANGELOG.md`, `package.json`

- [ ] **P4.0a: Architecture docs** — 6 documents covering responsibilities, interfaces, durable state, event flow, failure/recovery behavior, security boundaries, extension points
- [ ] **P4.0b: Platform matrix** — Node versions, OS support, filesystem requirements, shell/terminal requirements, provider support
- [ ] **P4.0c: Schema versioning** — config, coordination, approval, collaboration, aggregate, proposal record versions with migration tests
- [ ] **P4.0d: Release metadata** — README, CHANGELOG, npm package validation, GitHub release template
- [ ] **P4.0e: `alix certify`** — validates config, provider, model profile, policy, stores, daemon, TUI, Inspector, package integrity. Supports `--json`, `--quick`, `--full`, `--output report.json`

---

### P4.1 — Production Hardening

**Goal:** Prove ALiX remains correct under crashes, concurrency, provider failures, corrupt state, and long-running use.

**Files:**
- Create: `docs/testing/skipped-tests.md`
- Create: `tests/recovery/`
- Create: `src/testing/concurrency-harness.ts`, `tests/stress/`
- Create: `src/testing/fault-injection/`
- Create: `src/recovery/`
- Modify: CI matrix for cross-platform (Linux/macOS/Windows)

- [ ] **P4.1a: Skipped-test elimination** — inventory every skipped test, classify (platform/external/flaky/obsolete/unsupported/disabled), remove obsolete skips, replace external deps with fakes, gate platform tests correctly, add CI skip-count reporting, fail on unapproved new skips. Target: 0 unexplained skipped.
- [ ] **P4.1b: Crash recovery matrix** — test interruption at every stage (planning → authorization → approval → ownership → execution → result → aggregate → replan → CAS). Fixtures simulate process kill, daemon restart, partial temp files, stale locks, expired leases, orphaned workers. Invariants: no duplicate dispatch, no duplicate approval consumption, no lost result, no partial plan revision, no lease leak, no stale proposal application.
- [ ] **P4.1c: Concurrency stress harness** — `requestOrReusePending`, approval consumption, CAS revisions, ownership acquisition, result persistence, aggregate finalization, findings, conflicts, replan proposals. Config: 10/50/100/500 concurrent operations. Deterministic seed support. `npm run test:stress -- --seed 12345`.
- [ ] **P4.1d: Provider/tool fault injection** — timeouts, 429, 500, connection reset, malformed JSON, partial streaming, cancellation, tool crash, filesystem failure, disk-full simulation. Validate retry policy, circuit breaker, audit trail, no corrupted durable state.
- [ ] **P4.1e: Daemon soak testing** — `npm run test:soak` with 1h/8h/24h/72h profiles. Measure RSS, heap, file descriptors, open handles, timers, watchers, DB growth, event-log growth, CPU idle. Fail when thresholds exceeded.
- [ ] **P4.1f: Recovery commands** — `alix recover inspect`, `alix recover locks`, `alix recover coordination <run-id>`, `alix recover approvals`, `alix recover collaboration`, `alix recover aggregates`. Read-only by default, dry-run first, audited.
- [ ] **P4.1g: Cross-platform certification** — CI matrix on Ubuntu, macOS, Windows, Node LTS + current. Verify path containment, atomic rename, signal handling, TTY/PTY, shell execution, lock-file ownership, line endings, Unicode paths.

---

### P4.2 — Monitoring and Operations

**Goal:** Implement production monitoring with unified metrics, health checks, alerts, trends, and CLI/API/SSE access.

**Files:**
- Create: `src/monitoring/{metric-types,metric-registry,metric-sink,metrics-store,system-monitor,health-checker,alert-manager}.ts`
- Create: `src/cli/commands/monitoring.ts` (or enhance existing)
- Modify: `src/server/server.ts` (monitoring API routes)
- Create: `tests/monitoring/`

- [ ] **P4.2a: Unified metrics contract** — closed-vocabulary `MetricsSink` with `increment()`, `gauge()`, `observe()`. No run/worker ID labels. Unit-encoded, described.
- [ ] **P4.2b: System resource monitor** — CPU, load, memory, swap, disk, process RSS/heap/CPU, uptime, file descriptors, event-loop delay. Platform adapters (Linux/macOS/Windows). 5s default interval.
- [ ] **P4.2c: Agent/coordination metrics** — workers pending/running/completed/failed, execution duration, run duration, queue depth, approval wait, ownership conflicts, lease age, retry/replan/conflict counts. p50/p95/p99 histograms.
- [ ] **P4.2d: Provider/model metrics** — requests, success/failure, latency, TTFT, tokens, cost, retry/fallback counts, circuit-breaker state, rate-limit responses, context-window utilization, cache hits. Labels: provider, model family, operation, outcome.
- [ ] **P4.2e: MCP/tool metrics** — executions, success/failure, duration, timeouts, approval requirement, policy denial, sandbox failure, MCP availability/reconnects/latency.
- [ ] **P4.2f: WASM metrics** — deferred unless WASM is an active supported runtime.
- [ ] **P4.2g: SQLite metrics store** — `~/.alix/monitoring/metrics.db`. Tables: `metric_samples`, `metric_definitions`, `health_checks`, `alerts`, `alert_history`. 30-day retention, configurable, compaction jobs.
- [ ] **P4.2h: Health checks** — daemon, provider, model runtime, approval/coordination/collaboration stores, ownership registry, event log, metrics store, Inspector, MCP servers. Status: healthy/warning/critical/offline/unknown.
- [ ] **P4.2i: Alert manager** — threshold, duration, cooldown, severity, acknowledgement, resolution. Default alerts: high CPU/memory/disk, provider error rate, approval backlog, worker failure spike, ownership conflict spike, daemon heartbeat missing, event-loop lag, stale coordination run, replan loop.
- [ ] **P4.2j: Monitoring API** — `GET /api/monitoring/{status,metrics,metrics/:category,health,alerts,history/:metric,trends/:metric,stream}`. SSE first, WebSocket only if bidirectional needed.
- [ ] **P4.2k: Monitoring CLI** — `alix status`, `alix health`, `alix metrics`, `alix alerts`, `alix monitoring {start,stop,config}`
- [ ] **P4.2l: Trends and analytics** — deterministic: rolling average, rate, p50/p95/p99, error-rate trend, memory growth, provider degradation, approval wait trend, coordination throughput, replan frequency, ownership conflict rate, capacity trend. No ML prediction until real historical data exists.

---

### P4.3 — CLI, TUI, and Inspector UX

**Goal:** Turn existing observability surfaces into an operator-grade experience.

**Files:**
- Modify: `src/ui/app.js`, `src/ui/index.html`, `src/ui/styles.css`
- Modify: `src/server/server.ts` (additional API routes)
- Create: `src/server/{replan-routes,agent-routes}.ts`
- Modify: `src/cli/commands/coordination.ts` (replan subcommands)
- Modify: `src/cli/commands/approval.ts` (inbox subcommands)
- Add PTY tests for TUI interactions

- [ ] **P4.3a: Unified operations timeline** — filter by category/run/worker, search, auto-follow, pause/resume, copy/export, time range, severity. One stream for response/tool/thinking/hook/approval/ownership/coordination/conflict/replan/result/alert.
- [ ] **P4.3b: Agent cards** — agent, worker, status, task, model, provider, context usage, tokens, cost, duration, approval state, ownership state, last heartbeat. Render in Inspector and TUI.
- [ ] **P4.3c: Replan proposal viewer** — trigger evidence, proposal diff, added/replaced workers, dependency rewiring, risk, ownership impact, policy result, approval status, CAS result. CLI: `alix coordination replan {list,inspect,approve,deny}`.
- [ ] **P4.3d: Approval inbox** — CLI: `alix approval inbox`, `alix approval {show,approve,deny,revoke}`. Show reason, capability, risk, scope, run, worker, expiry, policy revision, binding fingerprint.
- [ ] **P4.3e: Replay controls** — `alix replay {list,inspect,run,compare}`. Read-only by default, deterministic, explicit before side effects.
- [ ] **P4.3f: Diff viewer** — file changes, plan changes, worker/ownership/approval changes, result differences. Side-by-side, unified, JSON diff.
- [ ] **P4.3g: Responsive TUI** — target 100-149 columns, 25-39 rows. Small/medium/large layouts. No crushed cards. PTY tests for panel switching, search, auto-follow, approval, replan navigation, exit cleanup.
- [ ] **P4.3h: Error/recovery UX** — every error states: what failed, why, whether state is safe, what ALiX did automatically, what command to run next, where logs/evidence are stored.

---

### P4.4 — Adoption and Reference Applications

**Goal:** Prove ALiX on real workloads with reference apps, quickstart, support bundle, and documentation.

**Files:**
- Create: `examples/{hello-alix,todo-agent,code-reviewer}` with README, config, task files
- Create: `examples/repository-modernization/`
- Create: `examples/incident-investigation/`
- Create: `examples/documentation-release/`
- Create: `src/cli/commands/setup.ts` (extend to `quickstart`)
- Create: `src/cli/commands/support-bundle.ts`
- Create: `docs/{getting-started,installation,first-task,model-profiles,approval-workflow,coordination,replanning,monitoring,recovery,troubleshooting,operator-handbook,developer-guide,extension-guide}.md`

- [ ] **P4.4a: Repository modernization reference app** — analyze repo, detect outdated patterns, propose plan, assign agents, edit, test, detect conflicts, replan, aggregate. Includes fixture repo, tutorial, demo, benchmark, acceptance test.
- [ ] **P4.4b: Incident investigation reference app** — ingest logs, generate hypotheses, assign investigators, publish findings, detect conflicts, revise plan, produce evidence-backed report.
- [ ] **P4.4c: Documentation release reference app** — inspect code changes, identify doc impact, update docs, validate examples, generate release notes, publish bundle.
- [ ] **P4.4d: Quickstart** — `alix quickstart`. Detect project, select model profile, verify provider, initialize, run safe sample task, open Inspector, show next commands.
- [ ] **P4.4e: Support bundle** — `alix support-bundle`. Include version, platform, sanitized config, provider status, model profile, health checks, recent logs/events, metrics summary, store integrity report, package metadata. Never include API keys, raw secrets, full prompts by default.
- [ ] **P4.4f: Documentation set** — Getting Started, Installation, First Task, Model Profiles, Approval Workflow, Coordination, Replanning, Monitoring, Recovery, Troubleshooting, Operator Handbook, Developer Guide, Extension Guide.

---

### P4.5 — Kernel Extraction Readiness

**Goal:** Prepare `src/kernel/` for possible extraction without prematurely splitting packages.

**Files:**
- Create: `docs/kernel/{dependency-audit,public-api}.md`
- Create: `src/kernel/index.ts` (public API barrel)

- [ ] **P4.5a: Dependency audit** — classify imports as kernel-safe/runtime-specific/CLI-specific/TUI-specific/server-specific/filesystem-specific
- [ ] **P4.5b: Ports/adapters** — introduce interfaces for clock, ID generator, filesystem, event/audit/metrics sink, model adapter, policy evaluator, approval/ownership/result store. Remove hidden `process.cwd()`, `Date.now()`, `Math.random()`, `process.env`, `console` from kernel.
- [ ] **P4.5c: Public API inventory** — classify every export as public/experimental/internal/deprecated. Create `src/kernel/index.ts`.
- [ ] **P4.5d: Boundary linting** — rules preventing kernel → CLI/TUI/server/UI imports. Only CLI/TUI/server/runtime → kernel allowed.
- [ ] **P4.5e: Consumer contract tests** — minimal consumer importing kernel through public APIs only. Test plan, schedule, authorize, approve, execute, aggregate, replan.
- [ ] **P4.5f: Extraction decision gate** — extract only when independent consumer exists, public API stable, persistence contracts versioned, no UI/runtime imports remain, consumer tests green, release strategy defined.

---

## File Structure (New)

```
src/
  monitoring/
    metric-types.ts
    metric-registry.ts
    metric-sink.ts
    metrics-store.ts
    system-monitor.ts
    health-checker.ts
    alert-manager.ts
  recovery/
  testing/
    concurrency-harness.ts
    fault-injection/
    soak/
  cli/commands/
    certify.ts
    status.ts
    setup.ts
    monitoring.ts
    support-bundle.ts
    recover.ts
  server/
    replan-routes.ts
    agent-routes.ts
tests/
  recovery/
  monitoring/
  stress/
  cli/certify.test.ts
docs/
  architecture/{system-overview,coordination-kernel,collaboration-system,approval-and-policy,replanning,observability}.md
  support-matrix.md
  migrations/
  testing/skipped-tests.md
  monitoring/
  recovery/
  reference-apps/
  kernel/{dependency-audit,public-api}.md
  operations/
  getting-started.md
  installation.md
  first-task.md
  model-profiles.md
  approval-workflow.md
  coordination.md
  replanning.md
  monitoring.md
  recovery.md
  troubleshooting.md
  operator-handbook.md
  developer-guide.md
  extension-guide.md
```

---

## Verification

1. **Test suite** — `npm run test:node:ci` + `npm run test:vitest` + `npm run test:integration` all green
2. **Stress** — `npm run test:stress -- --seed 12345` all green
3. **Soak** — 1h quick soak passes thresholds
4. **Certify** — `alix certify --full` all green on fresh install
5. **Recovery** — every execution stage interruption test passes invariants
6. **Cross-platform** — CI green on Linux, macOS, Windows
7. **Package** — `npm pack --dry-run` clean
8. **Reference apps** — three workloads pass end-to-end
9. **Skipped tests** — 0 unexplained skipped
