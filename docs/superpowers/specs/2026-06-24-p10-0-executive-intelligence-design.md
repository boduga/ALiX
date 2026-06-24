# P10.0 — Executive Intelligence Foundation

> **Status:** SDS approved
> **Spec home:** `docs/superpowers/specs/2026-06-24-p10-0-executive-intelligence-design.md`
> **Plan home (on approval):** `docs/superpowers/plans/2026-06-24-p10-0-executive-intelligence.md`
> **Governs:** branch from `main` at HEAD.
> **Risk level:** Low — read-only foundation; Tier-1 reuse; Tier-2 adapters are thin.

## Core framing

P10.0 is the **executive layer** that answers "What should ALiX focus on next?" — replacing per-subsystem dashboards with a single ranked attention queue. 8 subsystems (governance, learning, adaptation, agents, tools, workflow, memory, security) are scored 0–100, sorted ascending (worst first), and the worst 3 surface as executive priorities.

This is the moment ALiX stops being a governance system and becomes an executive system. P9 closed a complete governance feedback loop (Analyze → Recommend → Propose → Approve → Apply → Observe). P10 adds the question that closes the loop: *where should we focus next?*

## Architectural principle (3 tiers)

**ALiX subsystems own their own health models. The executive layer only aggregates.**

- **Tier 1 — Subsystem-owned health (reuse existing builders).** No new code; read from existing P8/P9 dashboards.
- **Tier 2 — Lightweight P10 adapters (new, thin).** Small per-subsystem health queries for subsystems without a dashboard.
- **Tier 3 — Executive aggregator (new).** Fans out to all health sources in parallel, normalizes into 8 subsystem scores, sorts worst-first.

## The 8 subsystems

| # | Subsystem | Executive question | Tier |
|---|-----------|---------------------|------|
| 1 | Governance | "Are decisions sound?" | 1 |
| 2 | Learning | "Is ALiX improving?" | 1 |
| 3 | Adaptation | "Can ALiX safely change itself?" | 2 |
| 4 | Agents | "Are agents effective?" | 2 |
| 5 | Tools | "Can ALiX act on the world?" | 2 |
| 6 | Workflow | "Are processes executing?" | 2 |
| 7 | Memory | "Does ALiX remember?" | 2 |
| 8 | Security | "Can ALiX be trusted?" | 2 |

**Why Memory and Security are first-class:** Memory determines knowledge retention, retrieval quality, context continuity, learning effectiveness, and agent coordination. Security is operational trust — a system can be highly capable but unsafe, and P10 should surface that immediately.

## Tier 1 — Subsystem-owned health (reuse)

| Subsystem | Source | Score field |
|-----------|--------|-------------|
| Governance | `buildGovernanceHealth` (P9.0a) + `buildGovernanceAssessment` (P9.0a) | `governanceConfidence` (assessment) or `health.supportedKinds * 20` fallback |
| Learning | `buildDashboardReport` from P8.5b `learning-dashboard.ts` | `dashboardIntegrityScore` |

No new code for Tier 1. The aggregator reads these existing builders and extracts the score.

## Tier 2 — Lightweight P10 adapters (new, thin)

Each adapter is ~50 lines. Pure read function, computes a 0–100 score from subsystem-specific sources, returns a small typed report.

| Adapter | Source signals | Score formula |
|---------|----------------|---------------|
| `buildAgentHealth` | capability success rate, coverage from `capability-evolution-store` | `successRate * 100` |
| `buildToolHealth` | tool failure rate from execution telemetry | `100 - failureRate * 100` |
| `buildWorkflowHealth` | workflow execution success from workflow stores | `successRate * 100` |
| `buildMemoryHealth` | episodic recall rate, retrieval accuracy, orphaned memories | weighted composite |
| `buildSecurityHealth` | finding count by severity from `security/` | `100 - weighted(severity counts)` |
| `buildAdaptationHealth` | proposal success rate, revert rate from `adaptation/` | `successRate * 100 - revertPenalty` |

Each adapter lives in `src/executive/adapters/<name>-health.ts`. The aggregator imports them but does not need to know their internals.

## Tier 3 — Executive aggregator (new)

`buildExecutiveHealthReport(opts)` in `src/executive/executive-health.ts`.

```ts
export async function buildExecutiveHealthReport(opts: {
  cwd: string;
  windowDays?: number;
  generatedAt?: string;
}): Promise<ExecutiveHealthReport>
```

Fans out to all health sources in parallel with `Promise.all` + `.catch(() => null)`, then **normalizes into 8 subsystem scores**:

