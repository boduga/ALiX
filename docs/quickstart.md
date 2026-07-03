# ALiX Quickstart

> ALiX is a local-first AI Agent Operating System — run tasks, enforce policies, approve actions, audit everything.

## Prerequisites

- Node.js 24+
- pnpm (enable with `corepack enable`)
- A model provider API key (DeepSeek, Anthropic, OpenAI, etc.)

## Install

```bash
git clone <repo>
cd ALiX
pnpm install
pnpm build
```

## Configure

```bash
# Set up your API key
alix config set-key
# Select your provider and model
alix config set-default-model
```

## Quick Demo

```bash
# Check system health
alix doctor

# Run a simple task
alix run "write a haiku about Lagos"
```

## Daemon Mode (persistent runtime)

```bash
# Start the daemon
alix daemon start

# Submit tasks to it
alix submit "research the history of afrobeats"

# Check what's running
alix daemon tasks
alix daemon status

# Cancel a queued task
alix daemon cancel task_abc123

# Stop the daemon
alix daemon stop
```

## SOP Packs (repeatable workflows)

```bash
# List available SOPs
alix sop list

# Show SOP details
alix sop show research.deep_report

# Run a research SOP
alix sop run research.deep_report --topic "quantum computing in Africa"

# Validate all SOPs
alix sop doctor
```

## Policy & Approvals

```bash
# List policy rules
alix policy list

# Evaluate a capability against policy
alix policy eval --capability shell.exec

# List pending approvals
alix approvals pending

# Approve or deny
alix approvals approve approval_abc123
alix approvals deny approval_def456

# Resume a graph after approval
alix graph continue graph_abc123
```

## Audit Trail

```bash
# View audit events
alix audit list

# Filter by graph
alix audit by-graph graph_abc123

# Filter by approval
alix audit by-approval approval_abc123
```

## Inspector (Web UI)

```bash
# Start the inspector server
alix serve
# Open http://localhost:4137 in your browser
```

The Inspector shows live session events, graph execution, approval status, policy rules, audit trail, and daemon tasks — all read-only.

## Graphs

```bash
# Plan a graph without executing
alix graph plan "refactor the auth module"

# List saved graphs
alix graph list

# Execute a graph
alix graph run graph_abc123

# Check capability preflight
alix graph preflight graph_abc123

# Rerun a failed node
alix graph rerun graph_abc123 --node n1

# View unified runtime events
alix runtime events --graph graph_abc123
alix runtime timeline graph_abc123
```

## Registry

```bash
# List loaded agent and tool cards
alix registry list
alix registry agents
alix registry tools
alix registry doctor
```

## Getting Help

```bash
alix --help
alix doctor        # Full system health check
```
