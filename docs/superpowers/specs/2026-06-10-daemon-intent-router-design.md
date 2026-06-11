# M0.24: Task Router — Core Runtime Design Spec

**Status:** Draft
**Supersedes:** M0.21 hardcoded `daemonShellAlias()` in `daemon-server.ts`
**Builds on:** M0.20 (daemon server), M0.21 (daemon execution), M0.22 (task control), M0.23 (reliability)

---

## Problem

`daemonShellAlias()` in `src/daemon/daemon-server.ts` hardcodes phrase-to-command mappings:

```typescript
function daemonShellAlias(task: string): string | null {
  const t = task.trim().toLowerCase();
  if (t === "list files" || t === "show files" || t === "ls") return "ls -la";
  if (t === "pwd" || t === "where am i") return "pwd";
  return null;
}
```

| Issue | Impact |
|-------|--------|
| Brittle matching | "show directory", "what files here?", "dir", "list src files" all miss |
| Bypasses architecture | Executes `execFile("bash", ...)` directly — no policy, no events, no capability check |
| No extensibility | Every new intent requires a new hardcoded `if` |
| Wrong layer | The daemon shouldn't synthesize shell commands; that's the model/tool layer's job |
| Daemon-only | No-daemon TUI doesn't benefit — still always hits the full agent loop |

## Solution

Introduce a **shared task router** in `src/runtime/` that classifies task intent into one of four execution paths. Both TUI modes (daemon and no-daemon) call the same router; only the execution backend differs.

```
TUI / CLI / Daemon input
    ↓
shared taskRouter(task)
    ↓
┌─────────────────────┬───────────────────────┬───────────────────────┬─────────────────┐
│  kind: "tool"       │ kind: "chat"          │ kind:                 │ kind: "agent"   │
│                     │                       │ "grounded_chat"       │                 │
│  ─────────────      │ ──────────────        │ ────────────────      │ ──────────────  │
│  single             │ direct model call     │ model + read-only     │ full runTask()  │
│  ToolExecutor       │ (no tools, no         │ tool budget           │ agent loop      │
│  .execute()         │  context compile)     │                       │                 │
│                     │                       │                       │                 │
│  "ls"               │ "write a short story" │ "latest Node.js LTS?" │ "refactor auth" │
│  "pwd"              │ "explain OOP"         │ "search web for..."   │ "fix tests"     │
│  "cat package.json" │ "tell me a joke"      │ "what's the news?"    │ "implement x"   │
└─────────────────────┴───────────────────────┴───────────────────────┴─────────────────┘
    │                     │                       │                       │
    └─────────────────────┴───────────────────────┴───────────────────────┘
                                      ↓
                          executeTask(route, runtime)
                                      ↓
              ┌───────────────────────────────────────────┐
              │                                           │
     LocalRuntimeExecutor                    DaemonRuntimeExecutor
     (same process)                        (via Unix socket)
              │                                           │
              │  tool → ToolExecutor                       │  tool → ToolExecutor
              │  chat → provider.complete()                │  chat → provider.complete()
              │  grounded → 2-round tool loop              │  grounded → 2-round tool loop
              │  agent → runTask()                         │  agent → runTask()
              │                                           │
              └───────────────────────────────────────────┘
```

### Route types

```typescript
type TaskRouteKind = "tool" | "chat" | "grounded_chat" | "agent";

type TaskRoute =
  | { kind: "tool"; tool: string; args: Record<string, unknown> }
  | { kind: "chat"; prompt: string }
  | { kind: "grounded_chat"; prompt: string; allowedTools: string[] }
  | { kind: "agent"; task: string };
```

| Route | Runtime | Example |
|-------|---------|---------|
| `tool` | Single deterministic tool call | `ls`, `pwd`, `cat file` |
| `chat` | Direct model, no tools | `write a story` |
| `grounded_chat` | Model + read-only tools (web.search, file.read) | `latest Node.js LTS`, `search web` |
| `agent` | Full runTask agent loop | `refactor auth`, `fix tests` |

