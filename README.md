# ALiX — Agent Operating System

**Agentic Lifecycle & Intelligence eXchange**

A local-first AI Agent OS. Run tasks, enforce policies, approve actions, audit everything, and persist work across sessions.

```bash
npm install -g alix
alix models set-default
alix run "explain the architecture of this project"
```

---

## System Overview

ALiX is a local-first Agent OS. One process entry surface dispatches work into a
layered runtime, and every system mutation has to pass a human gate before it can
change anything durable.

- **Entry and process surface** — [src/cli.ts:COMMAND_ROUTER], [src/run.ts:runTask], and the shared task taxonomy in [src/task-classifier.ts:classifyTask].
- **Agent execution** — agent turns, sessions, and subagent dispatch in [./src/agents/README.md](./src/agents/README.md), the task loop and read-only surface in [./src/execution/README.md](./src/execution/README.md), and coordinated multi-worker runs in [./src/coordination/README.md](./src/coordination/README.md).
- **Capability and tool surface** — capability resolution, policy-filtered tool offers, and per-channel routing in [./src/capabilities/README.md](./src/capabilities/README.md).
- **Context, models, and configuration** — context compilation and RepoMap in [./src/context/README.md](./src/context/README.md), provider adapters and model resolution in [./src/models/README.md](./src/models/README.md), and config truth in [./src/operations/config/README.md](./src/operations/config/README.md).
- **Governance and security** — policy verdicts, the approval queue, audit, and credential handling in [./src/governance/README.md](./src/governance/README.md).
- **Planning and governed evolution** — plan generation and the propose → approve → apply lifecycle in [./src/planning/README.md](./src/planning/README.md).
- **Persistence and state** — sessions, runtime events, and leases in [./src/session/README.md](./src/session/README.md) and [./src/runtime-state/README.md](./src/runtime-state/README.md), with the SQLite kernel in [./src/operations/db/README.md](./src/operations/db/README.md).
- **Operator interfaces** — CLI commands, the TUI, and the loopback Inspector server in [./src/interfaces/README.md](./src/interfaces/README.md).
- **Operational harnesses** — daemon, hooks, scheduling, observability, evals, and benchmarks in [./src/operations/README.md](./src/operations/README.md).

A request flows from an operator interface into run orchestration, which offers
tools and capabilities under governance, then records results in session and
runtime state. Plans and proposals are produced without mutating the workspace;
a separate human approval and a separate apply step are what authorize a change.
Agent turns have no wall-clock deadline — liveness is progress-based.

## Subdirectories & System Boundaries

`docs/architecture/runtime-spine.md` is the authoritative cross-subsystem trace;
`docs/architecture/overview.md` covers the 12-subsystem / 4-layer split and the
guard tests that pin it. Each subsystem publishes its own contract:

- [./src/README.md](./src/README.md) — source root: process entry, version constant, and the task taxonomy every layer shares.
- [./src/agents/README.md](./src/agents/README.md) — model-facing tool names from [src/agents/tool-manifest.ts:ALIX_BUILTIN_EXECUTORS], role policy, and subagent qualification.
- [./src/capabilities/README.md](./src/capabilities/README.md) — capability registry, tool executor, and first-party state read tools.
- [./src/context/README.md](./src/context/README.md) — context compilation, RepoMap, embeddings, and provider-based baseline facts.
- [./src/coordination/README.md](./src/coordination/README.md) — coordination runs, worker scheduling, owned scope, aggregates, and conflict detection.
- [./src/execution/README.md](./src/execution/README.md) — run orchestration, the task loop, completion evidence, and the read-only surface derived by [src/execution/run/helpers.ts:buildReadOnlyToolFilter].
- [./src/governance/README.md](./src/governance/README.md) — policy gate, approval store ([src/governance/approvals/approval-store.ts:ApprovalStore]), audit, and Inspector authentication.
- [./src/interfaces/README.md](./src/interfaces/README.md) — CLI, TUI, and the Inspector server entry [src/interfaces/server/server.ts:startServer].
- [./src/models/README.md](./src/models/README.md) — provider adapters, model catalogs, tiers, and local inference.
- [./src/operations/README.md](./src/operations/README.md) — config loading via [src/operations/config/loader.ts:loadConfig], daemon [src/operations/daemon/daemon-manager.ts:DaemonManager], database [src/operations/db/manager.ts:DatabaseManager], hooks, schedule, observability, evals, benchmarks.
- [./src/planning/README.md](./src/planning/README.md) — plan mode, plans, and the governed adaptation lifecycle.
- [./src/runtime-state/README.md](./src/runtime-state/README.md) — event kernel, runtime ledger [src/runtime-state/storage/runtime-ledger.ts:RuntimeLedger], ownership leases, and state query.
- [./src/session/README.md](./src/session/README.md) — append-first session records, resume, and session-scoped mutation state.

