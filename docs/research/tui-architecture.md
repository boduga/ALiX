# Research: ALiX TUI Keybinding + Panel Architecture

**Source ticket:** wayfinder #309 — https://github.com/boduga/ALiX/issues/309
**Date:** 2026-07-31

## 1. Key-dispatch flow

All inside `TuiApp.handleRaw(buf)` at `src/tui/app.ts:237`:

1. **`handlePaste(buf)`** (line 239, def 796-843) — bracketed-paste `\x1b[200~`/`\x1b[201~` envelope.
2. **`parseKey(buf)`** (line 241, def 1085-1119) — Buffer → named key strings. `\r\n`→Enter, `\t`→Tab, `\x0c`→Ctrl+l, `\x7f`→Backspace, ESC+digit→Ctrl+N, ESC+letter→Alt+letter, ANSI arrows→ArrowUp/Down/Left/Right/Shift+Tab, single printable bytes pass through, else null.
3. **`tryHandleGlobal(key)`** (line 243, def 520-557) — `Navigation.interpret()` (navigation.ts:12): Tab/ArrowRight→cycle forward, Shift+Tab/ArrowLeft→cycle back, Escape→home (chat tab), Ctrl+N→jump. Agent-tab Shift+Tab hijacked for mode cycling. Ctrl+C (`\x03`) always quits; q/Q quits only on non-input tabs. Ctrl+l repaints.
4. **`KeyDispatcher`** (line 246, key-dispatcher.ts) — pluggable `on(key, handler)`, first-true-wins `dispatch(key)`. **Recommended injection point for new global bindings.**
5. **Plan approval gate** (259-267) — y/n/e/d map to plan decisions when a plan is pending.
6. **Sidebar scroll** (274-279) — j/k scroll focused panel.
7. **Tab input** — chat (282-309), agent (312-376): Enter submits, Backspace edits/navigates, printable chars append.
8. **Alt+c clipboard copy** (379-382).
9. **`view.handleKey(key, ctx)`** (384-391) → `ViewAction` resolved by `dispatch()` (665-700): handled/moveCursor/scroll/switchTab/scheduleRefresh/resolveApproval/copyScrollback.

## 2. Tab/panel registration + rendering

- **Tab order**: `TAB_ORDER` at app.ts:47 — dashboard, chat, agent, daemon, approvals, runtime, sops, policy.
- **View interface**: `TuiView { id, render, handleKey?, onActivate?, onDeactivate? }` (views/types.ts:44-50).
- **Registration**: module-level singletons in views/index.ts (15-28), `getView(id)` lookup. Eight view classes.
- **Wiring**: TuiApp constructor builds `defaultViews`; `this.views` getter allows injection via `TuiAppOptions.views`.
- **Render**: `paintFullFrame()` (936-1077) — fresh canvas → view.render → plan-approval-card overlay → blit into main canvas → header → tab bar → status line → single `\x1b[H` + `canvas.renderFrame()`.
- **Tab switch**: `switchTab()` (586-599) — deactivate, push history, set active, bind panel focus, activate.
- **Per-tab state**: `PerTabState` (state.ts:43-118) — inputBuffer, submittedPrompts, agentResponses, progressLedger, pendingToolCalls, currentIntent, etc.
- **Canvas primitives**: `write(x,y,text)`, `drawBox(x,y,w,h,title?,color?)`, `drawBar(...)`, `blit(other,ox,oy)`, `renderFrame()`.

## 3. Daemon socket protocol

- **Path**: `~/.alix/alixd.sock` (client:39, server:32). Unix socket, newline-delimited JSON.
- **Client**: `submitTaskViaDaemon(opts)` (33-96) and `DaemonAgentSession` (149-305). Per-turn connect, 120s timeout.
- **Request envelope** (daemon-types.ts:9-29): `{ command: "run"|"direct"|"ping"|"status"|"cancel", task, cwd, route?, sessionMode?, ... }`.
- **Response envelope** (daemon-types.ts:31-55): session.started / task.accepted / task.completed / task.failed / tool.event / session.ended / queue.position / error / pong / task.created / task.cancelled / assistant.text / direct.completed, etc.
- **Termination contract**: socket closes after exactly one of `session.ended` (regular) or `direct.completed` (fast path).
- **Server**: `createServer()` (574), `handleCommand()` (115), `processQueue()` (48-58, serial one-task-at-a-time), `handleRun()` (443-563). `createDaemonEventLog()` (85-112) forwards non-internal events to client.

## 4. Adding a Ctrl+P modal overlay

- **Keybinding**: add `if (buf[0] === 0x10) return 'Ctrl+p';` to parseKey (before the single-byte catch-all at line 1117), then consume in tryHandleGlobal or via `KeyDispatcher.on('Ctrl+p', ...)`.
- **Rendering**: follow the `paintPlanApprovalCard()` precedent (892-934) — paint the modal onto the view canvas AFTER view.render, using drawBox + write. Paints last → overlays.
- **Input routing**: in handleRaw, when modal open, short-circuit all keys to a modal handler (filter / arrows / Enter confirm / Escape dismiss).
- **State**: add modal fields to TuiAppState or as TuiApp instance props.
- **Files**: app.ts (parseKey +1 case, handleRaw modal branch, paint method, modal handler), state.ts (optional), new command-registry module.

## Assets

- Full trace in ticket #309 comment history.
- Key precedent: plan-approval-card overlay (app.ts:892-934) is the exact modal pattern to reuse.
