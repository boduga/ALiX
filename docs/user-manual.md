# ALiX User Manual

> Version 0.2.0-rc.1 — Agent Operating System

---

## 1. What ALiX Is

ALiX (Agentic Lifecycle & Intelligence eXchange) is a **local-first AI Agent Operating System**. It runs tasks, enforces policies, requires approval for sensitive actions, records every decision in an audit trail, and persists work across sessions via a background daemon.

**Core philosophy:** ALiX is not a hosted service or platform. It is a CLI tool and daemon that you run on your own machine. All data stays in `.alix/` under your project directory. The web Inspector is a read-only window into what happened — you control everything through the CLI.

### Architecture overview

```
Execution    → runTask(), GraphExecutor, daemon-server
Governance   → CapabilityResolver, RuleEvaluator, RuntimeGate, ApprovalStore
Observability→ RuntimeIndex, GraphProjection, Inspector UI
Registry     → CardRegistry, AgentCard, ToolCard
Workflow     → SOP packs (research, infra)
Daemon       → DaemonManager, TaskRegistry, Unix socket server
```

---

## 2. Installation

### Requirements

- **Node.js 24+**
- An API key from a supported LLM provider (DeepSeek, Anthropic, OpenAI, Google, Groq, etc.)

### From source

```bash
git clone https://github.com/boduga/ALiX.git
cd ALiX
npm install
npm run build
```

### Verify installation

```bash
node dist/src/cli.js doctor
```

Expected output shows all subsystems healthy.

---

## 3. Configuration

### Set up an API key and model

```bash
alix config set-key
alix config set-default-model
```

The interactive menus walk you through selecting a provider and setting your API key. Keys are saved to `~/.config/alix/config.json`.

### Configuration files

Loaded in priority order:

1. **Project**: `.alix/config.json` (project root)
2. **User**: `~/.config/alix/config.json` (homedir XDG)
3. **Default**: Built-in defaults

```bash
# View current configuration
alix config show
```

### Subagent model tiers

Set different models for different roles:

```bash
alix config set-tier thinking   # Strategic reasoning, planning
alix config set-tier coding     # Code generation, tool execution
alix config set-tier fast       # Quick classification, routing
```

---

## 4. First Run

```bash
alix run "list the files in the current directory" --session-mode bypass
```

This runs a simple read-only task. Since the task classifier detects a shell command, it skips the planning phase and executes directly.

```bash
alix run "explain the architecture of this project"
```

For knowledge tasks, ALiX generates a structured plan, shows it to you, then executes.

### Plan approval flow

When ALiX generates a plan, you see:

```
## Plan: ...
**Type:** research | **Complexity:** low | **Risk:** low

### Steps
1. Read relevant source files
2. Analyze architecture
3. Write explanation

Approve plan? [Y/n/e/d] _
```

| Key | Action |
|-----|--------|
| **Y** / Enter | Approve and execute |
| **n** | Reject — cancels the task |
| **e** | Edit — opens `$EDITOR` to modify the plan |
| **d** | Detail — shows full context |

### Session management

```bash
# List past sessions
alix session list

# Show session details
alix session show <session-id>

# Resume an interrupted session
alix run --resume <session-id>
```

---

## 5. CLI Command Reference

### Core execution

| Command | Description |
|---------|-------------|
| `alix run "<task>"` | Plan-first execution (approve plan before execution) |
| `alix run "<task>" --no-plan` | Execute directly without planning phase |
| `alix run "<task>" --mode=bypass` | Run in bypass mode (no approval prompts) |
| `alix run --resume <id>` | Resume an interrupted session |
| `alix chat` | Interactive chat with web search tools |
| `alix submit "<task>"` | Submit task to daemon (streaming output) |

### Graph execution

| Command | Description |
|---------|-------------|
| `alix graph plan "<task>"` | Plan a multi-node TaskGraph (dry-run) |
| `alix graph list` | List saved graphs |
| `alix graph inspect <id>` | Show graph node details and status |
| `alix graph run <id>` | Execute a planned graph |
| `alix graph run <id> --enforce-capabilities` | Enforce capability/policy gate |
| `alix graph preflight <id>` | Check capability readiness per node |
| `alix graph rerun <id> --node <nodeId>` | Rerun a failed node |
| `alix graph continue <id>` | Resume graph after approval |
| `alix graph runs <id>` | Show graph run history |
| `alix graph export <id> --format mermaid` | Export graph as Mermaid diagram |