Boundaries enforced by test: `tests/architecture/layer-boundaries.test.ts` pins
the direction of value imports between subsystems, and
`tests/architecture/r1-boundary-freeze.test.ts` pins imports of protected files.

## Global Invariants

- **Exact model-facing tool names.** A turn may call only exact `alix_*` names offered in that turn, resolved through `ALIX_BUILTIN_EXECUTORS`; aliases, executor ids, and guessed names are rejected [src/agents/tool-manifest.ts:ALIX_BUILTIN_EXECUTORS].
- **Store-only API key resolution.** Provider keys come from `~/.config/alix/config.json` `apiKeys` (literals or `cred://` references). Environment variables are never consulted at a resolution site; resolved keys are only injected into the process *after* load so provider SDKs work [src/operations/config/loader.ts:loadConfig].
- **Governance gates are separate acts.** Generate ≠ approve, approve ≠ apply, apply ≠ mutate, observe ≠ revert. Approvals are single-use: a cited approval is claimed exactly once before any router runs, and a replay fails closed [src/governance/approvals/approval-store.ts:ApprovalStore].
- **Project config overrides user config, and project config wins on conflict.** `~/.config/alix/config.json` is read first, `<cwd>/.alix/config.json` second; an unresolved `cred://` reference throws [src/operations/config/loader.ts:loadConfig].
- **Read-only scopes are contained.** One derivation, [src/execution/run/helpers.ts:buildReadOnlyToolFilter], produces the read-only offer surface and withholds `alix_shell_run`; both the agent loop and session setup use it instead of hand-built copies.
- **Workspace containment and network policy apply to shell clients.** Every filesystem operand admitted by the safe-shell grammar passes workspace path resolution, and shell network clients are held to the same domain allowlist as `alix_web_fetch`. A sensitive-path denial is a hard denial and is never escalated to an approval prompt.
- **Unlimited agent lifetime, progress-based liveness.** No wall-clock deadline on an agent turn; a stalled run is surfaced as an event and a TUI warning, never auto-terminated. Provider streaming is idle-timeout-only.
- **Completion requires executed evidence.** For objectives that require mutation or post-change verification, prose and `alix_done` are insufficient: only successful mutation results count, and verification must succeed after the mutation. A coordination run is successful only when terminal execution, a generated aggregate, a known outcome, and the matching aggregate-completion event all line up.
- **Verification runs on the real tree.** Verification isolation refuses non-sandbox roots and runs in place rather than stashing the working tree.
- **Repository contracts are mandatory.** GitNexus `impact` before editing a symbol, `detect-changes` before committing, and a DOX pass on the applicable `AGENTS.md` chain after editing.
- **Runtime floor.** Node.js 26.4.0 or newer; `ALIX_VERSION = "0.6.0"` is the single version literal [src/index.ts:ALIX_VERSION].

## Global Side Effects

