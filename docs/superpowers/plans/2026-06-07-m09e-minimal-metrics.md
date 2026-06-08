# M0.9-E: Minimal Metrics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emit M0.9 minimum metrics (`workflow_runs_total`, `model_calls_total`, `tool_calls_total`, `tool_failures_total`, `policy_decisions_total`, `policy_denials_total`) alongside existing events. Metrics are stored in-memory during a run and exposed via `alix metrics` command and debug output.

**Architecture:** A `MinimalMetrics` class with `increment()`/`duration()` methods wired into the agent loop and tool executor. Each metric call writes a `m09.metric` event to the event log and stores in an in-memory buffer for CLI display.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/kernel/minimal-metrics.ts` | **Create** | `MinimalMetrics` class, metric names/types |
| `src/cli.ts` | **Modify** | Add `alix metrics` command |
| `tests/kernel/minimal-metrics.test.ts` | **Create** | Tests |

---

### Task 1: Create MinimalMetrics module

**Files:**
- Create: `src/kernel/minimal-metrics.ts`

- [ ] **Step 1: Write the module**

```typescript
/**
 * minimal-metrics.ts — M0.9 minimum metrics.
 *
 * Increment counters for workflow/model/tool/policy events.
 * Duration timers for workflow execution.
 * All metrics are stored in-memory and exposed via alix metrics.
 */

export type M09MetricName =
  | "workflow_runs_total"
  | "model_calls_total"
  | "tool_calls_total"
  | "tool_failures_total"
  | "policy_decisions_total"
  | "policy_denials_total"
  | "workflow_duration_ms";

export interface MetricEvent {
  name: M09MetricName;
  type: "counter" | "timer";
  value: number;
  labels?: Record<string, string>;
  timestamp: string;
}

export class MinimalMetrics {
  private events: MetricEvent[] = [];

  increment(name: Exclude<M09MetricName, "workflow_duration_ms">, labels?: Record<string, string>): void {
    this.events.push({ name, type: "counter", value: 1, labels, timestamp: new Date().toISOString() });
  }

  duration(name: "workflow_duration_ms", value: number, labels?: Record<string, string>): void {
    this.events.push({ name, type: "timer", value, labels, timestamp: new Date().toISOString() });
  }

  /** Return a snapshot and clear. */
  flush(): MetricEvent[] {
    const snapshot = [...this.events];
    this.events = [];
    return snapshot;
  }

  /** Return snapshot without clearing. */
  snapshot(): MetricEvent[] {
    return [...this.events];
  }