### Daemon

| Command | Description |
|---------|-------------|
| `alix daemon start` | Start background daemon |
| `alix daemon stop` | Stop background daemon |
| `alix daemon status` | Show daemon status and PID |
| `alix daemon tasks` | List daemon tasks |
| `alix daemon tasks --status running` | Filter tasks by status |
| `alix daemon cancel <taskId>` | Cancel a queued/running task |
| `alix daemon doctor` | Daemon health check |

### SOP packs

| Command | Description |
|---------|-------------|
| `alix sop list` | List registered SOPs |
| `alix sop show <id>` | Show SOP manifest details |
| `alix sop run <id> --topic "..."` | Run a research SOP |
| `alix sop run <id> --path <path>` | Run an infra SOP with a file path |
| `alix sop run <id> --input key=value` | Run with custom input parameters |
| `alix sop doctor` | Validate all registered SOPs |

### Policy

| Command | Description |
|---------|-------------|
| `alix policy list` | List loaded policy rules |
| `alix policy doctor` | Check policy file health |
| `alix policy eval --capability <cap>` | Evaluate against policy |

### Approvals

| Command | Description |
|---------|-------------|
| `alix approvals list` | List all approval requests |
| `alix approvals pending` | List pending approvals only |
| `alix approvals show <id>` | Show approval details |
| `alix approvals approve <id>` | Approve a pending request |
| `alix approvals deny <id>` | Deny a pending request |

### Audit

| Command | Description |
|---------|-------------|
| `alix audit list` | Show recent audit events |
| `alix audit by-graph <id>` | Filter by graph |
| `alix audit by-approval <id>` | Filter by approval |
| `alix audit by-action <action>` | Filter by action type |

### Runtime

| Command | Description |
|---------|-------------|
| `alix runtime events` | Show unified runtime events |
| `alix runtime events --graph <id>` | Filter by graph |
| `alix runtime events --session <id>` | Filter by session |
| `alix runtime events --limit 20` | Limit results |
| `alix runtime timeline <graphId>` | Time-ordered graph timeline |

### Registry

| Command | Description |
|---------|-------------|
| `alix registry list` | List all agents and tools |
| `alix registry agents` | List agent cards only |
| `alix registry tools` | List tool cards only |
| `alix registry doctor` | Check card file health |

### Inspector

| Command | Description |
|---------|-------------|
| `alix serve` | Start web inspector at `localhost:4137` |

### System

| Command | Description |
|---------|-------------|
| `alix doctor` | Comprehensive system health check |
| `alix config show` | Show configuration |
| `alix config set-key` | Set API key interactively |
| `alix config set-default-model` | Select provider and model |

---

## 6. Running Tasks

### Simple tasks

```bash
alix run "write a haiku about Lagos"
```

ALiX classifies this as a creative task, generates a single-node graph, and executes it.

### Development tasks

```bash
alix run "refactor the auth middleware to use async/await"
```

This generates a plan with specific file changes, shows it for approval, then executes step by step.

### Shell tasks

Shell commands (ls, cat, grep, find, etc.) skip plan generation automatically:

```bash
alix run "find all TypeScript files larger than 100KB"
```

### Task classification

ALiX classifies tasks into three types:

- **Shell tasks** — bare commands, no plan, execute directly
- **Read-only tasks** — research, questions, docs — auto-approve plan, execute
- **Development tasks** — features, bugfixes, refactors — full plan approval flow

---

## 7. Daemon Mode

The daemon is a persistent background process that runs tasks, queues them, and survives CLI restarts.

### Starting and stopping

```bash
# Start
alix daemon start
# → Daemon started (pid 12345)

# Check status
alix daemon status
# → Status: running  PID: 12345  Heartbeat: 2s ago

# Stop
alix daemon stop
```

### Submitting tasks

```bash
alix submit "research quantum computing advances"
```

This sends a task to the daemon via Unix socket. The daemon queues it, runs it, and streams events back:

