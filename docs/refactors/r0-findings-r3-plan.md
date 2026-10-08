# R2/R3 Refactor Campaign — R0 Findings + Phase Plan

**Branch:** `refactor/r2-ledger` · **Tags:** `r2-ledger-baseline` (R0–R2.6), `r2-ledger-authoritative` (full R2)
**Provenance:** R0 audit (5 subagent reports) and the full phase plan originally lived only in
conversation; they were lost once and recovered from the operator's notes. This file is the
durable copy. Update it when phases change status.

## Phase register

| Phase | Scope | Status |
|---|---|---|
| R0 | Dependency/responsibility audit (5 subagent reports): runtime truth fragmented across 13 stores; governance bypasses B1–B11; 5 tool taxonomies; 4 metrics vocabularies; TUI violations V1–V10; outbound redaction gap | ✅ done (findings below) |
| R1 | 10 ports in `src/contracts/` + shrink-only arch freeze test (`tests/architecture/r1-boundary-freeze.test.ts` + `r1-allowlist.json`) | ✅ `b15f3747` |
| R1.5 | Authorization containment: enforceCapabilities default ON, daemon ask+wired store, continuation revalidation, bound-tool policy gate, file.delete owned check, X-series `authorizationSource`, 4 executor sites wired | ✅ `ca27b8e1` |
| R2 | Transactional ledger strangler → authority for 9 domains + 11 reconcile CLIs (audit excluded, documented) | ✅ tags `r2-ledger-authoritative` |
| R3 | **Coordination consolidation** — detailed plan below | ⬜ |
| R4 | TUI/API projection convergence: fix in order V3 success-inference, V1 live-session painter reads, V5 approval dual truth, V6 live evolution reads, V7 inferred workflow steps, V4 quarantine `runtime-snapshot.ts`/`store.ts`, legacy Inspector vocabulary; Workbench shows "unknown/awaiting canonical event", never infers; one snapshot contract shared TUI+browser | ⬜ |
| R5 | Support subsystems: finish `models.*` cutover (3 resolvers → 1, kill flat reads); ONE tool/capability catalogue + MCP/manifest adapters; **outbound redaction gate before any remote-provider call = security correction, not cleanup**; one metric vocabulary (Node-native collectors; psutil refs in metrics doc are catalogue-only, Python) | ⬜ |
| R6 | Physical directory moves into the 12-subsystem layout — LAST, mechanical after boundaries real | ⬜ |

### 12-subsystem end-state (4 layers: Experience → Coordination → Control → Execution&Platform)

interfaces(cli/tui/inspector/api), session, planning, coordination, agents,
governance, execution, capabilities+tools, models, context+memory,
runtime-state, operations. Boundaries: planner proposes / governance
authorizes / executor acts; capabilities describe / tools implement; EventLog
(or now: ledger) records truth / projections present; memory informs, never
overrides; interfaces command+display only; observability measures, controls
nothing; operator owns the user relationship.

### R5 security note (do not lose)

Memory/context content reaches remote providers unredacted today: provider
send paths (`route-execution.ts`, `agent-loop.ts`, `planner-model.ts`,
`subagent-cli.ts`) send system prompts incl. memory+repomap with no redaction
gate; tracing redacts only the captured copy. Treat as vulnerability class.

## Verification gates

`pnpm test` | `npx tsc -p tsconfig.json --noEmit` | `pnconfig.unused` →
`npx tsc -p tsconfig.unused.json --noEmit` | `node scripts/check-dead-modules.mjs` |
`node scripts/check-dox-claims.mjs --base origin/main` (default base is local
`main` == HEAD → vacuous; MUST pass `--base origin/main`; claims resolve
against HEAD, so run it after committing AGENTS+code together).

## Gotchas learned the hard way

- GitNexus `detect_changes` index can be stale (behind branch); treat as advisory,
  re-run `analyze` if needed. Impact = CRITICAL on hubs is expected here.