```ts
const [gov, govAssessment, learn, adaptation, agents, tools, workflow, memory, security] = await Promise.all([
  buildGovernanceHealth(...).catch(() => null),
  buildGovernanceAssessment(...).catch(() => null),
  buildDashboardReport(...).catch(() => null),
  buildAdaptationHealth(...).catch(() => null),
  buildAgentHealth(...).catch(() => null),
  buildToolHealth(...).catch(() => null),
  buildWorkflowHealth(...).catch(() => null),
  buildMemoryHealth(...).catch(() => null),
  buildSecurityHealth(...).catch(() => null),
]);
```

Note: 9 health-source calls produce 8 subsystem scores (governance combines 2 sources).

**Score → status mapping:**
- `score < 60` → `critical` 🔴
- `60 <= score < 80` → `warning` 🟡
- `score >= 80` → `healthy` 🟢

**Sort:** ascending (worst first). A subsystem that fails to compute (null) is reported as `score: 0, status: "critical", summary: "<subsystem> unavailable"`.

## The 2 panels

**Panel 0 — Executive Health Summary**

```
Executive Health Summary
Overall Score: 78

Subsystem      Score   Status
Tools          54      🔴 critical
Memory         68      🟡 warning
Learning       76      🟡 warning
Workflow       79      🟡 warning
Agents         82      🟢 healthy
Adaptation     88      🟢 healthy
Governance     91      🟢 healthy
Security       95      🟢 healthy
```

**Panel 1 — Executive Priorities** (top 3 worst subsystems)

```
Executive Priorities

1. Tools
   Tool failure rate elevated.

2. Memory
   Retrieval quality below target.

3. Learning
   Recommendation acceptance declining.
```

## Architecture (3 layers, mirrors P8.5b + P9.5)

### 1. Aggregator — `src/executive/executive-health.ts`

Pure read-only function. The single boundary that touches the data layer. Returns a typed, JSON-serializable `ExecutiveHealthReport`.

### 2. Renderer — `src/cli/commands/executive-dashboard-renderer.ts`

Terminal formatter. Consumes the typed report. Renders 2 panels in fixed order. No data access.

### 3. CLI dispatcher — `src/cli/commands/executive.ts` (NEW) + `src/cli/commands/executive-dashboard-handler.ts` (NEW) + `src/cli.ts` (MODIFY)

- `src/cli/commands/executive.ts` — top-level executive subcommand dispatcher (mirrors `governance.ts`). Registers `dashboard` and future subcommands.
- `src/cli/commands/executive-dashboard-handler.ts` — extracted `runDashboard` handler (sentinel scoping, mirrors `governance-dashboard-handler.ts`).
- `src/cli.ts` — add `if (command === "executive")` block that dynamic-imports `./cli/commands/executive.js`, mirroring how `governance` is currently wired.

`alix executive dashboard [--window <days>] [--json]`

## Type sketch

```ts
export interface ExecutiveSubsystemHealth {
  subsystem: "governance" | "learning" | "adaptation" | "agents" | "tools" | "workflow" | "memory" | "security";
  score: number;          // 0..100
  status: "healthy" | "warning" | "critical";
  summary: string;        // one-line description of current state
  topIssues: string[];    // up to 3 short issue labels
}

export interface ExecutiveHealthReport {
  schemaVersion: "p10.0.0";
  generatedAt: string;
  windowDays: number;
  overallScore: number;
  rankedSubsystems: ExecutiveSubsystemHealth[];  // worst-first, 8 entries
}
```

## Core invariants

1. **Read-only.** ExecutiveHealthReport NEVER writes to any store, file, or evidence chain. The aggregator is the boundary.
2. **JSON-serializable.** Same as P9.5. `schemaVersion = "p10.0.0"`.
3. **Resilience.** Each health-source call is wrapped in `.catch(() => null)`. A single failure doesn't crash the report.
4. **Subsystem-owned.** Tier-1 sources are read from existing dashboards; Tier-2 adapters are thin and read from underlying stores only. The executive layer does not re-derive subsystem health.
5. **P10.0 stays read-only.** No proposals, no approval, no apply paths. Same scope discipline as P9.0–P9.5.

## Sentinel

`tests/executive/executive-sentinels.vitest.ts` — single sentinel scanning the P10.0 executive files: aggregator, adapters, renderer, handler, dispatcher. **One sentinel for the whole P10.0 slice.**