```
Session: daemon_1234567890_abc
Task accepted: research quantum computing advances
  → web_search started
  ✓ web_search completed (1200ms)
  → file.write started
  ✓ file.write completed (45ms)
Task completed
```

### Task management

```bash
# List all daemon tasks
alix daemon tasks

# Filter by status
alix daemon tasks --status running
alix daemon tasks --status queued
alix daemon tasks --status failed_orphaned

# Cancel a queued task
alix daemon cancel task_abc123
```

### Task queue

Tasks run one at a time (FIFO). If you submit while one is running:

```
Queue position: 2
```

The daemon processes the next task automatically when the current one completes.

### Crash recovery

If the daemon crashes:

1. Running tasks are marked `failed_orphaned` on restart
2. Queued tasks survive and retry
3. Cancel-requested tasks are marked `cancelled`
4. A heartbeat timestamp detects stale daemon state

```bash
# Check after restart
alix daemon tasks --status failed_orphaned
alix daemon tasks --status queued
```

---

## 8. Graphs

A TaskGraph is a multi-node execution plan. Each node has a goal, required capabilities, risk level, and dependencies. Nodes execute in dependency order.

### Planning a graph

```bash
alix graph plan "analyze the database schema and generate migration docs"
```

This generates a graph without executing it. The graph is saved to `.alix/graphs/`.

### Running a graph

```bash
alix graph run <graphId>

# With capability enforcement
alix graph run <graphId> --enforce-capabilities
```

The executor runs nodes sequentially, stopping on the first failure.

### Preflight check

```bash
alix graph preflight <graphId>
```

Checks each node's required capabilities against the registry. Reports which nodes are ready, blocked (missing capabilities), or need approval (high-risk tools).

### Rerun

```bash
# Rerun a specific failed node
alix graph rerun <graphId> --node <nodeId>

# Force rerun even if not failed
alix graph rerun <graphId> --node <nodeId> --force
```

### Continue after approval

```bash
alix graph continue <graphId>
```

This checks the approval store for a resolved approval on the blocked node, then reruns the graph if approved.

### Graph history

```bash
alix graph runs <graphId>
```

Shows sessions, attempts, and reports associated with a graph.

---

## 9. SOP Packs

SOPs (Standard Operating Procedures) are repeatable, pre-built workflows.

### Built-in SOPs

| ID | Nodes | Tags | Description |
|----|-------|------|-------------|
| `research.deep_report` | 6 | research, report, web | Deep research with scope → search → claims → synthesize → critic → write |
| `infra.docker_compose_audit` | 1 | infra, docker, security, audit | Audit a docker-compose.yml |

### Running SOPs

```bash
# Research SOP
alix sop run research.deep_report --topic "vector databases for AI"

# Infra SOP with file path
alix sop run infra.docker_compose_audit --path docker-compose.yml

# Generic input
alix sop run <id> --input key=value --input key2=value2

# Plan only (dry-run)
alix sop run research.deep_report --topic "test" --plan-only
```

### Creating a new SOP

Create a file in `src/sop/<domain>-<name>.ts` exporting a `SopDefinition`:

```typescript
export function getMySopDef() {
  return {
    id: "mydomain.my_sop",
    name: "My SOP",
    description: "What it does",
    manifest: {
      author: "You",
      version: "1.0.0",
      tags: ["tag1", "tag2"],
      nodeCount: 3,
      requiredCapabilities: ["filesystem.read"],
    },
    buildGraph: (input) => {
      // Build and return a TaskGraph
      return { graph, reportDir: `report_${Date.now()}` };
    },
  };
}
```

Then register it in `src/sop/sop-registry.ts`.

---

## 10. Capability Registry

The registry manages agent and tool identity. Every capability (e.g. `web.search`, `filesystem.write`) is declared on a card.

### Default cards

| Agents | Tools |
|--------|-------|
| orchestrator.core | web_search |
| planner.graph | file_read |
| research.scout | file_write |
| critic.general | shell_exec |
| artifact.writer | |
| memory.curator | |

### Viewing cards

```bash
alix registry list
alix registry agents
alix registry tools
```

### Custom cards