- New value-import of a protected file (see allowlist JSON rules) fails the
  freeze test — put vocabularies in unprotected siblings (`*-types.ts`,
  `daemon-types.ts`) and add exact allowlist entries (reason MUST contain
  `R0 ...`, plus `removalPhase`).
- `getSharedLedger(cwd)` caches one connection per path — close before
  deleting test DBs; capture `homedir()`/workspace root at CONSTRUCTION, never
  at write time.
- Soak/stress suites are excluded from default `test:node` (dedicated
  `test:soak`/`test:stress` lanes; CI filter agrees).
- Shrink-only freeze test: removing an import without removing its allowlist
  entry fails (stale entry); removing the entry without the import also fails.
  Do both in the same commit.

---

# R0 findings (verbatim, 5 subagent reports)

R0 done. Read-only. No moves. No edits.
70 src dirs vs proposed 12. Graph: 90 modules. Top: Governance 607, Runtime 323, Kernel 274.

## 1 Runtime truth — fragmented

src/events/event-log.ts:137 EventLog = session JSONL + lock + resync. Claim: immutable truth. Reality: not.
src/runtime/runtime-index.ts:142 aggregates 7 backends read-only. Caps 2000/5000. Allowlist 16 types. source:report dead. Silent catch.

13 status stores outside log:

coordination .alix/coordination/<run>.json / graphs .json / daemon ~/.alix/daemon-tasks.json / approvals approvals.json+journal / continuations .json / new executions/<id>/state.json vs legacy executive/<plan>-state.json same class name / sessions messages/scope/state / collaboration shared/<run>/state.json / workflow state.json / audit v1+v2 + governance chain / evidence execution-evidence.jsonl + mem machine / replays index.json

Bypasses B1-B11: coordination patchWorker/updateRun no event coordination-scheduler.ts:369 / graph rewrite no append graph-executor.ts:327 / daemon registry tmp+rename task-registry.ts:85 / approval mutate() approval-store.ts:279 / continuation plain write continuation-store.ts:85 / harness commit-then-emit + swallow state-transition.ts:591 / action_executed unprojectable REDUCERS:450 / rebuild deletes w/o CAS / cross-session contaminate emitter.ts:196.

Warning: Snapshot-ahead-of-log crash window is real. store.save() commits then eventLog.append() with catch{} swallow. Crash between = snapshot without history. Replay diverges. Do not treat EventLog or RuntimeIndex as ground truth for coordination/graph/daemon/approval status until R2 lands.

## 2 Coordination — concentrated but doubled

Good: all planning via CoordinationPlanner.plan:495 coordination-planner.ts. All schedulers via createCoordinationScheduler factory. TUI zero CoordinationStore imports. Compliant.

Bad:

- 2 ownership registries: durable ownership-registry.ts:63 vs ephemeral subagent-manager.ts:89
- 3 matchers: planner infer vs lease overlap vs isWithinOwnedScope
- 2 executors: graph-executor.ts:122 sequential vs scheduler parallel ≤8
- 4 finalize paths deduped only by attachAggregateIfUnfinalized:326
- 4 lease-release paths. reclaim clears leaseIds w/o registry release coordination-resume.ts:61
- 2 liveness defs: PID probe vs heartbeat staleness
- src/orchestrator/ owns nothing coordination. Dead name.

## 3 Governance → execution — 3 worlds, 1 enforces

Operational enforces: ExecutionAuthorization.evaluate:41 -> PolicyGate:182 -> ApprovalStore -> OwnershipGate -> ToolExecutor.dispatch:341 executor.ts.

X-series self-approves: createExecutionIntent:182 auto-approval + governor.approve:171 auto-approved low-risk. Only caller turn.ts:382.

Advisory P17-P19 + CAP-9 + Evolution A4 pure. Zero executor calls. readiness-policy-gate.ts:221 sentinel.

