<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **ALiX** (84849 symbols, 190282 relationships, 1138 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/ALiX/context` | Codebase overview, check index freshness |
| `gitnexus://repo/ALiX/clusters` | All functional areas |
| `gitnexus://repo/ALiX/processes` | All execution flows |
| `gitnexus://repo/ALiX/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# DOX — Durable Operating Contract

DOX is a hierarchical AGENTS.md framework. Every agent must follow DOX instructions across any edit.

## Core Contract

- Root AGENTS.md is the single repository-wide instruction source; keep agent guidance here and in its indexed child AGENTS.md files.
- AGENTS.md files are binding work contracts for their subtrees.
- Work products, source materials, instructions, records, assets, and durable docs must stay understandable from the nearest applicable AGENTS.md plus every parent AGENTS.md above it.

## Read Before Editing

1. Read the root AGENTS.md.
2. Identify every file or folder you expect to touch.
3. Walk from the repository root to each target path.
4. Read every AGENTS.md found along each route.
5. If a parent AGENTS.md lists a child AGENTS.md whose scope contains the path, read that child and continue from there.
6. Use the nearest AGENTS.md as the local contract and parent docs for repo-wide rules.
7. If docs conflict, the closer doc controls local work details, but no child doc may weaken DOX.

Do not rely on memory. Re-read the applicable DOX chain in the current session before editing.

## Update After Editing

Every meaningful change requires a DOX pass before the task is done.

Update the closest owning AGENTS.md when a change affects:

- purpose, scope, ownership, or responsibilities
- durable structure, contracts, workflows, or operating rules
- required inputs, outputs, permissions, constraints, side effects, or artifacts
- user preferences about behavior, communication, process, organization, or quality
- AGENTS.md creation, deletion, move, rename, or index contents

Update parent docs when parent-level structure, ownership, workflow, or child index changes. Update child docs when parent changes alter local rules. Remove stale or contradictory text immediately. Small edits that do not change behavior or contracts may leave docs unchanged, but the DOX pass still must happen.

## Hierarchy

- Root AGENTS.md is the DOX rail: project-wide instructions, global preferences, durable workflow rules, and the top-level Child DOX Index.
- Child AGENTS.md files own domain-specific instructions and their own Child DOX Index.
- Each parent explains what its direct children cover and what stays owned by the parent.
- The closer a doc is to the work, the more specific and practical it must be.

## Child Doc Shape

Create a child AGENTS.md when a folder becomes a durable boundary with its own purpose, rules, responsibilities, workflow, materials, or quality standards.

Default section order:

1. **Purpose** — what this subsystem does
2. **Ownership** — key files and their responsibilities
3. **Local Contracts** — conventions, invariants, design decisions
4. **Work Guidance** — how to work in this area
5. **Verification** — how to test changes
6. **Child DOX Index** — list of child AGENTS.md files

## Style

- Keep docs concise, current, and operational.
- Document stable contracts, not diary entries.
- Put broad rules in parent docs and concrete details in child docs.
- Prefer direct bullets with explicit names.
- Do not duplicate rules across many files unless each scope needs a local version.
- Delete stale notes instead of explaining history.
- Trim obvious statements, repeated rules, misplaced detail, and warnings for risks that no longer exist.

## Closeout

- Re-check changed paths against the DOX chain.
- Update nearest owning docs and any affected parents or children.
- Refresh every affected Child DOX Index.
- Remove stale or contradictory text.
- Run existing verification when relevant.
- Report any docs intentionally left unchanged and why.

## Operator Preferences

- Record durable user preferences in the closest owning DOX file.
- EGM is the sole agent workflow framework. Use its installed skills for brainstorming, drafting, review, resolution, drift reports, and bootstrap when applicable; use direct tools for routine work outside those workflows.
- Do not invoke other skills or layer competing planning, review, delegation, or communication frameworks onto EGM unless the operator explicitly requests an exception. Communicate in clear, natural language.
- Repository safety, GitNexus graph checks, DOX maintenance, and verification contracts remain required supporting checks; use their tools directly rather than invoking competing skills. This preference supersedes older skill-selection guidance throughout the repository.
- Discover EGM from the installed plugin inventory and read the selected skill plus its bundled Codex integration before use. Preserve its human decision gates and fresh-context Goldfish isolation; report unavailable capabilities rather than substituting another framework.
- Use CLI-first workflows for approvals and audit.
- Commit early, push often; tag baseline milestones.
- **Solo-maintainer development workflow:** Coding agents operate in isolated worktrees with scoped branches; use Conventional Commits PR titles, record independent agent review and CI evidence, and do not treat agent review as human security signoff. No direct push to protected `main`, no bypass of GitHub checks, and no deletion of backup/review/evidence branches without operator approval. See `CONTRIBUTING.md`.
- **One feature branch → one primary PR → review → merge.** Reuse the existing branch/PR for incremental work in the same feature. Do not create stacked or milestone-per-test PRs by default; use an explicitly justified independent branch only for separately reviewable, independently mergeable work.
- Before branching or opening a PR, inspect `git status`, worktrees, existing branches/PRs, their bases, and ancestry; never overwrite another worktree or silently discard edits. Check the entire integration diff, not only GitHub's per-PR mergeable status.
- Before merging, verify the exact base/head and merge simulation, relevant checks/tests, and architecture/security gates. Merge only after required review and approval; a conflict-free merge does not grant security or production release. Retain existing branches unless the operator expressly approves deletion.
- For the complete PR lifecycle (including consolidation, closeout and branch preservation), follow `docs/agents/issue-tracker.md`.
- Provider secrets (incl. Langfuse keys) live in the credential store (`~/.config/alix/config.json` `apiKeys`), never in env files or the repo. Rotation = update store entries; no code or config-file changes needed.
- Real-model tests and harnesses resolve the operator's CURRENT default model (`models.default` in `~/.config/alix/config.json`); never hardcode a provider/model in a test, driver, or fixture. An explicit override is allowed only for a deliberate one-off, not as a checked-in default.

## Runtime Contracts

Compact index. Each contract is owned by the child DOX file below; read the owner before editing that area. Only rules that govern every subtree stay here.

- **Node runtime floor.** ALiX requires Node.js 26.4.0 or newer for installation and execution; `.nvmrc` and CI pin a tested Node 26 release. The global CLI launcher, daemon, and coordination children use the current Node executable. Keep release packaging and cross-platform CI on the supported runtime. The bin launcher passes `--experimental-ffi` to its child only for `alix tui --renderer opentui`; the selected native renderer owns its terminal on an interactive TTY, while the ANSI canvas remains the default.
- **Unused-code gate is src-scoped.** `pnpm typecheck:unused` (`tsconfig.unused.json`, noUnusedLocals/noUnusedParameters, `include: src/**`) is a CI gate. Keep it at zero: no unused locals, parameters, imports, or private members under `src/`. Prefix deliberately-unused parameters with `_`. `pnpm check:dead` (`scripts/check-dead-modules.mjs`) complements it by flagging src modules with no importers; add legitimate entry points/barrels to its allowlist with a reason.
- **Subsystem boundaries are gated.** `tests/architecture/r1-boundary-freeze.test.ts` pins imports of protected files; `tests/architecture/layer-boundaries.test.ts` pins the direction of value imports between the 12 subsystems (static `import`/`export … from` and dynamic `import()`; type-only forms exempt). Both allowlists (`r1-allowlist.json`, `layer-allowlist.json`) are shrink-only with R0 refs + removal phases: a new violation fails and a stale entry fails. Shared scanner helpers live in `tests/architecture/freeze-utils.ts`.
- **Authorization changes get a parity check, never a spot check.** Any change to what an allow/deny/owned decision AUTHORIZES must add or update explicit expected outcomes in a table broader than the implementation. A spot check on the new cases proves the new cases work and says nothing about what stopped working. Parity table: `tests/ownership/path-scope.test.ts`.

| Contract area | Owner |
|---------------|-------|
| Exact model-facing tool names; MCP handles; search-name vs. callable-name split | `src/agents/AGENTS.md`, `src/capabilities/tools/AGENTS.md` |
| Agent lifetime, progress liveness, operator cancellation, self-awareness, fetched-content trust | `src/agents/AGENTS.md` |
| Store-only key resolution, credential-scoped exits, spawned-worker credential pipe | `src/governance/security/credentials/AGENTS.md` |
| Operator principal identity and the Inspector authentication matrix | `src/governance/security/inspector/AGENTS.md` |
| Safe-shell containment and exclusion predicates, shell network policy, first-party state reads, read-only search, tool-result rendering, failed MCP registration, patch syntax | `src/capabilities/tools/AGENTS.md` |
| Read-only execution filter and surface block notice | `src/execution/run/task-loop/AGENTS.md` |
| Verification isolation | `src/capabilities/skills/AGENTS.md` |
| Mutation/verification evidence, completion gates, iteration accounting, claim substantiation, durable progress, bounded automatic verification, scoping ranking | `src/execution/run/task-loop/AGENTS.md` |
| Delegated execution: approval host parity, Inspector execution endpoints, completion receipts, worker recovery and owned writes, cancellation, hosting, approval-mode clamp, single-output recovery, worker tool/input identity | `src/coordination/AGENTS.md` |
| Single-use approval consumption and post-claim outcome | `src/governance/approvals/AGENTS.md` |
| Session persistence interactivity | `src/agents/agent/session/AGENTS.md` |
| Review verdict and PR scope | `docs/reviews/AGENTS.md`, `scripts/AGENTS.md` |
| Preflight, checker pins, DOX claim verification, staleness sentinel, evidence gates | `scripts/AGENTS.md` |

## opensrc — Source Code Context

Dependency source code may be cached via opensrc. When available, .opensrc/repos links to the user cache for project-local access.

Use `npx opensrc path <org/repo>` to get the absolute path, or reference opensrc
by name when asking about implementation details — the source code is available
locally and provides the ground truth for any API or framework.

Known dependency cache locations (verify availability before use; .opensrc/repos → ~/.opensrc/repos):

- microsoft/typescript — .opensrc/repos/github.com/microsoft/typescript/main/
- facebook/react — .opensrc/repos/github.com/facebook/react/main/
- lukeed/ms — .opensrc/repos/github.com/lukeed/ms/master/
- pewdiepie-archdaemon/odysseus — .opensrc/repos/github.com/pewdiepie-archdaemon/odysseus/dev/

Add more with: `npx opensrc fetch <org/repo>`

## Agent skills

### Context optimization (operator-requested exception)

- When a task is context- or token-heavy, load `.agents/skills/context-optimization/SKILL.md` on demand; use its observation masking, scoped retrieval, compaction, and caching guidance. This is a context-efficiency aid, not a replacement for EGM, DOX, security gates, or verification.
- Preserve full logs and security evidence in durable files; concise summaries must retain exact references and unresolved failures. Measure token and quality outcomes before claiming savings.
- ChatGPT Work may use the skill when it can read this repository, but repository installation alone does not enable automatic skill discovery or background execution in Work.

### Issue tracker

Issues and PRDs live as GitHub issues (repo `boduga/ALiX`); use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles map to `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: read CONTEXT.md at the repo root and docs/adr/ when they exist; proceed silently if absent. See `docs/agents/domain.md`.

## Child DOX Index

| Path | Scope |
|------|-------|
| `src/capabilities/tools/AGENTS.md` | The model-callable tool surface — registry/capability cards, routers, `ToolExecutor` (policy gate then router), safe shell, bound collaboration tools |
| `src/coordination/AGENTS.md` | Delegated execution contracts — approval host parity, Inspector execution endpoints, completion receipts, worker recovery/owned writes, cancellation, hosting, approval-mode clamping |
| `src/coordination/ownership/AGENTS.md` | Ownership claims and path-scope arithmetic — the registry/lock, and the owned-scope matcher both the policy gate and the file router must share |
| `src/coordination/kernel/AGENTS.md` | Graph execution engine — TaskGraph, GraphExecutor, projection, planner, coordination (planner/scheduler/tools/subagent executor) |
| `src/operations/prompts/AGENTS.md` | Prompt registry — static prompt ids, versions, token accounting, snapshot hashes |
| `src/governance/policy/AGENTS.md` | Policy rules, RuleEvaluator, RuntimeGate, default policies, loader |
| `src/governance/security/supply-chain/AGENTS.md` | Supply-chain gates — advisory exceptions, lifecycle-script approvals, dependency overrides, tarball verification |
| `src/capabilities/registry/AGENTS.md` | Agent/tool cards, CardRegistry, CapabilityResolver, card loader |
| `src/runtime-state/contracts/AGENTS.md` | Type-only authority boundaries — domain schemas, R1 ports, R2 runtime-event envelope, barrel |
| `src/governance/approvals/AGENTS.md` | Approval queue, ApprovalStore |
| `src/runtime-state/events/AGENTS.md` | Session event log — append authority, cross-process lock, bounded tail resync, seq allocation |
| `src/governance/audit/AGENTS.md` | Audit trail — JSONL append-only store |
| `src/governance/security/credentials/AGENTS.md` | Credential Store — protected secret storage and the versioned `srap-evidence` HMAC-key namespace |
| `src/governance/security/inspector/AGENTS.md` | Inspector auth + operator principals — hash-only token store, principal store, credential→principal binding, authentication matrix, cross-process store lock |
| `src/runtime-state/storage/AGENTS.md` | Storage primitives — shared JSONL store/parser/stream, atomic JSON files, R2 transactional runtime ledger |
| `src/interfaces/server/AGENTS.md` | Inspector HTTP server, session reader, API routes |
| `src/interfaces/ui/AGENTS.md` | Inspector web UI — HTML, JS, CSS, projection |
| `src/operations/daemon/AGENTS.md` | Runtime daemon — manager, socket server, task registry, protocol |
| `src/session/AGENTS.md` | Session persistence — messages/scope/state artifacts backed by the R2 ledger, session reconcile |
| `src/runtime-state/runtime/AGENTS.md` | Runtime — execution-state, state-aware context builder, unified event index |
| `src/execution/run/task-loop/AGENTS.md` | Task loop — session-lifecycle/predicates/context-helpers/main submodules (`runTaskLoop`) |
| `src/agents/agent/session/AGENTS.md` | Agent session — types/helpers/setup/main submodules (`AgentSessionBuilder`) |
| `src/context/repomap/AGENTS.md` | RepoMap + semantic context — embedding model lifecycle, vector-space cache namespacing, CPU/offline inference contracts |
| `src/agents/AGENTS.md` | Agent tool naming, policy, and subagent CLI boundaries |
| `src/operations/observability/AGENTS.md` | Observability platform — metrics, telemetry, diagnostics, alerts, cost, health |
| `src/operations/utils/memory/AGENTS.md` | Agent memory store — persistence, recall, consolidation, decision extraction |
| `src/operations/evals/AGENTS.md` | Behavioral eval suite — scripted provider, drivers, evaluators, cases, runner, `alix evals` |
| `src/operations/schedule/AGENTS.md` | Agent-proposed scheduled jobs — spec, store, propose (approval-gated), daemon tick |
| `src/capabilities/skills/AGENTS.md` | Skill lifecycle — dispatch, factory distillation (prose + trace evidence), promotion |
| `src/interfaces/cli/commands/skills/AGENTS.md` | `alix skills` CLI surface — routing, install/run, distill-from-traces |
| `src/interfaces/cli/commands/security/AGENTS.md` | Security CLI handlers — security/inspector-auth/audit/credential/supply-chain submodules |
| `src/interfaces/cli/commands/adaptation/AGENTS.md` | Adaptation CLI handlers — shared/appliers/renderers/handlers/main submodules |
| `src/interfaces/cli/commands/governance/AGENTS.md` | Governance CLI handlers — shared/evolution/status/lifecycle/investigation/analytics/inbox/actions/execution/workbench/readiness/handoff/intelligence/audit/audit-insights/main submodules |
| `src/interfaces/cli/commands/decision/AGENTS.md` | Decision CLI handlers — shared/context-risk/queue-brief/review/outcome/intent/main submodules |
| `src/interfaces/cli/commands/jev/AGENTS.md` | `alix jev` — decision-subsystem operator surface (status, labels, calibration, profiles, replay, disagreements, label-pair) |
| `src/planning/decision/AGENTS.md` | Bounded probabilistic decisions (Jev System One) — contracts, engine registry, config, four decisions, calibration, replay |
| `src/planning/adaptation/AGENTS.md` | P6 governance pipeline (context → risk → recommendation → queue) + P6.5 governance-review council — lens JSON contract, enrichment semantics, no decision authority |
| `src/models/providers/AGENTS.md` | Model adapters & routing — registry, specs, free-model resolver, capacity-aware routing, OpenRouter access classification |
| `src/interfaces/tui/AGENTS.md` | Interactive terminal UI — projections, Workbench transcript, views, input, layout, rendering |
| `src/models/tracing/AGENTS.md` | Langfuse tracing facade — TraceClient, noop client, capture policy, adapter |
| `benchmark/AGENTS.md` | Benchmark harness history vs summary vs state vs hybrid — deterministic maintenance/reconciliation, FakeModel substrate isolation, 4-group metrics |
| `docs/AGENTS.md` | Durable documentation — dated hand-off records at the docs root, the pre-2.0/Master PRD tree and harness deliverables, plus pointers to the agent/architecture/audits/superpowers/jev subtrees |
| `docs/superpowers/AGENTS.md` | Implementation specs and plans |
| `docs/jev/AGENTS.md` | Jev / System One integration docs — design spec, delivery plan, current status |
| `experiments/opentui/AGENTS.md` | Isolated OpenTUI runtime spike — pinned fixture, in-memory tests, PTY checks, diagnostic benchmark |
| `scripts/srap-accept/AGENTS.md` | SRAP-G3-ACCEPT acceptance fixture — isolated credential seeders, loopback TLS/denial proxies, offline mock model server |
| `scripts/AGENTS.md` | Repository gates — preflight, PR scope, review evidence, DOX claims, staleness, evidence integrity, checker pins |