- **Project-local state** under `<cwd>/.alix/`: project config [src/operations/config/loader.ts:loadConfig], plus sessions, plans, approvals, audit, governance stores, memory, embeddings, benchmarks, graphs, and ownership leases written by their owning subsystems.
- **User-global state** under `~/.alix/`: the SQLite kernel database ([src/operations/db/manager.ts:DatabaseManager] opens `~/.alix/alix.db` with WAL journaling and foreign keys on), daemon socket and PID/status files, scheduled tasks, and workflow skills; configuration lives separately in `~/.config/alix/`.
- **Append-only records.** Audit, runtime events, metrics, and session event logs are append-oriented JSONL; sessions are written append-first and resumed deterministically [src/runtime-state/storage/runtime-ledger.ts:RuntimeLedger].
- **Process and network.** Provider and model calls go out over the network, as do web fetch/search; local inference may auto-start a `llama-server` child. Shell tools, hooks, daemon workers, and subagents spawn child processes.
- **Filesystem mutation.** Patches, file create/delete, and checkpoint rollback write to the workspace, bounded by workspace containment and owned-scope grants for scoped workers.
- **Operator-visible output.** The CLI writes to stdout/stderr and exits with the codes in `EXIT_CODES`, including `REJECTED_SCOPE_EXPANSION = 3` when a run refuses to widen its scope [src/execution/run/run-contract.ts:EXIT_CODES].
- **No side effects** are claimed for the pure classification and contract modules (for example [src/task-classifier.ts:classifyTask] and the tool-manifest maps); they declare values and functions only.

## System Verification

- Run: `pnpm test` — full suite (node:test plus vitest).
- Run: `pnpm build` — clean build output, TypeScript compile, then copy build artifacts.
- Run: `pnpm check` — build, node test set, dependency pin verification, and naming checks.
- Run: `pnpm check:dox` — verifies added DOX claims resolve to branch content.
- Run: `pnpm check:staleness` — fails on unresolved schema refs, dead root-relative paths, and policy drift.
- Run: `git diff --check` — whitespace and conflict-marker check.
- Run: `node .gitnexus/run.cjs detect-changes --scope all --repo .` — required graph change analysis before committing.
- Supporting gates: `pnpm typecheck` and `pnpm typecheck:unused` (zero unused locals/parameters under `src/`), `pnpm check:dead` (src modules with no importers), and the architecture boundary tests above.


## Features

| Feature | What it does |
|---------|-------------|
| **Graph execution** | Structured multi-node TaskGraphs with dependency ordering, timeouts, and reruns |
| **Capability registry** | Agent/tool cards declare what each component can do. Resolve capabilities to agents and tools |
| **Policy engine** | First-match-wins policy rules: allow/ask/deny per capability, risk level, or tool |
| **Approval queue** | File-backed approval requests. CLI-first: list, approve, deny. Cooperative cancel |
| **Audit trail** | Append-only JSONL audit for policy decisions, approval lifecycle, and runtime outcomes |
| **RuntimeIndex** | Unified event index across sessions, graphs, approvals, audit, and daemon tasks |
| **SOP packs** | Repeatable multi-node workflows (research.deep_report, infra.docker_compose_audit) |
| **Persistent daemon** | Background process with Unix socket, task queue, cooperative cancel, crash recovery |
| **Inspector UI** | Local web dashboard with live sessions, graph view, policy, approvals, audit, registry, daemon |
| **Autonomous loop** | Plans first, then executes. Reviews the plan with you before touching files |
| **17 LLM providers** | Anthropic, OpenAI, Google, DeepSeek, Groq, Ollama, OpenRouter, Perplexity, and more |
| **MCP support** | Full Model Context Protocol client — tool discovery, deferral, caching, transport |
| **Patch engine** | Structured patches with preimage validation, git-aware checkpoints, automatic rollback |
| **Local llama.cpp** | Auto-starts `llama-server` on demand. Grammar-constrained tool calling |
| **Model profiles** | Built-in presets for provider/model/tier mappings per use case. `alix models doctor`, `fit`, `install-profile`, and more |

---

## Governed Self-Improvement

ALiX operates at **Maturity Level 5 — Governed Evolution**, supporting a complete
human-gated self-improvement lifecycle:

```
Observe → Reflect → Propose → Prioritize → Approve → Apply
→ Measure → Revert → Learn → Evolve
```

### Governance Guarantees

Every system mutation follows these architectural invariants — verified by tests,
enforced at the code level, never optional at runtime:

