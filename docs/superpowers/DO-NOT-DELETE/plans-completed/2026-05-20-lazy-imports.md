# Lazy Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce startup time by deferring loading of optional/conditional modules until they're actually needed.

**Architecture:**
- Replace top-level imports with dynamic `import()` for:
  - MCP manager (only if MCP servers configured)
  - Subagent manager (only if subagents.enabled in config)
  - Inspector server (only if UI enabled)
  - Extension registry (only if extensions configured)
  - Memory store (only if memory features used)

**Tech Stack:** TypeScript, Node.js dynamic imports.

---

### Task 1: Profile Current Startup Time

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Measure baseline startup time**

```bash
time node dist/src/cli.js --help 2>&1 | head -5
```

Expected: Record current startup time.

- [ ] **Step 2: Identify top-level imports that could be lazy**

Look at imports in run.ts that are used conditionally:
- `McpManager` — only if `config.mcpServers?.length`
- `SubagentManager` — only if `config.subagents?.enabled`
- Inspector SSE server — only if `config.ui?.enabled`
- `MemoryStore` — only if memory features enabled

- [ ] **Step 3: Document findings**

Add comments showing which imports are used with conditions.

---

### Task 2: Convert MCP Manager to Lazy Import

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Find MCP Manager usage pattern**

```typescript
// Current (eager):
import { McpManager } from "./mcp/manager.js";
const mcpManager = new McpManager(/* ... */);

// Target (lazy):
const mcpManager = await import("./mcp/manager.js").then(m => new m.McpManager(/* ... */));
```

- [ ] **Step 2: Add conditional lazy loader**

```typescript
async function getMcpManager(config: AlixConfig, /* ... */) {
  if (!config.mcpServers?.length) return null;
  const { McpManager } = await import("./mcp/manager.js");
  return new McpManager(/* ... */);
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build 2>&1 | tail -5`
Expected: Build succeeds

---

### Task 3: Convert SubagentManager to Lazy Import

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Find SubagentManager usage**

Only instantiated when `config.subagents?.enabled`.

- [ ] **Step 2: Add conditional lazy loader**

```typescript
async function getSubagentManager(config: AlixConfig, sessionId: string) {
  if (!config.subagents?.enabled) return null;
  const { SubagentManager } = await import("./agents/subagent-manager.js");
  return new SubagentManager({ sessionId, config });
}
```

- [ ] **Step 3: Verify build**

---

### Task 4: Convert Inspector Server to Lazy Import

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Find inspector SSE server usage**

Only started when `config.ui?.enabled`.

- [ ] **Step 2: Add conditional lazy loader**

```typescript
async function startInspectorServer(config: AlixConfig, sessionDir: string, eventLog: EventLog) {
  if (!config.ui?.enabled) return null;
  const { createInspectorServer } = await import("./inspector/server.js");
  return createInspectorServer(sessionDir, eventLog);
}
```

- [ ] **Step 3: Verify build**

---

### Task 5: Verify and Benchmark

**Files:**
- Modify: `src/run.ts`

- [ ] **Step 1: Measure new startup time**

```bash
time node dist/src/cli.js --help 2>&1 | head -5
```

- [ ] **Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -5`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add src/run.ts
git commit -m "perf: lazy load optional modules for faster startup

- Lazy load McpManager (only if MCP servers configured)
- Lazy load SubagentManager (only if subagents.enabled)
- Lazy load Inspector server (only if ui.enabled)
- Measure startup time improvement
"
```