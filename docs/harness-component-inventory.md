# Harness component and authority inventory (P0-A)

**Status:** DRAFT — read-only audit. No production change authorized.
**Baseline:** `release/gate7-main-e948e356` @ **`4ac6df14`** (tree `8bf5ac2b6dfaeccaa69567410e32e6f7a768a305`), fast-forwarded onto local `main`.
**Branch:** `docs/pre-2.0-harness-audit` @ `49bd055a`.
**Parent:** `docs/ALiX_PRE_2_0_HARNESS_PRD.md` §5 (PRE-R002), §9 Gate A.

Every row below was verified against the pinned commit, not the PRD's earlier
`e948e356` snapshot. Where a claim could not be verified it stays explicitly
**UNKNOWN** rather than being inferred.

---

## 1. Method

- Path presence confirmed with `test -f` at the pinned commit.
- Caller counts use import specifiers (`from "…/<module>"`), not bare filename
  matches — an early pass using `basename` over-counted badly (e.g. `main`),
  which is recorded here so the numbers are not mistaken for the sloppy version.
- "Definition duplication" was distinguished from "delegation" by reading the
  body, not by name similarity. One candidate that looked like a duplicate
  (`resolveEffectiveModel`) turned out to delegate (see §5).
- No file was executed, no benchmark was run. Any effectiveness claim is absent
  by construction; M2 candidates are *candidates* only.

---

## 2. Component inventory (verified at `4ac6df14`)

| ID | Path | Lines | Importers | Verified role |
|---|---|---|---|---|
| HC-01 | `src/agents/agent/system-prompt.ts` | 164 | 8 | Base prompt + `RESEARCH_SUPPLEMENT`; parallel-by-default guidance, "run multiple searches", phase supplements |
| HC-02 | `src/agents/tool-name-resolver.ts` + `src/agents/tool-policy.ts` | 88 / — | — | `buildOfferedExecutableTools`, `resolveExecutableToolName`; explicitly rejects executor IDs as callable aliases |
| HC-03 | `src/execution/patch/edit-format-policy.ts` | 52 | 10 | `defaultEditFormatForProvider`, `normalizePreferredFormat`; provider→format map for google/local/ollama/minimax/zhipuai/grokai |
| HC-04 | same file | 52 | 10 | `fullFileRewrite: "deny"` is hard-coded in the policy record |
| HC-05 | `src/context/repomap/context-compiler.ts` | 201 | 13 | Single `ContextCompiler` class; 60 s bundle cache (`CONTEXT_CACHE_TTL_MS`), `EmbeddingCache` with semantic/code embedders |
| HC-06 | `src/planning/autonomy/state-machine.ts` | 239 | 41 | `RunLimiter.canTransition`: maxIterations / maxRepairs / maxRuntimeMs ceilings |
| HC-07 | `src/agents/agent/agent-loop.ts` (673) + `src/execution/run/task-loop.ts` (26, barrel) + `task-loop/main.ts` (1479) | 2178 | 2 / 1 / 1 | `agent-loop` owns `runTask` + trace/evidence envelope and calls `runTaskCoreImpl`, which calls `runTaskLoop` — **one chain, three layers, no duplicate loop** |
| HC-08 | `src/agents/subagent-cli.ts` | 922 | 4 | Child worker: arg parsing, MCP init, tool filtering, its own provider loop, objective review |
| HC-09 | `src/coordination/kernel/coordination-scheduler.ts` | 1438 | 13 | Scheduler: dispatch, reconcile, leases, timeouts, approval-blocked accounting |
| HC-10 | `worker-executor.ts` (178) + `subagent-worker-executor.ts` (158) | 336 | 14 / 1 | Two adapters behind one `CoordinationWorkerExecutor` contract |
| HC-11 | `src/operations/config/defaults.ts` + `loader.ts` | 162 / — | 22 | Config surface; `normalizeModelConfig` writes `model` and `subagents` projections (§5.2–§5.4) |
| HC-12 | `src/coordination/kernel/AGENTS.md` | — | — | Ledger-first, single-scheduler, meaningful-event contracts |

