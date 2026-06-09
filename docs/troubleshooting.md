# ALiX Troubleshooting

> Common issues and solutions for the ALiX Agent Operating System.

## `alix doctor` fails

```bash
alix doctor
```

Shows which subsystem is unhealthy:

- **Cards** — check `.alix/cards/` for invalid JSON files
- **Policy** — check `.alix/policies/` for invalid rules
- **Daemon** — check daemon status; start if needed
- **RuntimeIndex** — will index whatever data exists

## Daemon won't start

```bash
# Check if another daemon is running
alix daemon status

# Force stop if stale PID
alix daemon stop
rm -f .alix/daemon.pid .alix/alixd.sock
alix daemon start
```

## Approval not found

```bash
# List all approvals
alix approvals list

# Check specific ID
alix approvals show approval_abc123
```

## Graph execution blocked

```bash
# Check capability preflight
alix graph preflight <graphId>

# Check policy evaluation
alix policy eval --capability <needed-capability>

# Continue after approval
alix graph continue <graphId>
```

## Inspector shows no data

The Inspector needs session data to display. Either:

1. Run a task first: `alix run "hello"`
2. Connect to an existing session ID

The Registry, Policy, Runtime, and Audit tabs work without a session.

## Common errors

| Error | Likely cause |
|-------|-------------|
| `Daemon is not running` | Start daemon with `alix daemon start` |
| `Approval required but no approval store configured` | Daemon needs to be running |
| `Missing capabilities:` | No card covers the required capability |
| `No matching policy rule` | The capability doesn't match any rule |