| Invariant | What it means |
|-----------|--------------|
| **Generate ≠ Approve** | Auto-generated proposals always start `pending`. No auto-approval path exists |
| **Approve ≠ Apply** | Approval only changes status to `approved`. A separate human action applies |
| **Apply ≠ Mutate** | Capability topology changes require a separate human gate |
| **Observe ≠ Revert** | Revert is a new proposal through the full lifecycle — never automatic |
| **Learn ≠ Evolve** | Intelligence informs decisions but never mutates system state |

### Adaptation Lifecycle

```bash
# Generate pending proposals from reflection, effectiveness, or capability analysis
alix adaptation generate --reflection <path>
alix adaptation generate --capability-evolution

# Review and approve
alix adaptation list --status pending
alix adaptation approve <proposal-id>

# Apply approved changes
alix adaptation apply <proposal-id>

# Measure effectiveness explicitly after apply
alix adaptation effectiveness <proposal-id>

# Revert if needed — goes through full propose→approve→apply
alix adaptation revert <proposal-id>
```

**Evidence chain:** Every lifecycle event (propose → approve → apply → revert) is
recorded with full audit metadata, creating a complete provenance trail.

---

### Requirements

- Node.js 26.4.0+
- An API key from one of the supported providers (free tier available on Google, DeepSeek)

### Install

```bash
npm install -g alix
# or from source:
git clone https://github.com/boduga/ALiX.git
cd ALiX
npm install
npm run build
```

### Set up a provider

```bash
alix models set-default
# Follow the interactive menu — picks provider, sets API key, downloads model list
```

### Run your first task

```bash
alix run "list the files in src/" --session-mode bypass
```

### Open the inspector

```bash
alix serve
# Visit http://127.0.0.1:4137
```

> **Security note:** By default the Inspector binds to `127.0.0.1` (loopback only),
> meaning it is not accessible from other machines on the network.
> See [Inspector Security](docs/security/inspector-security.md) for remote access documentation.

---

## Commands

| Command | Description |
|---------|-------------|
| `alix run "<task>"` | Default flow: plan → approve → execute. Supports `--no-plan`, `--mode=bypass`, `--resume <id>` |
| `alix tui` | Multi-task terminal UI |
| `alix serve` | Start the inspector web UI at `127.0.0.1:4137` (loopback) |
| `alix daemon start|stop|status` | Persistent background daemon lifecycle |
| `alix daemon tasks|cancel|doctor` | Task queue management and daemon health |
| `alix submit "<task>"` | Submit a task to the daemon (streaming output) |
| `alix sop list|show|run|doctor` | SOP pack catalog and execution |
| `alix policy list|doctor|eval` | Policy rule management and evaluation |
| `alix approvals list|pending|approve|deny` | Approval queue management |
| `alix audit list|by-graph|by-approval|by-action` | Audit trail queries |
| `alix runtime events|timeline` | Unified runtime event queries |
| `alix graph run|preflight|rerun|continue` | Graph execution and management |
| `alix registry list|agents|tools|doctor` | Agent/tool card registry |
| `alix doctor` | Comprehensive system health check |
| `alix config show` | Show current configuration |
| `alix models set-default` | Interactive provider + model selection |
| `alix models doctor|fit|list-profiles|show-profile|apply-profile|install-profile` | Model profile management and diagnostics |
| `alix session list|show` | Session management |
| `alix adaptation list|show <id>` | Adaptation proposal inspection |
| `alix adaptation propose|approve|reject|apply` | Proposal lifecycle (human-gated) |
| `alix adaptation revert <id>` | Propose a revert (goes through full approval) |
| `alix adaptation generate --reflection <path>` | Auto-generate proposals from a reflection report |
| `alix adaptation generate --capability-evolution` | Auto-generate proposals from capability analysis |
| `alix adaptation effectiveness <id>` | Assess an applied proposal (`--all` for every applied proposal) |
| `alix adaptation capability-evolution` | Read-only capability health/gap/overlap/drift report |

---

## Conflict Detection (M0.78f)

ALiX detects conflicts between findings reported by different workers in a coordination run using deterministic claim comparison, evidence ranking, optional worker reports, and an opt-in model-assistance layer. Detection is **non-blocking** — workers, downstream tasks, and the run itself keep going while a conflict is open. Resolving a conflict is an explicit human/operator act; the system never picks a winner on its own.

