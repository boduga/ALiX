# #717 — Megafile split plan (rev 2, after critical review)

Status: **APPROVED with clarifications** (human sign-off recorded below). No
extraction has been performed yet. Rev 2 corrects rev 1 after verifying every
claim against the source; rev 3 locks three execution clarifications.

## Approval

> Approved with the rev-2 ordering and tiered thresholds. Leaf extractions must
> be verbatim behavior-preserving moves. The two named megafunction
> decompositions are structural refactors and require separate commits and
> review. Extracted modules must not become replacement megafiles. A repeatable
> test failure blocks the next step; any known environmental timeout must be
> rerun and documented.

Execution order: `security → adaptation → governance → task-loop → session → cli`.

## Commit protocols (two distinct kinds — do not conflate)

- **Leaf-extraction commit:** verbatim move of code plus import/re-export
  changes only. No edits to the moved bodies. This is the default for
  dispatcher/helper/renderer moves.
- **Method-decomposition commit:** structural refactoring is allowed (splitting
  a megafunction into phase methods/collaborators), but **no intentional
  behavior changes**. Reviewed as a refactor, not a move.

A single commit is exactly one kind.

## No replacement megafiles

- Every newly extracted dispatcher/helper module must itself stay **≤ 1,000
  lines**.
- Orchestrator collaborators may use the ≤ 1,500 tier, but `loop.ts` must not
  become a replacement god-file.
- `runTaskLoop` and `build()` must finish as **readable coordinators that
  delegate cohesive phases** — not code redistributed into large private
  methods within the same module.

## Environmental-test rule

- A **repeatable** failure blocks the next step.
- A known environmental timeout (e.g. `GraphExecutor` "blocked capability"
  falling through to a real user config) must be **rerun in the clean
  repository configuration** (isolated HOME / no user config, as CI runs) and
  **documented** in the step's notes. It may then be recorded but never
  silently ignored.


## Goal

Break the six largest modules into deep, stable-interface units so review and
targeted change are safe. Each step is behavior-preserving, keeps the module's
public interface stable, and is independently reviewable.

## Size threshold (revised — per tier)

Rev 1 proposed a flat 1,000 lines. That is **not reachable by moving leaves**
for two of the six modules, whose bulk is a single giant function/method:

| Module | Lines | Largest block |
|--------|------:|---------------|
| `src/cli/commands/governance.ts` | 5,358 | `handleGovernanceCommand` 218 |
| `src/agent/session.ts` | 3,187 | **`AgentSessionBuilder.build()` 1,879** |
| `src/cli.ts` | 2,775 | none >18 (≈70 inline command blocks) |
| `src/run/task-loop.ts` | 2,329 | **`runTaskLoop` 1,537** |
| `src/cli/commands/security.ts` | 1,806 | `handleSecurityDoctorComprehensive` 283 |
| `src/cli/commands/adaptation.ts` | 1,508 | `runGenerate` 165 |

Revised thresholds:

- **Dispatcher / handler modules** (`governance`, `cli`, `security`,
  `adaptation`): target **≤ 1,000 lines**. Reachable by moving leaf handlers
  and renderers.
- **Orchestrator modules** (`session`, `task-loop`): target **≤ 1,500 lines**
  *and* the named megafunction must be decomposed by method extraction
  (`AgentSessionBuilder.build()`, `runTaskLoop`). A pure leaf-move cannot meet
  1,000 here; committing to method-level decomposition is a larger, riskier
  step and is called out explicitly below.
- **Ratchet:** no extraction may grow any *other* file past its tier threshold.

## Verification gate (revised)

Every step, all green before the next step:

- `pnpm build`
- `pnpm typecheck:unused` and `pnpm check:dead`
- `pnpm test:node:ci`
- `pnpm test:vitest`
- `pnpm test:manual:tui` and the CLI smoke suites for any change touching
  `src/cli.ts`, `src/agent/session.ts`, or `src/run/task-loop.ts`
  (rev 1 omitted these — they are the suites that actually cover those files).

Known: the `node:test` lane has one marginal environmental timeout
(`GraphExecutor` "blocked capability", ~19s locally; fast in CI where no user
config exists).

## Public surface (must be preserved — rev 1 under-specified this)

Moving code must not break existing import paths. Re-export from the original
module, or update every importer in the same commit. Named symbols:

- `governance.ts`: `handleGovernanceCommand` (public) and the test-imported
  `formatMetadata`, `formatTimelineLine`, `computeRelatedEvents`.
- `session.ts`: `AgentSessionBuilder`, `SessionPhase`, all exported types,
  `readVersionCached`, `livenessEventType`, `isCancellationError`,
  `buildSessionStreamHandler`, `emitSessionEvents`,
  `extractToolResultsFromMessages`, `resolveExplicitSkills`, `setupSkills`,
  `buildSkillsSection`, `spliceSkillsSection`, `spliceExplicitIntoFirstTurn`,
  `createAgentSession`.
- `task-loop.ts`: `emitAgent`, `buildShedToolRetryMessage`,
  `explicitMutationTargets`, `isContinuationMessage`,
  `objectiveEvidenceRequirements`, `lastToolResultShowsClientError`,
  `latestToolFailure`, `durableCompletionSummary`, `claimsArtifactWritten`,
  `runTaskLoop`, `TaskLoopDeps` (several are imported by tests).

## Ordering (revised)

Rev 1 put `cli.ts` third. Because `cli.ts` dispatches into the command modules,
splitting it first would move handlers that are then split again — double
churn. **Command modules first, `cli.ts` last.** cli.ts's blocks then delegate
to already-stable modules.

1. `src/cli/commands/security.ts` — smallest, self-contained handlers.
2. `src/cli/commands/adaptation.ts` — next smallest.
3. `src/cli/commands/governance.ts` — large but leaf-heavy.
4. `src/run/task-loop.ts` — predicates first, then decompose `runTaskLoop`.
5. `src/agent/session.ts` — decompose `AgentSessionBuilder.build()` (hardest).
6. `src/cli.ts` — move the ~70 inline command blocks into router handlers.

---

## 1. `src/cli/commands/security.ts` (1,806) → ≤1,000