### Router logic (pure classification — no execution)

```typescript
// src/runtime/task-router.ts — shared, no side effects

const GROUNDED_CHAT_PATTERNS = [
  /\blatest\b/i, /\bcurrent\b/i, /\btoday\b/i, /\brecent\b/i,
  /\bnews\b/i, /\bsearch\b/i, /\blook up\b/i, /\bweb\b/i,
  /\bprice\b/i, /\bversion\b/i, /\brelease\b/i, /\bschedule\b/i,
  /\bcompare current\b/i,
];

function isGroundedChatTask(task: string): boolean {
  return GROUNDED_CHAT_PATTERNS.some((p) => p.test(task));
}

function taskRouter(task: string): TaskRoute {
  // 1. Shell commands → tool route via shell.run
  if (isShellTask(task)) {
    return { kind: "tool", tool: "shell.run", args: { command: task } };
  }

  // 2. Grounded questions → read-only tool budget
  if (isGroundedChatTask(task)) {
    return { kind: "grounded_chat", prompt: task, allowedTools: ["web.search", "web_fetch"] };
  }

  // 3. Research/docs tasks → direct chat (no tools)
  const taskType = classifyTask(task);
  if (taskType === "research" || taskType === "docs") {
    return { kind: "chat", prompt: task };
  }

  // 4. Everything with write/modify signals → full agent loop
  return { kind: "agent", task };
}
```

> **Detection domains for grounded_chat:** Software versions, laws/regulations, markets/prices, sports/schedules, jobs, security advisories, model/API docs, or any topic where freshness matters. The signal set can be extended without changing the route structure.

### Execution layer (two backends)

**LocalRuntimeExecutor** — used by no-daemon TUI, `alix run`, `alix chat`:

```typescript
type RuntimeExecutor = {
  executeTool(route, ctx): Promise<string>;
  executeChat(route, ctx): Promise<string>;
  executeGroundedChat(route, ctx): Promise<string>;
  executeAgent(route, ctx): Promise<string>;
};

// dispatch:
async function executeRoute(route: TaskRoute, ctx: RuntimeContext, executor: RuntimeExecutor): Promise<string> {
  switch (route.kind) {
    case "tool":         return executor.executeTool(route, ctx);
    case "chat":         return executor.executeChat(route, ctx);
    case "grounded_chat": return executor.executeGroundedChat(route, ctx);
    case "agent":        return executor.executeAgent(route, ctx);
  }
}
```

**DaemonRuntimeExecutor** — used by daemon-backed TUI. Shares the same `executeRoute()` dispatch; the executor implementation lives in the daemon process and streams results over the Unix socket.

### How the two TUI paths connect

```
No-daemon TUI:
  runTui()
    ↓ readLine() → task
    ↓ taskRouter(task) → TaskRoute
    ↓ executeRoute(route, ctx, localExecutor)
    ↓ display result

Daemon TUI:
  runTui()
    ↓ readLine() → task
    ↓ serialize route as JSON
    ↓ socket.write({ command: "run", route })
    ↓ daemon deserializes → executeRoute(route, ctx, daemonExecutor)
    ↓ stream events back → display
```

The key insight: **both paths classify the task the same way**. The daemon path serializes the already-classified route to the socket rather than re-classifying on the daemon side. This means:

- Classification logic lives in one place (`src/runtime/task-router.ts`)
- The daemon's `handleRun` receives a pre-classified route, not a raw task string
- The daemon's `daemonShellAlias()` and its raw-task routing logic are fully removed

### Grounded Chat execution

`grounded_chat` is a lightweight 2-round model + tool loop:

```
model produces search query
  ↓
read-only tool executes (web.search, web_fetch)
  ↓
model synthesizes answer from tool output
  ↓
response streamed
```

Lighter than the agent loop:
- **No context compilation** — no repo map, no scope tracker
- **No plan phase** — no plan prompt, no approval gate
- **No mutation tracking** — no file changes, no checkpoints
- **No state machine** — no autonomy loops, max 2 rounds
- **No MCP discovery** — only the explicit allowedTools list