CLI subcommands (all require `--actor <id>`, take `--reason <text>`, and accept `--json`):

| Command | Description |
|---------|-------------|
| `alix coordination conflicts <run-id>` | List every conflict in a run with status, type, and topic |
| `alix coordination conflict <run-id> <conflict-id>` | Show one conflict in full: claim comparison, evidence ranking, history |
| `alix coordination conflict-resolve <run-id> <conflict-id>` | Pick a winner — rejects the other finding(s), closes the conflict |
| `alix coordination conflict-dismiss <run-id> <conflict-id>` | Dismiss as not a real conflict (e.g. both interpretations valid) |
| `alix coordination conflict-accept-divergence <run-id> <conflict-id>` | Accept both findings as intentionally divergent — they coexist |

**Safety boundaries:**

- Workers can **report** conflicts (via the worker report API) but cannot resolve them.
- Resolution requires an operator actor with explicit authority; the actor and reason are recorded in the conflict history and the audit chain.
- Conflicts are non-blocking by default — only critical conflicts with `blocksDownstreamByPolicy: true` halt downstream work, and that policy is set explicitly, never implied.
- The model is non-authoritative: it can suggest a topic or interpretation but cannot create a conflict or pick a winner.

See `docs/user-manual.md` for the detailed walkthrough, the Inspector conflict routes, the TUI conflict panel, and the audit/event log layout.

---

## Examples

```bash
# Fix a bug (plan mode is default — you approve before any file changes)
alix run "fix the TS2322 error in src/auth.ts"
# → Plan prints, you approve: [Y/n/e/d]

# Approve plan non-interactively
echo "y" | alix run "fix the TS2322 error"

# Skip plan mode entirely for quick tasks
alix run "list files in src/" --no-plan

# Research question (auto-approves plan — read-only task)
alix run "who is the current president of Nigeria" --session-mode bypass

# Multi-task in TUI
alix tui
> list files in src/
> fix the null pointer in user.ts
> who is the current president

# Create a hook (Pi-style self-extensibility)
alix run "use create_hook to register a hook that logs every file.delete to audit.txt"

# Use web search
alix run "what are the latest developments in AI agents" --session-mode bypass
```

---

## Walkthrough: Plan → Approve → Execute

When you run `alix run "<task>"`, plan mode is the default. Here's what happens:

### 1. Task classification

ALiX classifies your task type (feature, bugfix, refactor, docs, research) and selects relevant context.

### 2. Context compilation

The repo is analyzed — related files, tests, symbol definitions, and git activity are ranked by relevance to your task within your token budget.

### 3. Plan generation

The model generates a structured plan without calling any tools:

```
$ alix run "add a healthz endpoint to src/server.ts"

## Plan: Add /healthz endpoint
**Type:** feature | **Complexity:** low | **Risk:** low

### Changes
1. **Create** `src/routes/health.ts`
   - GET handler returning `{ status: "ok", timestamp: Date.now() }`
2. **Modify** `src/server.ts`
   - Import and register `/healthz` route

### Verification
- `npm run build` passes
- `curl localhost:3000/healthz` returns 200

### Impact
- No callers affected
- No breaking changes

Approve plan? [Y/n/e/d] _
```

### 4. Approval

| Key | Action |
|-----|--------|
| **Y** / Enter | Approve and execute |
| **n** | Reject — cancels the task |
| **e** | Edit — opens `$EDITOR` to modify the plan before approving |
| **d** | Detail — shows full context and expanded plan |

Once approved, the plan is injected into the agent's system prompt as a shared commitment.

### 5. Execution

The agent executes the plan step by step, calling tools (file read, search, edit, shell) as needed. Each tool call is logged and the output is shown. On completion, verification runs automatically.

### 6. Resume Interrupted Sessions

If a session is interrupted (max iterations, crash, Ctrl+C), you can resume it:

```bash
# List all sessions to find the interrupted one
alix session list

# Resume it
alix run --resume <session-id>
```

The agent picks up from where it left off — prior context, scope approvals, and plan are restored. No tool calls are re-executed.