Place JSON card files in:

- `.alix/cards/agents/*.json`
- `.alix/cards/tools/*.json`

Example tool card (`tools/custom.json`):

```json
{
  "id": "my_custom_tool",
  "name": "My Custom Tool",
  "description": "Does something useful",
  "version": "1.0.0",
  "capabilities": ["my.custom.action"],
  "riskLevel": "low",
  "approvalMode": "auto",
  "sideEffects": "read",
  "enabled": true
}
```

### Capability resolution

When a graph node requires a capability, the `CapabilityResolver` checks:

1. Does any registered agent or tool declare this capability?
2. Does the agent's domain match the node's domain?
3. Does the execution profile match?

If no card covers a required capability, the node is marked as blocked.

---

## 11. Policy Rules

Policy rules control what ALiX is allowed to do. Rules are evaluated in order — first match wins.

### Default rules

| ID | Decision | Match |
|----|----------|-------|
| allow-file-read | allow | capability=filesystem.read |
| allow-web-search | allow | capability=web.search |
| ask-file-write | ask | capability=filesystem.write |
| ask-shell-exec | ask | capability=shell.exec |
| deny-critical-risk | deny | riskLevel=critical |
| ... (11 total) | | |

### Viewing and testing

```bash
# List all rules
alix policy list

# Test a capability
alix policy eval --capability shell.exec
# → Decision: ask  (requires approval)

alix policy eval --capability web.search
# → Decision: allow

alix policy eval --capability nonexistent.op
# → Decision: deny  (deny by default)
```

### Custom policy files

Place policy rules in `.alix/policies/*.json`:

```json
[
  {
    "id": "allow-local-file-reads",
    "description": "Allow reading files in src/",
    "match": {
      "capability": "filesystem.read",
      "pathPattern": "^src/"
    },
    "decision": "allow",
    "enabled": true
  }
]
```

### Policy evaluation order

1. Rules are evaluated top to bottom (first match wins)
2. Most restrictive decision wins across multiple capabilities (deny > ask > allow)
3. If no rule matches, the default is **deny**

---

## 12. Approvals

When a policy rule returns `ask`, the system creates an approval request. Execution pauses until the request is resolved.

### Viewing approvals

```bash
# All approvals
alix approvals list

# Only pending
alix approvals pending

# Details
alix approvals show approval_abc123
```

### Resolving approvals

```bash
# Approve
alix approvals approve approval_abc123

# Deny
alix approvals deny approval_abc123

# With reason
alix approvals deny approval_abc123 --reason "Not the right time"
```

### Approval-aware continuation

After approving, resume the graph:

```bash
alix graph continue <graphId>
```

The RuntimeGate checks:

- If a prior approval is **approved** → node executes
- If **denied** → node is blocked
- If **pending** → shows the pending ID

### Approval lifecycle

```
policy.ask → approval.created (pending)
  → user approves → approval.approved → node executes
  → user denies  → approval.denied  → node blocked
```

---

## 13. Audit Trail

Every policy decision, approval action, and runtime outcome is recorded in an append-only JSONL audit trail.

### Viewing the audit trail

```bash
# Recent events
alix audit list

# Filter by graph
alix audit by-graph graph_abc123

# Filter by approval
alix audit by-approval approval_abc123

# Filter by action type
alix audit by-action policy.denied
```

### Audit action types

| Category | Actions |
|----------|---------|
| Policy | policy.evaluated, policy.allowed, policy.denied, policy.asked |
| Approval | approval.created, approval.approved, approval.denied |
| Runtime | runtime.allowed, runtime.blocked, runtime.requires_approval |
| Graph | graph.continued, graph.completed |

### Audit is append-only

Records are written to `.alix/audit/audit.jsonl`. Each line is a complete JSON record. No records are ever deleted or modified.

---

## 14. RuntimeIndex / Timeline

The RuntimeIndex provides a unified view across all ALiX data sources: sessions, graphs, approvals, audit, and daemon tasks.

### Querying events

```bash
# All recent events
alix runtime events --limit 20

# Filter by graph
alix runtime events --graph graph_abc123

# Filter by session
alix runtime events --session sess_abc

# Filter by action
alix runtime events --action policy.denied

# Graph timeline (oldest first)
alix runtime timeline graph_abc123
```