### Daemon connection changes

Currently the daemon protocol sends a raw task string:

```json
{ "command": "run", "task": "list files" }
```

With the shared router, the TUI classifies first and sends the route:

```json
{ "command": "run", "route": { "kind": "tool", "tool": "shell.run", "args": { "command": "ls -la" } } }
```

The daemon's `handleRun` switches on `route.kind` instead of re-classifying. The backward-compatible fallback: if `route` is absent, daemon calls `taskRouter()` itself.

## Files

| File | Action | Responsibility |
|------|--------|---------------|
| `src/runtime/task-router.ts` | **Create** | `taskRouter()`, `TaskRoute` type, route classification (shared, no side effects) |
| `src/runtime/route-executor.ts` | **Create** | `executeRoute()`, `RuntimeExecutor` interface, local executor implementation |
| `src/cli/commands/tui.ts` | **Modify** | Wire no-daemon TUI through `taskRouter()` + `executeRoute()` instead of direct `runTask()` |
| `src/cli/commands/tui.ts` | **Modify** | Wire daemon TUI through `taskRouter()` first, then send route to daemon |
| `src/daemon/daemon-server.ts` | **Modify** | Remove `daemonShellAlias()`, handle pre-classified routes from client |
| `src/daemon/daemon-types.ts` | **Modify** | Add route-based command type |
| `src/daemon/daemon-router.ts` | **Delete** | Not needed — functionality moves to shared `src/runtime/task-router.ts` |
| `tests/runtime/task-router.test.ts` | **Create** | Unit tests for route classification |
| `tests/runtime/route-executor.test.ts` | **Create** | Unit tests for route execution |
| `tests/daemon/daemon-server.test.ts` | **Modify** | Route-based daemon integration tests |

## Future: ML-based classification (Phase 2)

The shared `taskRouter()` can be upgraded to use a small local model for classification without changing the call sites or route types:

```typescript
async function taskRouter(task: string): Promise<TaskRoute> {
  // Phase 2: use a small local model to classify intent from natural language
  return classifyIntentWithModel(task, {
    // Structured output: kind + tool/args for tool routes
  });
}
```

Output examples:
```json
{ "kind": "grounded_chat", "prompt": "latest Node.js LTS version?", "allowedTools": ["web.search"] }
{ "kind": "tool", "tool": "filesystem.list", "args": { "path": "." } }
{ "kind": "chat", "prompt": "write a haiku about coding" }
{ "kind": "agent", "task": "add dark mode to the dashboard" }
```

The rule-based and ML-based classifiers share the same return types and execution paths, making this a drop-in replacement.

## Testing

| Test | Description |
|------|-------------|
| `"ls" → tool` | Shell pattern hits tool route |
| `"cat package.json" → tool` | Shell with arg hits tool route |
| `"latest Node.js LTS" → grounded_chat` | Freshness signal hits grounded_chat |
| `"search the web" → grounded_chat` | Web signal hits grounded_chat |
| `"explain OOP" → chat` | Research task hits chat route |
| `"write a story" → chat` | Docs task hits chat route |
| `"refactor auth" → agent` | Write task hits agent route |
| `"fix tests" → agent` | Bugfix task hits agent route |
| `"flargle bargle" → agent` | Unknown falls through to agent |
| No-daemon TUI: "ls" → tool output | Local executor returns listing |
| No-daemon TUI: "explain OOP" → text | Local executor returns response |
| Daemon TUI: "ls" → tool output | Daemon executor returns listing |
| Daemon TUI: "latest Node.js" → text | Daemon executor returns answer |
| Same task, same route | Both modes classify identically |

## Non-goals

- **No fuzzy matching**: Phase 1 uses exact pattern matching. "list my files" won't match `isShellTask()`. That's Phase 2 ML work.
- **No new tool definitions**: Reuses `shell.run` from existing tool-router. `filesystem.list` is future work.
- **No TUI rewrite**: The existing ink/render TUI loop stays. Only the execution path changes.