**Added during audit:** `src/agents/tool-name-resolver.ts` (HC-02's real home) was
not in the PRD's original row; the PRD named only the prompt file.

---

## 3. Classification

| ID | Class | Rationale | Disposition |
|---|---|---|---|
| HC-01 | **M2 candidate** | Parallel-by-default and "run multiple searches with varied terminology" are prompt-level compensations | Benchmark ablation only |
| HC-02 | **S1** | Tool-name/executor-ID containment is an authority boundary, not a nudge | Preserve |
| HC-03 | **M2 candidate** | Provider→format map encodes historical model weaknesses | Benchmark per model |
| HC-04 | **S0** | `fullFileRewrite: "deny"` prevents destructive rewrites | Preserve; security review for any change |
| HC-05 | **M1** | Ranking/budget/cache are adaptive intelligence | Benchmark light vs ranked vs deep |
| HC-06 | **S0** | Ceilings bound runaway execution | Preserve |
| HC-07 | **S1** | Orchestration authority (ordering, not policy) | Map transitions; no deletion |
| HC-08 | **S1/M1** | Child execution + auth integration | Keep contract; test both adapters |
| HC-09 | **S0/S1** | Scheduling authority | Preserve |
| HC-10 | **S1** | Two adapters, one contract | Keep; parity-test |
| HC-11 | **L0 (partial)** | `model`/`subagents` are single-writer compatibility projections | Migrate readers, then retire |
| HC-12 | **S0** | Pin invariants with tests | Preserve |

**Rule applied:** no S0/S1 was reclassified M2 merely because a frontier model
could imitate the behaviour. HC-01 and HC-03 are the only M2 candidates, and both
require benchmark evidence before any retirement claim.

---

## 4. Protected controls (priority check, as directed)

### 4.1 `WorkerApprovalPort` — S0

- **Single implementation**, `src/governance/approvals/worker-approval-port.ts`.
- **One production caller:** `src/agents/subagent-cli.ts:627`
  (`openWorkerApprovalPort(projectRoot, { eventLog, workerId: taskId })`).
- **Decision methods unreachable:** `resolve`, `resolveWithEvidence`,
  `resolveGroup`, `revoke`, `invalidate`, `mutate` are absent, and
  `createWorkerApprovalPort` throws at construction if one ever appears.
- **Ownership scoping:** `recordExecutionOutcome` refuses a record whose
  `workerId` differs from the port's bound id.
- **Guarded by:** `tests/security/worker-approval-port.vitest.ts` (14 tests,
  red-checked in both directions).

**Simplification risk:** any future consolidation that hands the child a real
`ApprovalStore` reopens self-approval. The port must remain the only child-facing
approval surface.

### 4.2 R1 boundary freeze — S0

- `tests/architecture/r1-boundary-freeze.test.ts`, 8 rules
  (`direct-tool-dispatch`, `status-store-writes`, `eventlog-append-producers`,
  `ownership-registry-construction`, `model-resolver-impls`,
  `tool-taxonomy-defs`, `metrics-vocabs`, `ui-store-imports`).
- Allowlist: **76 entries** — `status-store-writes` 53,
  `eventlog-append-producers` 13, `ownership-registry-construction` 8,
  `ui-store-imports` 2. Removal phases: R2 62, R6 12, R4 2.
- Shrink-only: a new violation fails, a stale entry fails, an entry without an
  R0 reference and removal phase fails.

**Demonstrated value:** this test rejected a direct `ApprovalStore` import in
`subagent-cli` during F8b and forced a single sanctioned construction seam. That
is an architectural control working as designed.

**Audit note (not a finding):** the 76-entry allowlist is the real measure of
remaining boundary debt. It is shrink-only, so `R2`/`R6` retirement work in P0-F
must reduce it, and any simplification that *adds* an entry should be treated as
a regression rather than a convenience.

---

## 5. Duplication analysis

| Question | Finding | Verdict |
|---|---|---|
| Two task loops? | `runTask` → `runTaskCoreImpl` → `runTaskLoop`. One chain, three layers | **No duplication** |
| Two model authorities? | `createModelResolver` is canonical (25 importers). `resolveEffectiveModel` **delegates** to it and only applies override precedence | **No duplication** — but see §6 |
| Two schedulers? | `CoordinationScheduler` is the only scheduling authority; `GraphExecutor` is explicitly not | **No duplication** |
| Two config authorities? | `normalizeModelConfig` is the single writer of the `model`/`subagents` projections | **Projection debt, not duplication** |
| Two context compilers? | One `ContextCompiler` class | **No duplication** |
| Prompt assembly | Spread across `system-prompt.ts`, `operations/prompts/registry.ts`, `route-prompts.ts`, session setup/turn/init | **Needs mapping (P0-B)** — not yet proven duplicate |

---

## 6. Findings register

| # | Finding | Severity | Evidence | Disposition |
|---|---|---|---|---|
| A-01 | `resolveEffectiveModel` lives in `subagent-cli.ts` and is **not** covered by the `model-resolver-impls` R1 rule, which watches only `createModelResolver`. A future second authority could therefore be introduced here without tripping the freeze | **Medium** | `src/agents/subagent-cli.ts:24`; rule target at `r1-boundary-freeze.test.ts:60-79` | Consider widening the rule target — needs review; not a P0-A edit |
| A-02 | `agent-loop.ts` mixes the run envelope (tracing/evidence) with the impl call; 673 lines with two exports | Low | `agent-loop.ts:55-80, 611, 648` | Map in P0-B; no deletion |
| A-03 | `config.model` / `config.subagents` are single-writer projections with no inventory of remaining readers | Low | `loader.ts:40-77` | P0-F migration inventory (PRE-R010) |
| A-04 | 76-entry R1 allowlist encodes substantial remaining boundary debt | Informational | `r1-allowlist.json` | P0-F must shrink it; additions are regressions |
| A-05 | `subagent-cli.ts` (922 lines) owns arg parsing, provider loop, MCP init, tool filtering, objective review and now approval-port setup | Medium | `subagent-cli.ts`; 4 importers | Candidate for decomposition in P0-F; no behaviour change authorized now |

---

## 7. Explicit unknowns

These are **not** resolved and must not be read as clean:

- **HC-01 / HC-03 effectiveness** — no benchmark has been run. Whether
  parallel-default guidance or the provider format map still changes outcomes is
  unknown.
- **Prompt assembly ownership** — several sites assemble prompt text; whether any
  are redundant needs P0-B mapping.
- **Complete caller graph** — import-specifier counts are a proxy. Dynamic
  `import()`, registry lookups and string dispatch are not captured.
- **Legacy (L0) inventory** — only the `config` projections are characterised.
  A full alias/reader/wrapper inventory is P0-F work (PRE-R010).
- **Production cost/latency** — no measurement exists (P0-D).

---

## 8. P0-A completion status

| Gate A criterion | Status |
|---|---|
| Every high-risk finding has a source reference | **PASS** — §6 rows carry file:line |
| Named authority per component | **PASS** — §2 / §4 |
| Relevant consumers and tests named | **PARTIAL** — consumers counted; S0 test mapping is §4 and the companion invariant register |
| Clear classification | **PASS** — §3 |
| Unknowns explicit | **PASS** — §7 |

**Verdict: P0-A inventory COMPLETE with named unknowns.** No retirement is
recommended on current evidence; the only M2 candidates require P0-D benchmarks
before any keep/retire decision.

Production simplification remains **HOLD**. Publication remains **HOLD** under
Q13.
