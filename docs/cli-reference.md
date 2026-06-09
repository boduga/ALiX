# ALiX CLI Reference

> Full command reference for the ALiX Agent Operating System.
> See `docs/user-manual.md` for tutorials and explanations.

## Core execution

| Command | Description |
|---------|-------------|
| `alix run "<task>"` | Plan-first execution (approve plan before execution) |
| `alix run "<task>" --no-plan` | Execute directly without planning phase |
| `alix run "<task>" --mode=bypass` | Run in bypass mode (no approval prompts) |
| `alix run --resume <id>` | Resume an interrupted session |
| `alix chat` | Interactive chat with web search tools |
| `alix submit "<task>"` | Submit task to daemon (streaming output) |

## Graph execution

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

## Daemon

| Command | Description |
|---------|-------------|
| `alix daemon start` | Start background daemon |
| `alix daemon stop` | Stop background daemon |
| `alix daemon status` | Show daemon status and PID |
| `alix daemon tasks` | List daemon tasks |
| `alix daemon tasks --status running` | Filter tasks by status |
| `alix daemon cancel <taskId>` | Cancel a queued/running task |
| `alix daemon doctor` | Daemon health check |

## SOP packs

| Command | Description |
|---------|-------------|
| `alix sop list` | List registered SOPs |
| `alix sop show <id>` | Show SOP manifest details |
| `alix sop run <id> --topic "..."` | Run a research SOP |
| `alix sop run <id> --path <path>` | Run an infra SOP with a file path |
| `alix sop run <id> --input key=value` | Run with custom input parameters |
| `alix sop doctor` | Validate all registered SOPs |

## Policy

| Command | Description |
|---------|-------------|
| `alix policy list` | List loaded policy rules |
| `alix policy doctor` | Check policy file health |
| `alix policy eval --capability <cap>` | Evaluate against policy |

## Approvals

| Command | Description |
|---------|-------------|
| `alix approvals list` | List all approval requests |
| `alix approvals pending` | List pending approvals only |
| `alix approvals show <id>` | Show approval details |
| `alix approvals approve <id>` | Approve a pending request |
| `alix approvals deny <id>` | Deny a pending request |

## Audit

| Command | Description |
|---------|-------------|
| `alix audit list` | Show recent audit events |
| `alix audit by-graph <id>` | Filter by graph |
| `alix audit by-approval <id>` | Filter by approval |
| `alix audit by-action <action>` | Filter by action type |

## Runtime

| Command | Description |
|---------|-------------|
| `alix runtime events` | Show unified runtime events |
| `alix runtime events --graph <id>` | Filter by graph |
| `alix runtime events --session <id>` | Filter by session |
| `alix runtime events --limit 20` | Limit results |
| `alix runtime timeline <graphId>` | Time-ordered graph timeline |

## Registry

| Command | Description |
|---------|-------------|
| `alix registry list` | List all agents and tools |
| `alix registry agents` | List agent cards only |
| `alix registry tools` | List tool cards only |
| `alix registry doctor` | Check card file health |

## Inspector

| Command | Description |
|---------|-------------|
| `alix serve` | Start web inspector at `localhost:4137` |

## System

| Command | Description |
|---------|-------------|
| `alix doctor` | Comprehensive system health check |
| `alix config show` | Show configuration |
| `alix config set-key` | Set API key interactively |
| `alix config set-default-model` | Select provider and model |