```ts
const EXECUTIVE_FILES = [
  "src/executive/executive-health.ts",
  "src/executive/adapters/agent-health.ts",
  "src/executive/adapters/tool-health.ts",
  "src/executive/adapters/workflow-health.ts",
  "src/executive/adapters/memory-health.ts",
  "src/executive/adapters/security-health.ts",
  "src/executive/adapters/adaptation-health.ts",
  "src/cli/commands/executive-dashboard-renderer.ts",
  "src/cli/commands/executive-dashboard-handler.ts",
  "src/cli/commands/executive.ts",
];

const FORBIDDEN_IN_EXECUTIVE = [
  // Mutation appliers
  "GovernanceChangeApplier",
  "AgentCardApplier",
  "SkillApplier",
  "RevertApplier",
  // Approval / apply / reject verbs
  ".approve(",
  ".apply(",
  ".reject(",
  // Mutation-write stores
  "ProposalStore.save",
  "ProposalStore.markOrphaned",
  // Evidence write methods
  "recordGovernanceMutationApplied",
  "recordAdaptationApproved",
  "recordAdaptationApplied",
  "recordAdaptationRejected",
  "recordAdaptationFailed",
  "recordRevertApplied",
  "recordRevertFailed",
];
```

The check enforces: the 10 P10.0 files do not import any of these symbols. It does **NOT** forbid importing `ProposalStore`, `GovernanceStore`, or `SnapshotStore` for **read** operations (`.list`, `.load`, etc.). Structural enforcement of the read-only invariant.

## File layout (15 files)

| # | Path | Action | Purpose |
|---|------|--------|---------|
| 1 | `src/executive/executive-health.ts` | NEW | Aggregator + types |
| 2 | `src/executive/adapters/agent-health.ts` | NEW | Tier-2 adapter |
| 3 | `src/executive/adapters/tool-health.ts` | NEW | Tier-2 adapter |
| 4 | `src/executive/adapters/workflow-health.ts` | NEW | Tier-2 adapter |
| 5 | `src/executive/adapters/memory-health.ts` | NEW | Tier-2 adapter |
| 6 | `src/executive/adapters/security-health.ts` | NEW | Tier-2 adapter |
| 7 | `src/executive/adapters/adaptation-health.ts` | NEW | Tier-2 adapter |
| 8 | `src/cli/commands/executive.ts` | NEW | Top-level executive subcommand dispatcher |
| 9 | `src/cli/commands/executive-dashboard-renderer.ts` | NEW | Terminal formatter |
| 10 | `src/cli/commands/executive-dashboard-handler.ts` | NEW | `runDashboard` handler (sentinel scoping) |
| 11 | `src/cli.ts` | MODIFY | Add `executive` top-level command |
| 12 | `tests/executive/executive-health.vitest.ts` | NEW | 7-9 aggregator tests |
| 13 | `tests/cli/commands/executive-dashboard-cli.vitest.ts` | NEW | 2-3 CLI tests |
| 14 | `tests/executive/executive-sentinels.vitest.ts` | NEW | Purity sentinel (10 files scanned) |
| 15 | `docs/superpowers/specs/2026-06-24-p10-0-executive-intelligence-design.md` | NEW | This spec |
| (16) | `docs/superpowers/plans/2026-06-24-p10-0-executive-intelligence.md` | NEW | Implementation plan (post-approval) |

**Total: 16 deliverables.** The table above includes the spec and the (post-approval) plan rows.

## Testing

### Unit tests (7-9) — `tests/executive/executive-health.vitest.ts`

1. Schema version `p10.0.0` and basic shape
2. 8 subsystems always present in `rankedSubsystems`
3. Worst-first sort order (lowest score at index 0)
4. Score → status mapping (boundary tests at 60, 80)
5. Overall score is the unweighted mean of subsystem scores
6. Failed health source → subsystem marked `score: 0, status: "critical", summary: "<subsystem> unavailable"`
7. JSON output is valid and contains all 8 subsystem names
8. Empty state (all health sources return null) — 8 critical entries
9. Governance combines 2 sources (governance health + governance assessment)

### CLI integration tests (2-3) — `tests/cli/commands/executive-dashboard-cli.vitest.ts`

1. `alix executive dashboard` — text mode renders 2 panel headers
2. `alix executive dashboard --json` — valid JSON with expected keys
3. `alix executive dashboard --window 7` — windowDays respected

### Sentinel test — `tests/executive/executive-sentinels.vitest.ts`

For each of the 10 P10.0 files, scan for any forbidden symbol. Fail with file:line if found.

## Explicitly out of scope (P10.0)

- **Priority engine scoring (P10.1).** Sort is by raw score. P10.1 adds weighted scoring across subsystems.
- **Objective generator (P10.2).** No "executive recommendations" yet — just the ranked view.
- **Drill-down panels per subsystem.** Out of scope; P10.0 is intentionally sharp (2 panels).
- **Executive proposals / approve / apply.** No mutation paths yet; P10 stays read-only.
- **P9.6 InvestigationRecommendation integration.** Deferred — P9.6 becomes a consumer of P10.1.
- **Trend / window comparison.** Single window only in P10.0.

## Tag and PR conventions

- Branch: `feature/p10-0-executive-intelligence`
- PR title: `P10.0 — Executive Intelligence Foundation (8 subsystems, 2 panels)`
- Tag on merge: `alix-p10-0-complete`
