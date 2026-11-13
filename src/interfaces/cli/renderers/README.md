# CLI REPL Renderer

## Overview
Interactive terminal session for `alix run --chat`. The renderer wraps a readline prompt loop, routes user lines to an `AgentSession`, prints turn results, and implements the built-in `/exit`, `/quit`, `/save`, `/status`, `/sessions`, and `/resume` commands. The two slash-command handlers are exported separately so they can be driven in tests without a live terminal.

## Interface
- `AgentRenderer` — `start()`, `render(result)`, `stop()` lifecycle interface `[repl.ts:AgentRenderer]`.
- `ReplRendererOptions` — optional `sessionMode`, `events` subscription, and `SessionStore` for session commands `[repl.ts:ReplRendererOptions]`.
- `createReplEvents()` — default stdout-rendering `AgentSessionEvents` for token, tool-call, and tool-result streaming `[repl.ts:createReplEvents]`.
- `createReplRenderer(session, options?)` — build the readline renderer over an `AgentSession` `[repl.ts:createReplRenderer]`.
- `handleSessionsCommand(store)` — list the most recent persisted sessions through `store.list(10)` `[repl.ts:handleSessionsCommand]`.
- `handleResumeCommand(line, session, store)` — parse `/resume <sessionId>` and restore the session `[repl.ts:handleResumeCommand]`.

## Invariants
- Blank/whitespace-only input lines are skipped and never sent to the session `[repl.ts:createReplRenderer]`.
- `start()` creates readline with `terminal: input.isTTY ?? false`, so piped stdin is treated as non-interactive `[repl.ts:createReplRenderer]`.
- A readline `question()` rejection (EOF/Ctrl+D or closed interface) exits the loop rather than surfacing an error `[repl.ts:createReplRenderer]`.
- Rendering never duplicates streamed output: the summary is printed only when `result.streamed` is false `[repl.ts:createReplRenderer]`.
- `/resume` requires exactly one token after the command; missing or multiple ids print `Usage: /resume <sessionId>` `[repl.ts:handleResumeCommand]`.
- With a wired store, `/resume` pre-checks `store.load(sessionId)` and reports `Session <id> not found.` without attempting a resume `[repl.ts:handleResumeCommand]`.
- Without a store, `/sessions` prints a hint and `/resume` skips the pre-flight existence check, relying on `AgentSession.resume` `[repl.ts:handleSessionsCommand]`.

## Side Effects
- Reads stdin and writes prompts, tokens, tool lines, and results to stdout/stderr `[repl.ts:createReplRenderer]`.
- `/save` calls `session.save({ interactiveDecisions: true })`, persisting session state `[repl.ts:createReplRenderer]`.
- `/sessions` calls `store.list(10)`; `/resume` calls `store.load` and `session.resume`, touching persisted session storage `[repl.ts:handleSessionsCommand]`.
- Each normal line calls `session.processTurn(trimmed)` and then renders the returned `AgentTurnResult` `[repl.ts:createReplRenderer]`.
- `stop()` closes the readline interface and clears the reference `[repl.ts:createReplRenderer]`.

## Verification
- Run: `pnpm test`
