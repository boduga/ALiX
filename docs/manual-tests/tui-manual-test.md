# TUI Manual Test

> Verify all TUI modes, panels, and edge cases.

## Prerequisites

- ALiX built (`pnpm build`)
- A running terminal with at least 120 columns × 30 rows
- Daemon not running (for test 1–6)

---

### 1. Help text shows TUI

```bash
alix --help | grep tui
```

Expected: `alix tui` appears in the command list.

### 2. TUI starts and shows welcome

```bash
echo "" | alix tui 2>&1 | head -10
```

Expected: welcome text includes "ALiX TUI", "Execution mode: direct", and "Type 'exit' to quit."

### 3. TUI shows panel navigation on Tab press

```bash
printf "\t\n" | alix tui 2>&1 | tail -5
```

Expected: shows panel name cycling through chat, daemon, approvals, sops, policy, runtime.

### 4. TUI shows help on ?

```bash
printf "?\n" | alix tui 2>&1 | tail -5
```

Expected: shows help text with commands and panel list.

### 5. Panel renders daemon content

```bash
printf "r\n" | alix tui 2>&1
```

Expected: "Runtime snapshot refreshed." appears.

### 6. Panel renders non-chat panel content

```bash
printf "\t\n\n" | alix tui 2>&1 | tail -10
```

Expected: daemon panel content (status, tasks, events) is shown. Tab switches to daemon panel, Enter renders content.

---

### 7. Daemon mode shows error when not running

```bash
printf "" | alix tui --daemon 2>&1 | tail -10
```

Expected: outputs "ERROR: Daemon is not running" and exits with code 1.

---

### 8. Session mode flag is accepted

```bash
printf "" | alix tui --mode bypass 2>&1 | head -10
```

Expected: welcome shows `Session: bypass`.

### 9. --daemon and --mode together

```bash
printf "" | alix tui --daemon --mode ask 2>&1
```

Expected: checks daemon first, prints error if not running.

---

### 10. Daemon mode: socket path validation (destructive)

Start the daemon:

```bash
alix daemon start
```

Now simulate a tampered socket path:

```bash
sed -i 's|alixd.sock|/tmp/fake.sock|' .alix/daemon.json
echo "" | alix tui --daemon 2>&1
```

Expected: outputs "Refusing daemon socket outside workspace" and does not connect.

```bash
alix daemon stop
```

### 11. Full runtime test — direct task execution

```bash
printf "list files\n" | timeout 10 alix tui --mode bypass 2>&1 | tail -20
```

Expected: task runs, output appears, status updates.

### 12. Dashboard rendering on large terminal

If your terminal is ≥120 columns × ≥30 rows, run:

```bash
printf "r\n" | alix tui --mode bypass 2>&1 | grep -E "DAEMON|APPROVALS|SOPS|POLICY|RUNTIME"
```

Expected: dashboard cards appear with DAEMON, APPROVALS / RUNTIME, SOPS / POLICY headers.

---

## Exit codes

| Condition | Expected exit code |
|-----------|-------------------|
| Normal exit (quit) | 0 |
| Daemon mode, daemon not running | 1 |
| Task completes successfully | 0 |
| Task error | 1 (via process) |