### Data sources

| Source | Data | Location |
|--------|------|----------|
| session | Session events (tool calls, model usage) | `.alix/sessions/` |
| graph | Graph/node state | `.alix/graphs/` |
| graph_run | Rerun attempts | `.alix/graphs/*.runs.json` |
| approval | Approval lifecycle | `.alix/approvals/` |
| audit | Policy/runtime audit | `.alix/audit/` |
| daemon_task | Daemon task lifecycle | `.alix/daemon-tasks.json` |

### API

```bash
GET /api/runtime/events?limit=50&graphId=...&order=asc
```

---

## 15. Inspector UI

The web Inspector provides a read-only view of sessions, graphs, policies, approvals, audit, registry, and daemon status.

### Starting the Inspector

```bash
alix serve
```

Open http://localhost:4137 in your browser.

### Tabs

| Tab | Shows |
|-----|-------|
| Timeline | Live session event stream (SSE) |
| Runtime | Unified events from all sources |
| Graph | Graph list, node table, capability resolution, rerun command |
| Policy | Loaded rules, quick evaluate form |
| Approvals | Approval records with approve/deny CLI commands |
| Audit | Policy and runtime audit trail |
| Registry | Agent and tool cards |
| Compare | Side-by-side session comparison |

### Daemon status

The Inspector shows a daemon status indicator in the header:

- **Green ●** — daemon running, heartbeat fresh
- **Yellow ●** — daemon running but heartbeat stale
- **Grey ○** — daemon stopped

### Session replay

When connected to a session, use the replay controls to step through events:

```
|<   <   Play   >   >|
```

Speed slider controls playback rate (150–1500ms per step).

---

## 16. Reports and Artifacts

SOP runs produce artifacts in `.alix/reports/<reportId>/`.

### Listing reports

```bash
alix report list
alix report show <reportId>
alix report open <reportId>
alix report path <reportId>
```

### Report structure

```
.alix/reports/<reportId>/
├── manifest.json     — graphId, sopId, topic, node results
├── final_report.md   — synthesized output
├── sources.json      — source references
├── claims.json       — extracted claims
└── critic_review.md  — gap/conflict analysis
```

---

## 17. Troubleshooting

### `alix doctor` fails

```bash
alix doctor
```

Shows which subsystem is unhealthy:

- **Cards** — check `.alix/cards/` for invalid JSON files
- **Policy** — check `.alix/policies/` for invalid rules
- **Daemon** — check daemon status; start if needed
- **RuntimeIndex** — will index whatever data exists

### Daemon won't start

```bash
# Check if another daemon is running
alix daemon status

# Force stop if stale PID
alix daemon stop
rm -f .alix/daemon.pid .alix/alixd.sock
alix daemon start
```

### Approval not found

```bash
# List all approvals
alix approvals list

# Check specific ID
alix approvals show approval_abc123
```

### Graph execution blocked

```bash
# Check capability preflight
alix graph preflight <graphId>

# Check policy evaluation
alix policy eval --capability <needed-capability>

# Continue after approval
alix graph continue <graphId>
```

### Inspector shows no data

The Inspector needs session data to display. Either:

1. Run a task first: `alix run "hello"`
2. Connect to an existing session ID

The Registry, Policy, Runtime, and Audit tabs work without a session.

### Common errors

| Error | Likely cause |
|-------|-------------|
| `Daemon is not running` | Start daemon with `alix daemon start` |
| `Approval required but no approval store configured` | Daemon needs to be running |
| `Missing capabilities:` | No card covers the required capability |
| `No matching policy rule` | The capability doesn't match any rule |

---

## 18. Common Workflows

### Research workflow

```bash
# Quick research
alix run "what is the current state of Rust in embedded systems"

# Deep research via SOP
alix sop run research.deep_report --topic "Rust in embedded systems 2026"

# View results
alix report list
alix report open <reportId>
```

### Policy evaluation workflow

```bash
# Check what would happen before running
alix policy eval --capability shell.exec --risk high

# If it returns ask, you need approval
alix approvals pending
alix approvals approve <id>
```

