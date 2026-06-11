# M0.37: TUI/Daemon Hardening + Refactor

> **REQUIRED:** Use subagent-driven-development to execute task-by-task.

**Goal:** Fix correctness bugs and structural debt in TUI and daemon code — panel Enter behavior, dashboard layout, socket path validation, JSON-line buffering, store missing fields, and test coverage.

**Scope:** No new features. Eight targeted fixes.

---

| # | Priority | Fix | Files |
|---|----------|-----|-------|
| 1 | P0 | Fix panel Enter behavior | `src/cli/commands/tui.ts` |
| 2 | P0 | Fix dashboard card rendering height | `src/tui/render.ts` |
| 3 | P0 | Validate daemon socket path | `src/tui/daemon-client.ts` |
| 4 | P1 | Buffer JSON-line stream parsing | `src/tui/daemon-client.ts` |
| 5 | P1 | Preserve daemonPid, sopItems in store | `src/tui/store.ts`, `src/tui/runtime-snapshot.ts` |
| 6 | P1 | Extract panel rendering from command loop | `src/tui/panel-renderer.ts`, `src/cli/commands/tui.ts` |
| 7 | P2 | Add dashboard/box ANSI-width tests | `tests/tui/box.test.ts`, `tests/tui/dashboard-renderer.test.ts` |
| 8 | P2 | Daemon stop removes PID file | `src/daemon/daemon-manager.ts` |

---

### Fix 1: Panel Enter behavior

**Problem:** `if (!task.trim()) continue;` skips empty input before the panel-rendering block runs.

**Fix:** Move panel Enter handling before the empty-input check:

```typescript
    const activePanel = store.getState().activePanel;

    // Panel content rendering (empty Enter)
    if (!task.trim()) {
      if (activePanel !== "chat") {
        renderPanelContent(store, tui);
      }
      continue;
    }
```

### Fix 2: Dashboard card rendering height

**Problem:** Dashboard cards are pushed into the 4-line STATUS area but can be much taller.

**Fix:** Calculate the total fixed zone as `STATUS + dashboardLines` so the scroll region excludes card rows:

```typescript
    const h = getTerminalHeight();
    const showCards = h >= 30 && w >= 120 && s.activePanel === "chat";
    const snap = showCards ? snapshotFromStore(s) : null;
    const dashboardCards = snap ? renderDashboardCards(snap, w) : [];
    const dashboardLines = dashboardCards.length;
    const fixedLines = STATUS + (showCards ? dashboardLines : 0);
    const scrollH = h - fixedLines;

    // Set scroll region height based on fixed lines
    process.stdout.write(`\x1b[1;${scrollH}r`);

    // Render dashboard cards in the fixed zone above status
    if (showCards) {
      for (let i = 0; i < dashboardLines; i++) {
        process.stdout.write(LINE(scrollH + i));
        process.stdout.write(dashboardCards[i] || clearToEndOfLine());
      }
    }
```

### Fix 3: Validate daemon socket path

**Problem:** `submitTaskViaDaemon()` trusts `socketPath` from `.alix/daemon.json` without validating it.

**Fix:** Validate socket path is within `.alix/` directory before connecting:

```typescript
    const expectedSocket = join(opts.cwd, ".alix", "alixd.sock");
    if (socketPath !== expectedSocket) {
      opts.onError(`Refusing daemon socket outside workspace: ${socketPath}`);
      return;
    }
```

### Fix 4: Buffer JSON-line stream parsing

**Problem:** `data.toString().trim().split("\n")` breaks on chunk boundaries.

**Fix:** Use a persistent buffer:

```typescript
    let buffer = "";
    client.on("data", (data: Buffer) => {
      buffer += data.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as DaemonResponse;
          opts.onEvent({ ...msg, raw: line });
        } catch {
          opts.onEvent({ type: "error" as any, message: "Malformed response", raw: line });
        }
      }
    });
```

### Fix 5: Preserve daemonPid and sopItems in store

**Problem:** `daemonPid`, `daemonHeartbeatAge`, and `sopItems` are collected but never stored or rendered.

**Fix:** Add to `TuiState`, add setters, update `applySnapshotToStore()` and `snapshotFromStore()`.
