# ALiX Demo Script

> A guided end-to-end tour of the Agent OS.

## Prerequisites

- ALiX built and configured (`pnpm build`, `alix config set-key`)
- Terminal window ready

---

## Part 1: System Health

```bash
alix doctor
```

Expected output shows all subsystems healthy: cards, policy, approvals, audit, RuntimeIndex.

---

## Part 2: Policy Rules

```bash
# See what policy rules are active
alix policy list

# Check what happens when you try something unsafe
alix policy eval --capability shell.exec
# → Decision: ask  (requires approval)

alix policy eval --capability web.search
# → Decision: allow (read-only, safe)

alix policy eval --capability nonexistent.op
# → Decision: deny  (nothing matched — deny by default)
```

---

## Part 3: Run a Task

```bash
# Simple task
alix run "explain what an Agent OS is in three sentences"

# View the session
alix session list
alix session show <session-id>
```

---

## Part 4: SOP Packs

```bash
# List available workflows
alix sop list

# Show details
alix sop show research.deep_report

# Run a research SOP
alix sop run research.deep_report --topic "vector databases for RAG"
```

---

## Part 5: Approvals

```bash
# Check pending approvals
alix approvals pending

# Approve one
alix approvals approve approval_abc123

# Continue the graph
alix graph continue graph_abc123
```

---

## Part 6: Audit Trail

```bash
# See what happened
alix audit list
alix audit by-graph graph_abc123
```

---

## Part 7: Unified Runtime Events

```bash
# See everything in one view
alix runtime events --limit 10

# Timeline for a specific graph
alix runtime timeline graph_abc123
```

---

## Part 8: Daemon Mode

```bash
# Start background daemon
alix daemon start

# Submit tasks
alix submit "write a short story about AI"

# Check task status
alix daemon tasks
alix daemon status

# Stop daemon
alix daemon stop
```

---

## Part 9: Inspector UI

```bash
# Start the web inspector
alix serve
# Open http://localhost:4137
```

Browse the tabs:
- **Timeline** — live session events
- **Runtime** — unified cross-source events
- **Graph** — graph node status and rerun
- **Policy** — loaded rules and quick eval
- **Approvals** — pending/approved/denied
- **Audit** — policy and runtime decisions
- **Registry** — agent and tool cards
- **Daemon** — status bar + task list

---

## Part 10: Daemon Recovery

```bash
# Start daemon, submit a task
alix daemon start
alix submit "analyze the project structure"

# Kill the daemon process (simulate crash)
kill $(cat .alix/daemon.pid)

# Check — the running task should show as failed_orphaned
alix daemon tasks --status failed_orphaned

# Restart — queued tasks survive
alix daemon start
alix daemon tasks --status queued
```