### Daemon workflow

```bash
# Start daemon for persistent execution
alix daemon start

# Submit tasks (non-blocking)
alix submit "analyze the codebase for security issues"
alix submit "generate API documentation"

# Check progress
alix daemon tasks

# View results in Inspector
alix serve
```

### Debugging a graph

```bash
# Step 1: Check capability readiness
alix graph preflight <graphId>

# Step 2: Run with enforcement
alix graph run <graphId> --enforce-capabilities

# Step 3: If blocked, check why
alix policy eval --capability <needed-cap>

# Step 4: Fix policy or approve
alix approvals approve <id>

# Step 5: Continue
alix graph continue <graphId>
```

### Recovery after crash

```bash
# 1. Check daemon status
alix daemon status

# 2. Check for orphaned tasks
alix daemon tasks --status failed_orphaned

# 3. Restart daemon (queued tasks survive)
alix daemon start

# 4. Check audit trail
alix audit list --limit 10
```

---

## 19. Security Model

### Two-layer gate

Every node execution passes through two gates:

1. **CapabilityResolver** — Does any registered agent/tool cover this capability? If not → blocked.
2. **RuleEvaluator** — Is this capability allowed by policy? If deny → blocked. If ask → pending approval.

### Approval required

High-risk operations (shell execution, file deletion, critical-risk tools) require explicit approval:

```bash
alix approvals approve <id>
```

### Audit is immutable

The audit trail is append-only JSONL. Records are never modified or deleted.

### Inspector is read-only

The web Inspector has no POST endpoints for execution. It's an observability tool.

### Daemon is local-only

The daemon binds to a Unix socket (`.alix/alixd.sock`). No remote access. No network exposure.

---

## 20. Storage Layout

```
.alix/
├── sessions/<id>/events.jsonl    — Raw session events (append-only)
├── graphs/<id>.json              — Graph definitions + node status
├── graphs/<id>.runs.json         — Rerun attempt history
├── approvals/approvals.json      — Approval request records
├── audit/audit.jsonl             — Audit trail (append-only JSONL)
├── policies/*.json               — Custom policy rule files
├── cards/agents/*.json           — Custom agent card files
├── cards/tools/*.json            — Custom tool card files
├── reports/<id>/                 — SOP report artifacts
├── daemon.json                   — Daemon status + heartbeat
├── daemon.pid                    — Daemon process ID
├── daemon-tasks.json             — Daemon task registry (atomic writes)
└── alixd.sock                    — Daemon Unix socket
```

---

## 21. Glossary

| Term | Definition |
|------|------------|
| **Agent Card** | Declares an agent's identity, capabilities, domains, and execution profile |
| **Tool Card** | Declares a tool's identity, capabilities, risk level, and approval mode |
| **Capability** | A named action a tool or agent can perform (e.g. `web.search`, `filesystem.write`) |
| **CapabilityResolver** | Checks whether any registered card covers a required capability |
| **RuleEvaluator** | Evaluates policy rules against a capability/risk/profile to return allow/ask/deny |
| **RuntimeGate** | Two-layer gate combining CapabilityResolver and RuleEvaluator |
| **TaskGraph** | A structured multi-node execution plan with dependencies |
| **GraphExecutor** | Runs TaskGraph nodes sequentially, stopping on first failure |
| **Projection** | Reconstructed run state from events and graph JSON |
| **RuntimeIndex** | On-demand unified event index across all ALiX storage backends |
| **SOP** | Standard Operating Procedure — a repeatable, pre-built workflow |
| **Daemon** | Background process that accepts tasks, queues them, and executes persistently |
| **TaskRegistry** | File-backed daemon task queue with crash recovery |
| **ApprovalStore** | File-backed approval request queue |
| **AuditStore** | Append-only JSONL audit trail |
| **Policy Rule** | A first-match-wins rule declaring allow/ask/deny for a capability/risk/tool |
| **Inspector** | Read-only web UI for session replay, graph view, policy, approvals, audit |
| **RuntimeGate** | Composed gate: CapabilityResolver + RuleEvaluator + ApprovalStore |
| **DOX** | Durable Operating Contract — hierarchical AGENTS.md governance framework |