  /** Generate a short report string for CLI display. */
  report(): string {
    const counters = this.events.filter(e => e.type === "counter");
    const timers = this.events.filter(e => e.type === "timer");
    const lines: string[] = ["M0.9 Metrics:"];
    for (const c of counters) {
      lines.push(`  ${c.name}: ${c.value}${c.labels ? ` (${JSON.stringify(c.labels)})` : ""}`);
    }
    for (const t of timers) {
      lines.push(`  ${t.name}: ${t.value}ms`);
    }
    return lines.join("\n");
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit src/kernel/minimal-metrics.ts 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add src/kernel/minimal-metrics.ts
git commit -m "feat(kernel): MinimalMetrics with counters, timers, and report"
```

---

### Task 2: Wire metrics into agent loop and tool executor

**Files:**
- Modify: `src/agent/agent-loop.ts`
- Modify: `src/tools/executor.ts`

- [ ] **Step 1: Wire metrics in agent-loop.ts**

In `runTask()`, after creating the WorkflowRun, create a `MinimalMetrics` instance. Increment `workflow_runs_total` at start. Measure duration and call `.duration("workflow_duration_ms", ...)` at completion. Pass the metrics instance through to the task loop deps (or emit `.m09.metric` events to the log).

At the end of `runTask()`, flush metrics and log them:

```typescript
import { MinimalMetrics } from "../kernel/minimal-metrics.js";

const metrics = new MinimalMetrics();
metrics.increment("workflow_runs_total", { goal: task.slice(0, 50) });

// ... after runTaskLoop returns ...
metrics.duration("workflow_duration_ms", Date.now() - startTime);
const metricEvents = metrics.flush();
for (const m of metricEvents) {
  await ctx.log.append({ ...session, actor: "system", type: "m09.metric", payload: m });
}
```

- [ ] **Step 2: Wire metrics in executor.ts**

In the `execute()` method, increment `tool_calls_total` at the start and `tool_failures_total` on failure. This requires the `MinimalMetrics` instance to be accessible — either passed through config or created locally. For M0.9, emit `m09.metric` events directly:

```typescript
await this.log.append({
  sessionId: "", actor: "system", type: "m09.metric",
  payload: { name: "tool_calls_total", type: "counter", value: 1, labels: { tool: name }, timestamp: new Date().toISOString() },
});
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/agent/agent-loop.ts src/tools/executor.ts
git commit -m "feat(kernel): wire minimal metrics into agent loop and tool executor"
```

---

### Task 3: Add `alix metrics` CLI command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add metrics command handler**

Find the `alix memory` command block and add an `alix metrics` handler before it:

```typescript
// --- alix metrics --- m09 metrics display command ---
if (command === "metrics") {
  const { MinimalMetrics } = await import("./kernel/minimal-metrics.js");
  const metrics = new MinimalMetrics();
  // Read m09.metric events from the last session
  const { readAllEvents } = await import("./inspector/session-reader.js");
  const sessionsDir = join(process.cwd(), ".alix", "sessions");
  const { readdir } = await import("node:fs/promises");
  // Show last session's metrics
  const sessionDirs = (await readdir(sessionsDir, { withFileTypes: true }))
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort()
    .reverse()
    .slice(0, 1);
  if (sessionDirs.length === 0) { console.log("No sessions found."); process.exit(0); }
  const events = await readAllEvents(join(sessionsDir, sessionDirs[0]));
  const metricEvents = events.filter(e => e.type === "m09.metric");
  if (metricEvents.length === 0) { console.log("No metrics available."); process.exit(0); }
  for (const ev of metricEvents) {
    const p = ev.payload as any;
    console.log(`${p.name}: ${p.value}${p.labels ? ` ${JSON.stringify(p.labels)}` : ""}`);
  }
  process.exit(0);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add alix metrics command"
```

---

### Task 4: Write tests

**Files:**
- Create: `tests/kernel/minimal-metrics.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MinimalMetrics } from "../../src/kernel/minimal-metrics.js";

describe("MinimalMetrics", () => {

  it("increments counters", () => {
    const m = new MinimalMetrics();
    m.increment("workflow_runs_total");
    m.increment("tool_calls_total", { tool: "file.read" });
    const snap = m.snapshot();
    assert.equal(snap.length, 2);
    assert.equal(snap[0].name, "workflow_runs_total");
    assert.equal(snap[0].value, 1);
    assert.equal(snap[1].labels?.tool, "file.read");
  });

  it("records duration", () => {
    const m = new MinimalMetrics();
    m.duration("workflow_duration_ms", 1234);
    const snap = m.snapshot();
    assert.equal(snap[0].name, "workflow_duration_ms");
    assert.equal(snap[0].type, "timer");
    assert.equal(snap[0].value, 1234);
  });

  it("flush clears the buffer", () => {
    const m = new MinimalMetrics();
    m.increment("workflow_runs_total");
    m.increment("model_calls_total");
    const flushed = m.flush();
    assert.equal(flushed.length, 2);
    assert.equal(m.snapshot().length, 0);
  });

  it("generates a readable report", () => {
    const m = new MinimalMetrics();
    m.increment("workflow_runs_total");
    m.duration("workflow_duration_ms", 5000);
    const report = m.report();
    assert.ok(report.includes("workflow_runs_total"));
    assert.ok(report.includes("workflow_duration_ms"));
  });
});
```

- [ ] **Step 2: Run tests**

```bash
node --test dist/tests/kernel/minimal-metrics.test.js 2>&1
```

- [ ] **Step 3: Commit**

```bash
git add tests/kernel/minimal-metrics.test.ts
git commit -m "test(kernel): MinimalMetrics counter, timer, flush, and report tests"
```