Bypasses: graph unenforced default enforceCapabilities??false:113, rerun never gated / daemon runTask bypass:498 daemon-server.ts / 4 executor sites unwired ownership route-execution.ts:236, runtime-builder.ts:51, tui.ts:388, default-worker-review.ts:56 / 2 sites no approval store -> headless flip daemon-server.ts:87, coordination-routes.ts:601 / continuation-resume skips gate :411 / bound alix_collaboration_ inline no policy event-handlers.ts:384 / routers check containment not presented auth, file.delete no owned check :264 / M0.9 permissive placeholder:604.

Warning: Two high-risk execution paths bypass governance entirely. Medium-risk graph nodes and all daemon-submitted agent tasks run in bypass mode with no capability, policy, or approval evaluation. The X-series governed wrapper uses self-approval that is indistinguishable from operator approval in evidence logs. Do not treat X-series APPROVED or verificationPassed as authorization proof. Only coordination aggregates have independent verification.

## 4 TUI — mostly clean

Chain: EventLog -> runtimeCollector 1s poll + 20ms coalesce runtime-collector.ts:268 -> 10 projections -> snapshot():218 -> views read ctx.snap only. No view imports CoordinationStore/EventLog/ApprovalStore.

V1 painter reads live session frame-painter.ts:242 / V2 snapshot dual-source session+log snapshot-builder.ts:136 / V3 legacy a/d infers success before projection app.ts:710 vs workbench clean :984 / V4 dead runtime-snapshot.ts:46 + store.ts:114 quarantine / V5 dual approval truth store vs projection / V6 evolution reads live services Q-C3a / V7 computeWorkflow:380 infers steps, no event / V10 Inspector/UI legacy-only vocab vs TUI dual vs timeline canonical-only. Browser vs TUI see different reality.

## 5 Models/memory/tools/metrics — fragmented