```bash
# Short read-only tasks skip plan generation automatically
alix run "list files in src/" --session-mode bypass

# Development task with plan
alix run "fix the TS2322 error in src/auth.ts"
# → Plan prints, approve with Y
```

---

## Configuration

Config files are loaded in priority order:

1. **User**: `~/.config/alix/config.json` (homedir XDG)
2. **Project**: `.alix/config.json` (in your project root)

Project config overrides user config. There is no global config layer.

### Subagent tiers

Subagent roles use model tiers that you can set independently:

```bash
alix models set-tier thinking   # Strategic reasoning, planning
alix models set-tier coding     # Code generation, tool execution
alix models set-tier fast       # Quick classification, routing
alix models set-tier critic     # Verification, validation
alix models set-tier tiny       # Embeddings, reranking, memory compression
alix models set-tier image      # Image generation, multimodal analysis
```

Each tier inherits from the main model if not explicitly configured.

See `docs/configuration.md` for the full reference.

---

## Architecture

ALiX is a layered Agent OS. See `docs/architecture/runtime-spine.md` for the full reference.

```
Execution       → runTask(), GraphExecutor, daemon-server
Governance      → CapabilityResolver, RuleEvaluator, RuntimeGate, ApprovalStore
Observability   → RuntimeIndex, GraphProjection, Inspector UI
Registry        → CardRegistry, AgentCard, ToolCard
Workflow        → SOP packs (research, infra)
Daemon          → DaemonManager, TaskRegistry, Unix socket server
Adaptation      → ReflectionEngine, ProposalStore, EvidenceStore, ApprovalGate
  Intelligence  → ProposalEffectiveness, OrganizationalIntelligence, ProposalPrioritization
  Evolution     → CapabilityEvolutionReporter, GapAnalyzer, OverlapAnalyzer,
                  DriftAnalyzer, HealthAnalyzer, CapabilityEvolutionProposalGenerator
```

## Maturity Level

```
Level 1: Execute       ✅  Core agent loop, tool execution
Level 2: Coordinate    ✅  Multi-agent, subagents, daemon
Level 3: Reflect       ✅  P5.0 — Reflection engine
Level 4: Learn         ✅  P5.3 — Effectiveness intelligence, organizational memory
Level 5: Evolve        ✅  v0.6.0 — Governed self-improvement lifecycle
Level 6: Autonomous    ⬜  Future
```

---

## Web Tools

ALiX can search the web and fetch page content with built-in tools.

```bash
alix credential set brave apiKey <BSA...>
```

Provider API keys are resolved from the credential store, never from environment variables.

Free key at [api.search.brave.com/app/dashboard](https://api.search.brave.com/app/dashboard)

### Self-hosted search (SearXNG)

Point `web_search` at a local SearXNG instance instead of Brave
(no API key needed). The instance must allow JSON output
(`search.formats` includes `json` in `settings.yml`):

```jsonc
// ~/.config/alix/config.json
{
  "search": { "provider": "searxng", "searxngBaseUrl": "http://10.1.1.160:8080" }
}
```

Omit `search` (or set `provider: "brave"`) to keep Brave as default.

---

## Local Inference

ALiX can run entirely locally with llama.cpp:

```bash
export ALIX_LLAMA_MODEL_PATH="~/llama.cpp/models/your-model.gguf"

# ALiX auto-starts llama-server on demand — no manual server management
alix run "explain the dependency injection pattern" --session-mode bypass
```

Grammar-constrained tool calling ensures the local model produces valid tool call JSON. Supports Phi-3, Qwen2.5-Coder, DeepSeek Coder, and any GGUF model.

---

## Development

```bash
npm run build          # TypeScript compilation
npm test               # Full test suite (node:test + vitest)
npm run check          # Build + test + verify:deps
npm run verify:deps    # Check all deps are pinned
```

### Project structure

```
src/          — Source code
tests/        — Test suite (node:test)
dist/         — Compiled output
docs/         — Specs, plans, architecture
.alix/        — Agent config, sessions, embeddings
```

---

## Supply-Chain Policy

- All direct dependencies are pinned to exact versions
- `.npmrc` enforces `save-exact=true` and `min-release-age=2`
- `npm run verify:deps` checks all deps are pinned

---

## License

MIT