1. Supply-chain commands → `security/supply-chain.ts`.
2. Inspector auth commands → `security/inspector-auth.ts`.
3. Audit verify/activate/checkpoint → `security/audit.ts` (the `handleAudit*`
   family from #683).
4. Credential commands → `security/credentials.ts`.
5. `security.ts` remains the dispatcher.

## 2. `src/cli/commands/adaptation.ts` (1,508) → ≤1,000

1. Appliers + `selectApplier` wiring → `adaptation/appliers.ts`.
2. Renderers/formatting (`printCapabilityEvolutionReport`, etc.) →
   `adaptation/renderers.ts`.
3. Per-action handlers (generate, prioritize, effectiveness, readiness,
   revert) → `adaptation/handlers.ts`.
4. `handleAdaptationCommand` stays as the router.

## 3. `src/cli/commands/governance.ts` (5,358) → ≤1,000

Note: render/format helpers are only **31 functions / 596 lines** — moving
them alone leaves ~4,700 lines, so the per-command handlers must also move.
Expect ~6–8 commits.

1. Renderers → `governance/renderers.ts` (31 functions, ~596 lines).
2. Flag parsers → `governance/args.ts` (`parseFlags`, `parseRecommendFlags`,
   `parseSectionFlag`).
3. Investigation subcommands → `governance/investigation.ts`.
4. Analytics/report subcommands → `governance/analytics.ts`.
5. Approval/lifecycle subcommands → `governance/approvals.ts`.
6. Evolution subcommands → `governance/evolution.ts`.
7. Audit subcommands (`runAudit*`, ~700 lines) → `governance/audit.ts`.
8. `handleGovernanceCommand` stays a thin router; re-export the three
   test-imported format helpers.

## 4. `src/run/task-loop.ts` (2,329) → ≤1,500 + decompose `runTaskLoop`

1. Pure predicates/helpers → `run/task-loop/predicates.ts` (the ~18 exported
   predicates and internal helpers, lines 78–604).
2. Context classification → `run/task-loop/context.ts` (`classifyMessageToCategory`,
   `classifyCandidateContext`, `reconstructRequest`, `sourceIndexOf`,
   `toBudgetedItems`, `evaluatePattern`).
3. Emission/history → `run/task-loop/emission.ts` (`emitAgent`,
   `getHistoricalSuggestions`, `completeSession`, `maybeEmitRotRisk`).
4. **Decompose `runTaskLoop` (1,537 lines)** into private phase methods
   (context assembly, provider turn, tool dispatch, verification, completion)
   in `run/task-loop/loop.ts`, one phase per commit. This is method
   extraction, not a move — each commit must keep tests green.

## 5. `src/agent/session.ts` (3,187) → ≤1,500 + decompose `build()`

1. Version/liveness/stream helpers → `agent/session/runtime-helpers.ts`.
2. Skills prompt helpers → `agent/session/skills-prompt.ts`.
3. Setup helpers (`setupSession`, `setupWorkflow`, `setupResume`,
   `setupMemory`, `setupSkills`, `setupContextLimits`, `setupContextAndPlan`,
   `setupTools`, `setupSystemPrompt`, `setupHooks`, `resolveExplicitSkills`,
   `resolveDirectOutputCeiling`) → `agent/session/setup/`.
4. **Decompose `AgentSessionBuilder.build()` (1,879 lines)** into private
   methods / collaborator classes, one cohesive phase per commit. This is the
   hardest step in the whole issue: it is a stateful builder with many
   locals; each extraction must preserve behavior and pass the full gate.

## 6. `src/cli.ts` (2,775) → ≤1,000

70 inline `if (command === "…")` blocks + 12 `COMMAND_ROUTER` entries.

1. Move the help text → `src/cli/help.ts`.
2. Move inline blocks into `src/cli/commands/<area>.ts` handlers registered in
   `COMMAND_ROUTER` — **in batches of ~10 blocks per commit** (rev 1 implied
   one giant commit; 70 blocks is not independently reviewable).
3. Group tiny related commands into one file per area rather than one file per
   command (avoid ~70 tiny modules).
4. `src/cli.ts` ends as: parse argv → router lookup → dispatch → exit. Keep it
   the single bin entry (already in `check:dead`'s allowlist).

---

## DOX

- Create a child `AGENTS.md` for each new directory in the same commit.
- Add `src/agent/AGENTS.md` and `src/cli/AGENTS.md` (plus `governance/`) to the
  **root Child DOX Index** — rev 1 forgot that the root index currently lists
  neither `src/agent/` nor `src/cli/`.
- Refresh the parent index whenever a child is added/removed.

## Progress

- **Step 1 — `security.ts` (1,806 → 49)**: DONE. Handlers extracted to
  `src/cli/commands/security/{shared,inspector-auth,audit,credentials,supply-chain,doctor}.ts`
  (all ≤ 598 lines); `security.ts` is a re-export barrel. Public import paths
  unchanged. Child `AGENTS.md` added + root Child DOX Index updated.
- **Step 2 — `adaptation.ts` (1,507 → 16)**: DONE. Extracted to
  `src/cli/commands/adaptation/{shared,appliers,renderers,handlers,main}.ts`
  (all ≤ 944 lines); barrel re-exports `handleAdaptationCommand` + `selectApplier`.
  Updated the one source-grep test that read the old path
  (`adaptation-generate.vitest.ts` → `adaptation/handlers.ts`). Child
  `AGENTS.md` added + root index updated.
- **Step 3 — `governance.ts` (5,357 → 8)**: DONE. Extracted to 16 modules under
  `src/cli/commands/governance/` (largest `audit-insights.ts` 747 lines, all
  ≤ 1,000); barrel re-exports `handleGovernanceCommand` + `formatMetadata`,
  `formatTimelineLine`, `computeRelatedEvents`. Cross-module imports
  auto-generated; dynamic-import depth fixed. Source-scan sentinels now read the
  barrel + modules via `tests/helpers/governance-source.ts` `readGovernanceSource()`
  (updated `audit-migration.test.ts`, `governance-workbench.test.ts`,
  `governance-sentinels.vitest.ts`, `cli/governance-workbench-cli.test.ts`).
  Child `AGENTS.md` added + root index updated.

Verification (steps 1–3): build, `typecheck:unused`, `check:dead` clean;
governance vitest 51/51, governance node tests 1353/1353. Full suites: vitest
6129/0. Node: 7493 pass / 0 fail with the known `GraphExecutor` timeout — rerun
under an isolated HOME (clean config, as CI) passes in 145ms, confirming
environmental.

All steps complete (1–4, 5a, 5b, 6).

### Step 4 inventory — `src/run/task-loop.ts` (2,328 lines)

**4a (DONE) — module-scope leaf extraction.** `task-loop.ts` is now a 26-line
re-export barrel over `src/run/task-loop/{session-lifecycle,predicates,context-helpers,main}.ts`
(260/337/261/1704 lines). `main.ts` holds `TaskLoopDeps` + `runTaskLoop` and is
still **above** the 1,500-line orchestrator threshold — the decomposition below
is still required. Child `AGENTS.md` added + root index updated.

Top-level (module-scope) surface, in order:
- Helpers: `completeSession`, `maybeEmitRotRisk`, `isIrreducibleContextBudgetOverflow`,
  `buildContextBudgetOverflowSummary`, `classifyIrreducibleKind`, `emitAgent`,
  `buildShedToolRetryMessage`, `isCompletionTool`, `resolveToolExecutionName`,
  `explicitMutationTargets`, `hasExecutedActionTool`, `findUnsubstantiatedClaims`,
  `isContinuationMessage`, `objectiveEvidenceRequirements`, `objectiveEvidenceGaps`,
  `missingEvidenceSummary`, `toolResultFailureBody`, `lastToolResultShowsClientError`,
  `latestToolFailure`, `durableCompletionSummary`, `claimsArtifactWritten`,
  `extractErrors`, `getHistoricalSuggestions`.
- Consts/types: `CLAIM_TOOL_MAP`, `CLAIM_TOOL_NAMES`, `NARRATING_THRESHOLD`,
  `SHORT_SYNTHESIS_THRESHOLD`, `MUTATION_TOOL_NAMES`, `VERIFICATION_COMMAND_RE`,
  `VERIFICATION_EVIDENCE_GAP`, `CONTINUATION_RE`, `ARTIFACT_WRITE_RE`,
  `RESEARCH_LIMITS`, `SuccessfulToolEvidence`, `TaskLoopDeps`.
- `runTaskLoop` (604–2140, 1,537 lines) — the megafunction.
- Post-loop context helpers: `classifyMessageToCategory`,
  `classifyCandidateContext`, `reconstructRequest`, `sourceIndexOf`,
  `toBudgetedItems`, `evaluatePattern`; module-level `await import` block for
  session-outcome/pattern-registry at EOF.

Note: much of `runTaskLoop`'s body is written at column 0 (unindented), so
`grep '^function|^const'` over-reports its inner statements as top-level — do not
slice by that grep. Extract top-level helpers into `src/run/task-loop/*.ts`
first; then decompose `runTaskLoop` itself (separate commit).

**4b (DONE) — `runTaskLoop` method decomposition.** Extracted three coherent
phases, body verbatim, public behavior unchanged:
- `context-phase.ts` `assembleBudgetedContext` — budget admission gate
  (assembly + tool-schema reservation + T6 events + preflight).
- `verification-phase.ts` `runIterationVerification` — end-of-iteration
  verification + repair loop (returns `earlyReturn` RunResult on repair limit).
- `session-lifecycle.ts` `persistSessionState` — per-iteration crash-resilience
  save.

`main.ts` 1,704 → **1,493** (≤ 1,500 orchestrator threshold); `runTaskLoop`
~1,340 lines. All task-loop modules ≤ 1,500. Verified: 338 task-loop tests,
full `pnpm test:vitest` 6129/0, `pnpm test:node:ci` 7493/0 (known GraphExecutor
environmental timeout reconfirmed at 145ms under isolated HOME).

### Step 5 inventory — `src/agent/session.ts` (3,186 lines)

**5a (DONE) — module-scope leaf extraction.** `session.ts` is now a 16-line
`export *` barrel over `src/agent/session/{types,helpers,setup,main}.ts`.
`main.ts` holds the `AgentSessionBuilder` class and is still **above** the
1,500-line threshold — the 5b decomposition is required. Child `AGENTS.md` added
+ root index updated.

`AgentSessionBuilder` class spans 617–2,545. Its `build()` (657–2,545) is a
**closure factory**, not a plain function: it declares shared `let` state and
~24 nested functions that close over it, then returns the `AgentSession`
object. This is the hardest step — a mechanical slice will not work; the shared
state must become an explicit object threaded into extracted factories.

Nested-function map (absolute lines):
- state block 657–804: `resolvedSessionId`, `createdAt`, tracing facade,
  `restoreReconstructedPlanTasks` (670), and the `let` state vars.
- `initialize` 805–977 (~173), `createFreshSessionState` 978, 
  `extractToolCallsFromMessages` 996, `feedActivity` 1018.
- phase/liveness/activity/cancel accessors 1062–1171: `advancePhase`,
  `getPhase`, `getLiveness`, `getActivity`, `cancellationInProgress`,
  `cancelActiveTurn`, `getLastCancelSummary`.
- `processTurn` 1172–1204; **`processTurnBody` 1205–2140 (~936 lines)** — the
  core of the decomposition.
- session accessors/persistence 2141–2327: `getSessionId`, `getMode`,
  `setMode`, `getVersion`, `getState`, `save`, `resume`.
- chat path 2328–2545: `runSearch`, `ensureChatProvider`, `processChat`,
  `processChatBody`.

**5b (DONE) — `build()` decomposition.** Hoisted all shared mutable state into
`session/state.ts` (`SessionState` + `createSessionState`) and extracted the
nested functions into module-level factories that take that state:
`session/activity.ts` (`feedActivity`, `advancePhase`, `getPhase`/`getLiveness`/
`getActivity`, `cancellationInProgress`, `cancelActiveTurn`), `session/init.ts`
(`initialize`), `session/turn.ts` (`processTurn`, `processTurnBody`,
`createFreshSessionState`, `extractToolCallsFromMessages`), `session/chat.ts`
(`processChat`, `processChatBody`, `runSearch`, `ensureChatProvider`), and
`session/resume.ts` (`resumeSession`, `restoreReconstructedPlanTasks`).
`main.ts` keeps only the `with*` builders, the state construction, the small
accessors (`getSessionId`/`getMode`/`setMode`/`getVersion`/`getState`/`save`),
and the returned `AgentSession` literal. Behavior preserved; public surface
unchanged (new modules are internal, not barrel-exported).

Result: `main.ts` 2,016 → **165** (well under the 1,500 orchestrator
threshold); largest new module `turn.ts` 1,054; all others ≤ 713. Repointed the
two source-scan sentinels (`session-skills.test.ts` → `chat.ts`;
`langfuse-boundary.vitest.ts` → `state.ts`). Verified: `pnpm build`,
`typecheck:unused`, `check:dead`, `verify:deps` clean; `pnpm test:vitest`
6129/0; `pnpm test:node:ci` 7494 pass / 0 fail.

### Step 6 — `src/cli.ts` (2,774 lines) — DONE

Batched extraction of the inline `if (command === ...)` blocks into
`src/cli/commands/` modules; each block body moved verbatim and `cli.ts`
delegates via dynamic import:

- batch 1 `graph.ts` (9 handlers); 2 `config.ts` (8; also moved `selectProvider`);
  3 `mcp-extension.ts`; 4 `skill.ts`; 5 `metrics-db-memory.ts` (also moved
  `MEMORY_TYPES`/`MemoryType`); 6 `policy-registry-runtime.ts`;
  7 `daemon-audit.ts`; 8 `approvals-doctor-capability.ts`;
  9 `security-ops.ts` (13 handlers).

`cli.ts` 2,774 → **642** (≤ 1,000 dispatcher threshold). The remaining inline
blocks are thin delegations to already-extracted command modules. Repointed the
`skill-commands` sentinel to `cli/commands/skill.ts`.

Verified: full `pnpm test:vitest` 6129/0 and `pnpm test:node:ci` 7494/0.


## Execution protocol

1. One extraction per commit; move code verbatim, update imports only.
2. Preserve the public surface (re-export or update importers in-commit).
3. Run the full verification gate before the next step.
4. Stop and file a separate issue if a step needs a behavior change.
5. Method-extraction steps (session `build()`, task-loop `runTaskLoop`) are
   flagged separately and reviewed as refactors, not moves.

## Review findings (why rev 2 exists)

1. **Flat 1,000-line target is unreachable by leaf moves** for `session.ts`
   and `task-loop.ts` — their bulk is one function each. Rev 2 sets per-tier
   thresholds and commits to method-level decomposition.
2. **Public-surface preservation was under-specified** — named the exact
   test-imported symbols that need re-exports.
3. **cli.ts was sequenced too early** — moved last to avoid double churn.
4. **Verification gate omitted the suites that cover the risky files** — added
   TUI/CLI smoke.
5. **70 cli.ts blocks in one commit is not independently reviewable** — batched.
6. **DOX root index gap** — `src/agent/` and `src/cli/` were unlisted.