Models canonical models.* schema.ts:197, ~20 sites use resolveModelConfig. Bypass: hardware-detect.ts:85 flat read / providers/registry.ts:78 name??model / 5x subagents.enabled branch / resolver2 providers/model-resolver.ts:1 / resolver3 decision/model-tier fail-closed vs canonical fallback / dormant decision/config + statistical reasoning/* / agent.ts:85 mutates canonical after load.

No src/memory/. src/context/ 3 files keyword only. MemoryStore .alix/memory/.md uncalled recall/consolidate, frontmatter x3, contract mismatch save/find vs read/query/delete.

Warning: Memory and context content reaches remote providers without redaction. Redaction exists for telemetry, decision sealing, and server responses, but the provider send path (route-execution.ts:106, agent-loop.ts:234, planner-model.ts:38) sends system prompts including memory and repomap excerpts with no redaction gate. Tracing redacts only the captured copy, not the outbound request.

Tools x5: tools/tool-registry claims canonical vs capability/ vs registry/Cards vs mcp/ vs agents/tool-manifest alix_. Wildcards x3 dialects. 4 files must change together or drift.

Metrics x4 vocabs: MinimalMetrics kernel vs MetricRegistry observability vs TraceClient spans vs TUI /proc collector. No psutil. process.memoryUsage only + /proc Linux-only, cpuPercent:0 stub daemon path, fileDescriptors:0 stub. Daemon emits none.

## Map proposed 12 → actual

1. Experience: cli+tui+ui+server+inspector split, TUI rule enforced
2. Session: session/ thin + agent/session + run/task-loop split
3. Planning: planning/ + kernel/graph-planner+coordination-planner split
4. Coordination: kernel/coordination- ~20 files + agents/subagent-manager + ownership/ — core present, doubled
5. Agent: agent/ vs agents/ name clash
6. Governance: governance+policy+approvals+security+capability/governance split 5 ways
7. Execution: no src/execution/. Spread runtime/execution-* + kernel/graph-executor + tools/executor
8. Tools/cap: tools/ + capability/ + registry/ + mcp/ 4 universes
9. Models: models+providers+decision+reasoning split, models.* ~80% converged
10. Context/memory: context/ + utils/memory/ + repomap/ split, no src/memory/
11. Events/state: events/ + runtime/execution-state+state + audit+storage — 13 truths, not 1
12. Observability: observability+tracing+daemon split, observability 95% cohesion best in repo

---

# R3 plan — Coordination consolidation

One authority each: planning=CoordinationPlanner, scheduling=scheduler,
lifecycle=SubagentManager, ownership=durable registry + ONE matcher,
liveness=heartbeat+PID merged, finalization=idempotent-by-durable-state,
verification=independent. Each step below = its own commit unit; run gates
after each.

| Step | Scope | Status |
|---|---|---|
| R3.0 | Persist this file; refresh GitNexus index (was 25 commits stale) | ⬜ |
| R3.1 | Remove `src/orchestrator/` dead name: move `refine-strategies.ts`, `strategy-learner.ts`, `refine-strategies/*.md` into `src/run/task-loop/`; fix `STRATEGIES_DIR` cwd bug → module-relative (+ verify dist `.md` packaging); move `tests/orchestrator/` | ⬜ |
| R3.2 | Ownership: kill ephemeral map in `SubagentManager` (subagent-manager.ts:89) AND `src/agents/ownership-registry.ts` (agent.ts delegate path, allowlist R3 entry); collapse 3 matchers (planner infer `claimsOverlap` coordination-planner.ts:388 / lease overlap / `isWithinOwnedScope`) into `src/ownership/path-scope.ts` primitives; allowlist outcome: −1 dead entry (agents registry), +1 sanctioned entry (`subagent-manager.ts` durable construction), 7 durable construction entries relabeled `removalPhase: R6` (retained — the durable registry IS the authority; construction sites revisit at physical moves); extend parity TABLE `tests/ownership/path-scope.test.ts`. Governance `pathMatches` (autonomous-policy.ts:98) is OUT of scope — policy globs ≠ ownership. Run `tests/policy/policy-gate.test.ts` + `tests/tools/tool-router.test.ts` + parity table per DOX | ⬜ |
| R3.3 | Liveness: merge 2 defs — PID probe (`src/kernel/owner-liveness.ts`) + heartbeat staleness (`coordination-reconciliation.ts:56-79`) → single worker-liveness decision; rewire coordination-resume, coordination-routes.ts:547. Lock-file `isPidAlive` copies stay (lock concern, not flagged by R0) | ⬜ |
| R3.4 | Lease release: 4 paths → one; FIX BUG `coordination-resume.ts:61` clears `leaseIds` without registry release | ⬜ |
| R3.5 | Finalization: 4 paths → single choke through `attachAggregateIfUnfinalized` (coordination-store.ts:326); pin test: double-finalize emits exactly 1 aggregate event | ⬜ |
| R3.6 | Verification: extract shared helper for the 6 duplicated `readRunSessionEvents → deriveCoordinationCompletion → matchesAttachedAggregateEvent` sites (cli/coordination.ts, collaboration-context-builder, coordination-view, coordination-tools, task-loop/completion-phase) | ⬜ |
| R3.7 | GraphExecutor (2 executors: sequential graph-executor.ts:122 vs scheduler parallel ≤8) — own sub-phase: decide retire (route `alix graph run`/`sop run` through CoordinationPlanner+scheduler) vs adapt (thin sequential adapter). d=1 = 4 call sites, CRITICAL hub. Decision deferred until R3.2–R3.6 land | ⬜ |
| R3.8 | DOX pass (root, src/kernel, src/ownership, src/agents) + full gates + `check:dox --base origin/main` + `detect_changes` + tag `r3-*` | ⬜ |

## R3 impact notes (advisory — index stale at planning time)

- `SubagentManager`: risk CRITICAL, d=1 = 7 (expected hub; re-run impact after reindex).
- `GraphExecutor`: risk CRITICAL, d=1 = 4 (`cli/commands/graph.ts` run/rerun/continue, `cli/commands/sop.ts`).
- Planning/scheduling/lifecycle authorities already compliant (R0 "Good") — pin in DOX, no code.
