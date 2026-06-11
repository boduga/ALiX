# M0.18: Policy/Approval Audit Trail

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable audit trail that records policy evaluations, approval lifecycle events, graph continuation decisions, and runtime gate outcomes — so ALiX can answer "what happened and why" after any session.

**Architecture:** Append-only JSONL audit store at `.alix/audit/audit.jsonl`. Audit events are emitted from RuntimeGate, ApprovalStore, and CLI handlers. A new `alix audit` CLI and Inspector Audit tab provide read-only visibility.

**Tech Stack:** TypeScript, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/audit/audit-types.ts` | **Create** | AuditAction, AuditRecord types |
| `src/audit/audit-store.ts` | **Create** | Append-only JSONL AuditStore |
| `src/policy/runtime-gate.ts` | **Modify** | Emit audit records from evaluated decisions |
| `src/approvals/approval-store.ts` | **Modify** | Emit audit on request/resolve |
| `src/cli.ts` | **Modify** | Add audit CLI + wire into graph continue and policy eval |
| `src/server/server.ts` | **Modify** | Add `GET /api/audit` route |
| `src/ui/index.html` | **Modify** | Add Audit tab |
| `src/ui/app.js` | **Modify** | Load + render audit events |
| `src/ui/styles.css` | **Modify** | Audit timeline CSS |
| `tests/audit/audit-store.test.ts` | **Create** | Tests for append, list, filter |
| `tests/server/server.test.ts` | **Modify** | `GET /api/audit` smoke test |

---

### Task 1: Audit types and store

**Files:**
- Create: `src/audit/audit-types.ts`
- Create: `src/audit/audit-store.ts`
- Create: `tests/audit/audit-store.test.ts`

- [ ] **Step 1: Create audit-types.ts**

```typescript
/**
 * audit-types.ts — Audit event types for policy and approval tracking.
 */

export type AuditAction =
  | "policy.evaluated"
  | "policy.allowed"
  | "policy.denied"
  | "policy.asked"
  | "approval.created"
  | "approval.approved"
  | "approval.denied"
  | "runtime.blocked"
  | "runtime.allowed"
  | "runtime.requires_approval"
  | "graph.continued"
  | "graph.completed";

export interface AuditDetails {
  graphId?: string;
  nodeId?: string;
  capability?: string;
  approvalId?: string;
  policyRuleId?: string;
  policyDecision?: string;
  reason?: string;
  sessionId?: string;
  durationMs?: number;
}

export interface AuditRecord {
  id: string;
  action: AuditAction;
  timestamp: string;
  actor?: string;
  details: AuditDetails;
}
```

- [ ] **Step 2: Create audit-store.ts**

```typescript
/**
 * audit-store.ts — Append-only JSONL audit store.
 *
 * Stores audit records at .alix/audit/audit.jsonl.
 * JSONL (newline-delimited JSON) is append-friendly and easy to tail.
 */

import { readFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { AuditRecord, AuditAction, AuditDetails } from "./audit-types.js";

export class AuditStore {
  private filePath: string;

  constructor(cwd: string) {
    this.filePath = join(cwd, ".alix", "audit", "audit.jsonl");
  }

  /** Ensure the directory exists. */
  private async ensureDir(): Promise<void> {
    const dir = join(this.filePath, "..");
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
  }

  /** Append an audit record. Returns the created record with generated ID. */
  async append(opts: {
    action: AuditAction;
    actor?: string;
    details: AuditDetails;
  }): Promise<AuditRecord> {
    const record: AuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      action: opts.action,
      timestamp: new Date().toISOString(),
      actor: opts.actor,
      details: opts.details,
    };
    await this.ensureDir();
    await appendFile(this.filePath, JSON.stringify(record) + "\n", "utf-8");
    return record;
  }

  /** Read all audit records (newest first). */
  async list(limit = 100): Promise<AuditRecord[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf-8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const records: AuditRecord[] = [];
    for (const line of lines) {
      try { records.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, limit);
  }

  /** Filter by action. */
  async findByAction(action: AuditAction, limit = 50): Promise<AuditRecord[]> {
    const all = await this.list(limit * 10);
    return all.filter(r => r.action === action).slice(0, limit);
  }

  /** Filter by graph ID. */
  async findByGraph(graphId: string, limit = 50): Promise<AuditRecord[]> {
    const all = await this.list(limit * 10);
    return all.filter(r => r.details.graphId === graphId).slice(0, limit);
  }

  /** Filter by approval ID. */
  async findByApproval(approvalId: string, limit = 50): Promise<AuditRecord[]> {
    const all = await this.list(limit * 10);
    return all.filter(r => r.details.approvalId === approvalId).slice(0, limit);
  }
}
```

- [ ] **Step 3: Create audit-store.test.ts**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditStore } from "../../src/audit/audit-store.js";

describe("AuditStore", () => {
  it("appends and lists records", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-test-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "policy.allowed", details: { capability: "web.search" } });
      await store.append({ action: "approval.created", actor: "policy", details: { approvalId: "app_1" } });
      const list = await store.list();
      assert.equal(list.length, 2);
      assert.equal(list[0].action, "approval.created");
      assert.equal(list[1].action, "policy.allowed");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds by action", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-action-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "policy.allowed", details: {} });
      await store.append({ action: "policy.denied", details: {} });
      await store.append({ action: "policy.allowed", details: {} });
      const allowed = await store.findByAction("policy.allowed");
      assert.equal(allowed.length, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds by graph", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-graph-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "runtime.blocked", details: { graphId: "g1" } });
      await store.append({ action: "runtime.allowed", details: { graphId: "g2" } });
      const g1 = await store.findByGraph("g1");
      assert.equal(g1.length, 1);
      assert.equal(g1[0].action, "runtime.blocked");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds by approval", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-approval-"));
    try {
      const store = new AuditStore(tmpDir);
      await store.append({ action: "approval.created", details: { approvalId: "app_x" } });
      await store.append({ action: "approval.approved", details: { approvalId: "app_x" } });
      const found = await store.findByApproval("app_x");
      assert.equal(found.length, 2);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("returns empty array when no file exists", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-empty-"));
    try {
      const store = new AuditStore(tmpDir);
      const list = await store.list();
      assert.equal(list.length, 0);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("respects limit", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-limit-"));
    try {
      const store = new AuditStore(tmpDir);
      for (let i = 0; i < 10; i++) {
        await store.append({ action: "policy.evaluated", details: { capability: "test" } });
      }
      const list = await store.list(3);
      assert.equal(list.length, 3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 4: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/audit/audit-store.test.js 2>&1
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/audit/audit-types.ts src/audit/audit-store.ts tests/audit/audit-store.test.ts
git commit -m "feat(audit): add audit event types and append-only JSONL store"
```

---

### Task 2: Wire audit into RuntimeGate

**Files:**
- Modify: `src/policy/runtime-gate.ts`

- [ ] **Step 1: Add audit injection to RuntimeGate**

Add `auditStore?: AuditStore` to `RuntimeGateInput`. Import it. At each return point in `evaluateRuntimeGate()`, emit an audit record via `auditStore.append()`.

Key injection points inside the `if (caps.length > 0)` block:

```typescript
// After the missing capabilities check:
if (capResult.missingCapabilities.length > 0) {
  auditStore?.append({ action: "runtime.blocked", actor: "system", details: {
    graphId: node.graphId, nodeId: node.id,
    capability: caps.join(","),
    reason: `Missing capabilities: ${capResult.missingCapabilities.join(", ")}`,
  }}).catch(() => {});
  return { ... };
}

// After deny decision:
auditStore?.append({ action: "policy.denied", actor: "policy", details: {
  graphId: node.graphId, nodeId: node.id,
  capability: caps.join(","), policyRuleId: overall.ruleId,
  policyDecision: "deny", reason: overall.reason,
}}).catch(() => {});

// After ready from prior approval:
auditStore?.append({ action: "policy.allowed", actor: "policy", details: {
  graphId: node.graphId, nodeId: node.id,
  capability: caps.join(","), approvalId: resolved.id,
  policyDecision: "allow", reason: "Approved by prior approval",
}}).catch(() => {});

// After needs_approval (new or reused):
auditStore?.append({ action: "policy.asked", actor: "policy", details: {
  graphId: node.graphId, nodeId: node.id,
  capability: caps.join(","), approvalId: existing?.id ?? approval.id,
  policyDecision: "ask", reason: overall.reason,
}}).catch(() => {});

// At the final "All gates passed" return:
auditStore?.append({ action: "runtime.allowed", actor: "system", details: {
  graphId: node.graphId, nodeId: node.id,
  reason: "All gates passed",
}}).catch(() => {});
```

Do not let audit failures affect gate decisions — all appends use `.catch(() => {})`.

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/policy/runtime-gate.ts
git commit -m "feat(audit): emit audit events from RuntimeGate decisions"
```

---

### Task 3: Wire audit into ApprovalStore

**Files:**
- Modify: `src/approvals/approval-store.ts`

- [ ] **Step 1: Add AuditStore dependency**

Add `auditStore` as an optional constructor param:

```typescript
export class ApprovalStore {
  private approvals: ApprovalRecord[] = [];
  private dirty = false;
  private filePath: string;
  private auditStore?: AuditStore;

  constructor(cwd: string, opts?: { auditStore?: AuditStore }) {
    this.filePath = join(cwd, ".alix", "approvals", "approvals.json");
    this.auditStore = opts?.auditStore;
  }
```

- [ ] **Step 2: Emit audit in request()**

At the end of `request()`, before `return record`:

```typescript
this.auditStore?.append({ action: "approval.created", actor: "policy", details: {
  approvalId: record.id, graphId: opts.graphId, nodeId: opts.nodeId,
  capability: opts.capability, reason: opts.reason,
}}).catch(() => {});
```

- [ ] **Step 3: Emit audit in resolve()**

In `resolve()`, after setting `record.status`:

```typescript
this.auditStore?.append({
  action: status === "approved" ? "approval.approved" : "approval.denied",
  actor: "user",
  details: { approvalId: id, reason: decisionReason },
}).catch(() => {});
```

- [ ] **Step 4: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/approvals/approval-store.test.js dist/tests/audit/audit-store.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/approvals/approval-store.ts
git commit -m "feat(audit): emit audit events from approval create and resolve"
```

---

### Task 4: Audit CLI commands + wire into handlers

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `alix audit` commands**

Add help text:
```
  alix audit list [--limit N]    Show recent audit events
  alix audit by-graph <id>       Show audit events for a graph
  alix audit by-approval <id>    Show audit events for an approval
  alix audit by-action <action>  Filter by action type
```

Add the handler block before the "research" command:

```typescript
if (command === "audit") {
  const { AuditStore } = await import("./audit/audit-store.js");
  const cwd = process.cwd();
  const store = new AuditStore(cwd);

  if (args[0] === "list") {
    const limitIdx = args.indexOf("--limit");
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) || 50 : 50;
    const records = await store.list(limit);
    if (records.length === 0) { console.log("No audit records."); process.exit(0); }
    for (const r of records) {
      console.log(`${r.id.slice(0, 24).padEnd(24)} ${r.action.padEnd(22)} ${r.timestamp ? new Date(r.timestamp).toLocaleString() : ""}`);
    }
    console.log(`\n${records.length} records`);
    process.exit(0);
  }

  if (args[0] === "by-graph") {
    const graphId = args[1];
    if (!graphId) { console.error("Usage: alix audit by-graph <graphId>"); process.exit(1); }
    const records = await store.findByGraph(graphId);
    if (records.length === 0) { console.log("No records for graph."); process.exit(0); }
    for (const r of records) {
      const detail = `${r.action}${r.details.nodeId ? " node=" + r.details.nodeId : ""}${r.details.capability ? " cap=" + r.details.capability : ""}`;
      console.log(`  [${r.action}] ${new Date(r.timestamp).toLocaleTimeString()} ${detail}`);
      if (r.details.reason) console.log(`    reason: ${r.details.reason}`);
    }
    process.exit(0);
  }

  if (args[0] === "by-approval") {
    const approvalId = args[1];
    if (!approvalId) { console.error("Usage: alix audit by-approval <approvalId>"); process.exit(1); }
    const records = await store.findByApproval(approvalId);
    if (records.length === 0) { console.log("No records for approval."); process.exit(0); }
    for (const r of records) {
      console.log(`  [${r.action}] ${new Date(r.timestamp).toLocaleTimeString()} ${r.details.reason || ""}`);
    }
    process.exit(0);
  }

  if (args[0] === "by-action") {
    const action = args[1];
    if (!action) { console.error("Usage: alix audit by-action <action>"); process.exit(1); }
    const records = await store.findByAction(action as any);
    if (records.length === 0) { console.log("No records for action."); process.exit(0); }
    for (const r of records) {
      console.log(`  ${r.id.slice(0, 24)} ${new Date(r.timestamp).toLocaleTimeString()} ${r.details.capability || ""} ${r.details.reason || ""}`);
    }
    process.exit(0);
  }

  console.log("Usage: alix audit [list|by-graph|by-approval|by-action]");
  process.exit(0);
}
```

- [ ] **Step 2: Wire AuditStore into graph continue and policy eval**

In the `alix graph continue` handler, after creating the ApprovalStore, also create an AuditStore and emit:

```typescript
  const { AuditStore } = await import("./audit/audit-store.js");
  const audit = new AuditStore(cwd);
  // ... after approval resolution check and before running ...
  await audit.append({ action: "graph.continued", actor: "user", details: {
    graphId, approvalId: resolved?.id,
    reason: resolved?.decisionReason,
  }});
```

In the `alix policy eval` handler, after evaluating, emit:

```typescript
  const { AuditStore } = await import("./audit/audit-store.js");
  const audit = new AuditStore(cwd);
  await audit.append({ action: "policy.evaluated", actor: "user", details: {
    capability, policyRuleId: result.matchedRuleId,
    policyDecision: result.decision, reason: result.reason,
  }});
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add audit CLI commands and wire audit events into continue and eval"
```

---

### Task 5: Inspector Audit tab

**Files:**
- Modify: `src/server/server.ts`
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.js`
- Modify: `src/ui/styles.css`
- Modify: `tests/server/server.test.ts`

- [ ] **Step 1: Add GET /api/audit route**

In `src/server/server.ts`, add before the sessions routes:

```typescript
      if (url.pathname === "/api/audit") {
        try {
          const { AuditStore } = await import("../audit/audit-store.js");
          const store = new AuditStore(root);
          const limitParam = url.searchParams.get("limit");
          const limit = limitParam ? parseInt(limitParam, 10) || 100 : 100;
          const actionParam = url.searchParams.get("action");
          const graphParam = url.searchParams.get("graphId");
          let records;
          if (actionParam) records = await store.findByAction(actionParam as any, limit);
          else if (graphParam) records = await store.findByGraph(graphParam, limit);
          else records = await store.list(limit);
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(records));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
```

- [ ] **Step 2: Add Audit tab to HTML**

Add button after Approvals button:
```html
          <button class="tab" data-panel="audit">Audit</button>
```

Add panel:
```html
        <section class="panel" id="panel-audit" aria-label="Audit trail">
          <div class="panel-header"><h2>Audit Trail</h2></div>
          <div class="panel-body"><div id="audit-list"><p class="empty">Loading...</p></div></div>
        </section>
```

- [ ] **Step 3: Add JS function to app.js**

Add after the Approvals load function:

```javascript
async function loadAudit() {
  try {
    const res = await fetch("/api/audit?limit=100");
    const records = await res.json();
    const el = document.getElementById("audit-list");
    if (!el) return;
    if (records.length === 0) {
      el.innerHTML = '<p class="empty">No audit records.</p>';
      return;
    }
    el.innerHTML = `<div class="audit-timeline">${records.map((r: any) => {
      const actionClass = r.action.replace(/\./g, "-");
      return `<div class="audit-entry">
        <span class="audit-action action-${actionClass}">${escapeHtml(r.action)}</span>
        <span class="audit-time">${new Date(r.timestamp).toLocaleString()}</span>
        ${r.details.capability ? `<span class="cap-badge">${escapeHtml(r.details.capability)}</span>` : ""}
        ${r.details.graphId ? `<span class="audit-graph">${escapeHtml(r.details.graphId)}</span>` : ""}
        ${r.details.nodeId ? `<span class="audit-node">${escapeHtml(r.details.nodeId)}</span>` : ""}
        ${r.details.approvalId ? `<span class="audit-approval">${escapeHtml(r.details.approvalId)}</span>` : ""}
        ${r.details.reason ? `<span class="audit-reason">${escapeHtml(r.details.reason)}</span>` : ""}
      </div>`;
    }).join("")}</div>`;
  } catch { /* silently skip */ }
}
```

Add to page load:
```javascript
loadAudit();
```

- [ ] **Step 4: Add CSS**

Append to styles.css:

```css
/* === Audit view === */
.audit-timeline {
  display: flex;
  flex-direction: column;
}

.audit-entry {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  padding: 0.5rem 0.8rem;
  border-bottom: 1px solid rgba(47,58,54,0.5);
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.audit-entry:hover {
  background: rgba(184,224,96,0.04);
}

.audit-action {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 600;
  font-family: monospace;
  min-width: 120px;
}

.action-policy-allowed { background: rgba(63,185,80,0.15); color: #3fb950; }
.action-policy-denied { background: rgba(248,81,73,0.15); color: #f85149; }
.action-policy-asked { background: rgba(210,153,34,0.15); color: #d29922; }
.action-runtime-allowed { background: rgba(63,185,80,0.1); color: #7ee787; }
.action-runtime-blocked { background: rgba(248,81,73,0.1); color: #ff7b72; }
.action-runtime-requires-approval { background: rgba(210,153,34,0.1); color: #d29922; }
.action-approval-created { background: rgba(88,166,255,0.15); color: #58a6ff; }
.action-approval-approved { background: rgba(63,185,80,0.15); color: #3fb950; }
.action-approval-denied { background: rgba(248,81,73,0.15); color: #f85149; }
.action-graph-continued { background: rgba(163,113,247,0.15); color: #a371f7; }
.action-policy-evaluated { background: rgba(139,148,158,0.15); color: #8b949e; }

.audit-time {
  color: var(--muted, #a59f90);
  font-size: 0.75rem;
  font-family: monospace;
}

.audit-graph, .audit-node, .audit-approval {
  font-family: monospace;
  font-size: 0.75rem;
  color: var(--muted, #a59f90);
}

.audit-reason {
  font-size: 0.8rem;
  color: var(--text, #f5f0df);
  width: 100%;
  margin-top: 0.15rem;
}
```

- [ ] **Step 5: Add HTTP smoke test**

Add to `tests/server/server.test.ts`:

```typescript
describe("Audit API", () => {
  it("GET /api/audit returns array", async () => {
    const { startServer } = await import("../../src/server/server.js");
    const tmpDir = mkdtempSync(join(tmpdir(), "audit-api-test-"));
    try {
      const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
      const body = await httpGet(`${url}/api/audit`);
      const data = JSON.parse(body);
      assert.ok(Array.isArray(data));
      await close();
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 6: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/audit/audit-store.test.js dist/tests/server/server.test.js 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/server.ts src/ui/index.html src/ui/app.js src/ui/styles.css tests/server/server.test.ts
git commit -m "feat(ui): add Inspector Audit tab with action badges and details"
```

---

### Task 6: Full build, test, tag

- [ ] **Step 1: Full build**

```bash
npm run build 2>&1 | tail -3
```

- [ ] **Step 2: Run all affected test suites**

```bash
node --test dist/tests/audit/audit-store.test.js dist/tests/approvals/approval-store.test.js dist/tests/policy/runtime-gate.test.js dist/tests/server/server.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Push and tag**

```bash
git push
git tag -a m0.18-audit-trail-baseline -m "M0.18 policy/approval audit trail baseline"
git push origin m0.18-audit-trail-baseline
```
