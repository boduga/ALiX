# M0.17: Approval-Aware Continuation

**Status:** ✅ Completed (M0.17) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the approval queue back into graph execution — check existing approvals before creating new ones, add a `alix graph continue` command to resume after approval, and add read-only approval visibility in the Inspector.

**Architecture:** RuntimeGate checks `ApprovalStore` for existing approvals for the same graph/node/capability before creating new ones. A new `alix graph continue` command scans blocked nodes, checks approval status, and resumes if approved. The Inspector gets a read-only Approvals tab.

**Tech Stack:** TypeScript (server), vanilla JS (browser), CSS, node:test.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/policy/runtime-gate.ts` | **Modify** | Approval lookup before creating new |
| `src/approvals/approval-store.ts` | **Modify** | Add `findPending(graphId, nodeId)` method |
| `src/cli.ts` | **Modify** | Add `alix graph continue` handler |
| `src/server/server.ts` | **Modify** | Add `GET /api/approvals` route |
| `src/ui/index.html` | **Modify** | Add Approvals tab |
| `src/ui/app.js` | **Modify** | Load + render approvals |
| `src/ui/styles.css` | **Modify** | Approvals table styles |
| `tests/policy/runtime-gate.test.ts` | **Modify** | Add approval lookup tests |
| `tests/approvals/approval-store.test.ts` | **Modify** | Add `findPending` tests |
| `tests/server/server.test.ts` | **Modify** | Add `/api/approvals` HTTP test |

---

### Task 1: Add findPending to ApprovalStore

**Files:**
- Modify: `src/approvals/approval-store.ts`

- [ ] **Step 1: Add findPending method**

The `evaluateRuntimeGate` needs to find existing pending approvals for the same graph/node/capability before creating a new one. Add this method to `ApprovalStore`:

```typescript
  /** Find existing pending approval for a given graph/node/capability. */
  findPending(opts: { graphId?: string; nodeId?: string; capability?: string }): ApprovalRecord | undefined {
    return this.approvals.find(a =>
      a.status === "pending"
      && (!opts.graphId || a.graphId === opts.graphId)
      && (!opts.nodeId || a.nodeId === opts.nodeId)
      && (!opts.capability || a.capability === opts.capability)
    );
  }

  /** Find a resolved (approved/denied) approval for the same key. */
  findResolved(opts: { graphId?: string; nodeId?: string; capability?: string }): ApprovalRecord | undefined {
    const matches = this.approvals.filter(a =>
      a.status !== "pending"
      && (!opts.graphId || a.graphId === opts.graphId)
      && (!opts.nodeId || a.nodeId === opts.nodeId)
      && (!opts.capability || a.capability === opts.capability)
    );
    // Return the most recent resolved
    return matches.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  }
```

- [ ] **Step 2: Add test for findPending and findResolved**

Add to `tests/approvals/approval-store.test.ts`:

```typescript
it("findPending returns existing pending approval for graph/node/capability", async () => {
  const { store, cleanup } = freshStore();
  try {
    await store.load();
    await store.request({ reason: "test", graphId: "g1", nodeId: "n1", capability: "shell.exec" });
    const found = store.findPending({ graphId: "g1", nodeId: "n1", capability: "shell.exec" });
    assert.ok(found);
    assert.equal(found!.status, "pending");
    assert.equal(found!.graphId, "g1");
    // Wrong capability should not match
    assert.equal(store.findPending({ graphId: "g1", nodeId: "n1", capability: "other" }), undefined);
  } finally { cleanup(); }
});

it("findResolved returns most recent resolved approval", async () => {
  const { store, cleanup } = freshStore();
  try {
    await store.load();
    const a = await store.request({ reason: "first", graphId: "g1", nodeId: "n1", capability: "shell.exec" });
    await store.resolve(a.id, "denied", "Not now");
    const found = store.findResolved({ graphId: "g1", nodeId: "n1", capability: "shell.exec" });
    assert.ok(found);
    assert.equal(found!.status, "denied");
  } finally { cleanup(); }
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/approvals/approval-store.test.js 2>&1
```

Expected: 12 tests pass (10 existing + 2 new).

- [ ] **Step 4: Commit**

```bash
git add src/approvals/approval-store.ts tests/approvals/approval-store.test.ts
git commit -m "feat(approvals): add findPending and findResolved lookup methods"
```

---

### Task 2: Approval-aware RuntimeGate

**Files:**
- Modify: `src/policy/runtime-gate.ts`

**What changes:** In the `ask` branch, before creating a new approval request, check if an existing pending approval exists for the same graph/node/capability. If so, reuse it. Also check for resolved approvals — if one exists and is `approved`, return "ready" instead; if `denied`, return "blocked".

- [ ] **Step 1: Update the ask branch**

Replace the current `if (overall?.decision === "ask")` block:

```typescript
    if (overall?.decision === "ask") {
      if (!approvalStore) {
        return {
          status: "blocked",
          capabilityResolution: capResult,
          policyDecision: "ask",
          policyRuleId: overall.ruleId,
          policyReason: overall.reason,
          reason: "Approval required but no approval store configured",
        };
      }

      // Check for existing resolved approval for this graph/node/capability
      const resolved = approvalStore.findResolved({
        graphId: node.graphId, nodeId: node.id, capability: caps[0],
      });
      if (resolved) {
        if (resolved.status === "approved") {
          return { status: "ready", reason: `Approved by prior approval: ${resolved.id}` };
        }
        return {
          status: "blocked",
          capabilityResolution: capResult,
          policyDecision: "deny",
          policyReason: resolved.decisionReason,
          reason: `Prior approval was denied: ${resolved.id}`,
        };
      }

      // Check for existing pending approval — reuse rather than duplicate
      const existing = approvalStore.findPending({
        graphId: node.graphId, nodeId: node.id, capability: caps[0],
      });
      if (existing) {
        return {
          status: "needs_approval",
          capabilityResolution: capResult,
          policyDecision: "ask",
          policyRuleId: overall.ruleId,
          policyReason: overall.reason,
          approvalId: existing.id,
          reason: `Pending approval: ${existing.id}`,
        };
      }

      // No existing approval — create new one
      const approval = await approvalStore.request({
        reason: overall.reason ?? `Approval required for capability: ${caps.join(", ")}`,
        graphId: node.graphId,
        nodeId: node.id,
        capability: caps[0],
        riskLevel: node.riskLevel as any,
      });
      return {
        status: "needs_approval",
        capabilityResolution: capResult,
        policyDecision: "ask",
        policyRuleId: overall.ruleId,
        policyReason: overall.reason,
        approvalId: approval.id,
        reason: `Pending approval: ${approval.id}`,
      };
    }
```

- [ ] **Step 2: Add tests for approval lookup**

Add to `tests/policy/runtime-gate.test.ts`:

```typescript
it("reuses existing pending approval instead of duplicating", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "runtime-gate-reuse-"));
  try {
    const store = new ApprovalStore(tmpDir);
    await store.load();
    // Pre-create a pending approval
    await store.request({
      reason: "existing", graphId: "test_graph", nodeId: "test_node", capability: "shell.exec",
    });
    const registry = makeRegistry();
    const policy = makePolicy({
      id: "ask-shell", description: "Ask shell",
      match: { capability: "shell.exec" }, decision: "ask", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
      registry, policyEvaluator: policy, approvalStore: store,
    });
    assert.equal(result.status, "needs_approval");
    assert.ok(result.approvalId);
    // Should have reused — only 1 approval in store
    assert.equal(store.list().length, 1);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

it("returns ready when prior approval was approved", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { ApprovalStore } = await import("../../src/approvals/approval-store.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "runtime-gate-approved-"));
  try {
    const store = new ApprovalStore(tmpDir);
    await store.load();
    const rec = await store.request({
      reason: "prior", graphId: "test_graph", nodeId: "test_node", capability: "shell.exec",
    });
    await store.resolve(rec.id, "approved");
    const registry = makeRegistry();
    const policy = makePolicy({
      id: "ask-shell", description: "Ask shell",
      match: { capability: "shell.exec" }, decision: "ask", enabled: true,
    });
    const result = await evaluateRuntimeGate({
      node: makeNode({ requiredCapabilities: ["shell.exec"], riskLevel: "high" }),
      registry, policyEvaluator: policy, approvalStore: store,
    });
    assert.equal(result.status, "ready");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/policy/runtime-gate.test.js 2>&1
```

Expected: 9 tests pass (7 existing + 2 new).

- [ ] **Step 4: Commit**

```bash
git add src/policy/runtime-gate.ts tests/policy/runtime-gate.test.ts
git commit -m "feat(policy): approval-aware RuntimeGate — reuse and resolve checking"
```

---

### Task 3: Graph continue CLI command

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add `alix graph continue` handler**

Insert after the `graph rerun` handler and before `graph runs`:

```typescript
// --- alix graph continue --- resume after approval ---
if (command === "graph" && args[0] === "continue") {
  const graphId = args[1];
  if (!graphId) { console.error("Usage: alix graph continue <graphId>"); process.exit(1); }
  const cwd = process.cwd();
  const { loadGraph, GraphExecutor } = await import("./kernel/graph-executor.js");
  const { loadCardRegistry } = await import("./registry/card-loader.js");
  const { loadRuleEvaluator } = await import("./policy/policy-loader.js");
  const { ApprovalStore } = await import("./approvals/approval-store.js");

  try {
    const graph = await loadGraph(graphId, cwd);
    const registry = await loadCardRegistry(cwd);
    const policyEvaluator = await loadRuleEvaluator(cwd);
    const approvalStore = new ApprovalStore(cwd);
    await approvalStore.load();

    // Find first blocked node with a Pending approval reason in the graph JSON
    // Since graph JSON nodes store status, look for "blocked" or "failed" nodes
    // and check their capabilityResolution for needed capabilities
    const blockedNode = graph.nodes.find((n: any) =>
      n.status === "failed" || n.status === "blocked"
    );
    if (!blockedNode) {
      console.log("No blocked nodes found in graph. Nothing to continue.");
      process.exit(0);
    }

    const caps = blockedNode.requiredCapabilities ?? [];
    if (caps.length === 0) {
      console.log(`Node ${blockedNode.id} has no required capabilities. Run normally.`);
      process.exit(0);
    }

    // Check approval store for a resolved approval
    const pending = approvalStore.findPending({
      graphId, nodeId: blockedNode.id, capability: caps[0],
    });
    if (pending) {
      console.log(`Node ${blockedNode.id} has a pending approval: ${pending.id}`);
      console.log(`  alix approvals approve ${pending.id}`);
      console.log(`  alix approvals deny ${pending.id}`);
      process.exit(0);
    }

    const resolved = approvalStore.findResolved({
      graphId, nodeId: blockedNode.id, capability: caps[0],
    });
    if (!resolved) {
      console.log(`No approval found for node ${blockedNode.id}.`);
      console.log(`  alix graph rerun ${graphId} --node ${blockedNode.id} --force`);
      process.exit(0);
    }

    if (resolved.status === "denied") {
      console.log(`Node ${blockedNode.id} was denied: ${resolved.decisionReason || "No reason"}`);
      process.exit(1);
    }

    // Approved — run the graph via the executor (which will pass the approved gate)
    console.log(`Approval ${resolved.id} is approved. Rerunning from node ${blockedNode.id}...`);
    console.log();
    const executor = new GraphExecutor(cwd, { registry, policyEvaluator, approvalStore });
    const result = await executor.execute(graphId);
    for (const nr of result.results) {
      const icon = nr.status === "done" ? "✓" : nr.status === "failed" ? "✗" : "○";
      console.log(`  ${icon} ${nr.title} (${nr.durationMs}ms)`);
      if (nr.reason) console.log(`     reason: ${nr.reason}`);
    }
    console.log();
    console.log(`Graph: ${result.graphStatus} — ${result.completedNodes}/${result.nodeCount} nodes`);
    process.exit(0);
  } catch (err: any) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
```

Also add help text entry:

```typescript
  alix graph continue <id>  Resume execution after approval
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): add graph continue command for approval-aware resume"
```

---

### Task 4: Inspector approvals API + UI

**Files:**
- Modify: `src/server/server.ts` — add `GET /api/approvals`
- Modify: `src/ui/index.html` — add Approvals tab
- Modify: `src/ui/app.js` — load + render approvals
- Modify: `src/ui/styles.css` — approvals table CSS
- Modify: `tests/server/server.test.ts` — HTTP smoke test

- [ ] **Step 1: Add GET /api/approvals server route**

In `src/server/server.ts`, add before the sessions routes:

```typescript
      if (url.pathname === "/api/approvals") {
        try {
          const { ApprovalStore } = await import("../approvals/approval-store.js");
          const store = new ApprovalStore(root);
          await store.load();
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(store.list()));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
```

- [ ] **Step 2: Add Approvals tab to index.html**

Add button after the Policy tab button:
```html
          <button class="tab" data-panel="approvals-list">Approvals</button>
```

Add panel after the Policy panel:
```html
        <section class="panel" id="panel-approvals-list" aria-label="Approval requests">
          <div class="panel-header"><h2>Approvals</h2></div>
          <div class="panel-body approvals-view">
            <div id="approvals-list"><p class="empty">Loading...</p></div>
          </div>
        </section>
```

- [ ] **Step 3: Add JS functions to app.js**

Add after the Policy eval form listener:

```javascript
// ── Approvals tab ────────────────────────────────────────────
async function loadApprovals() {
  try {
    const res = await fetch("/api/approvals");
    const approvals = await res.json();
    const el = document.getElementById("approvals-list");
    if (!el) return;
    if (approvals.length === 0) {
      el.innerHTML = '<p class="empty">No approval requests.</p>';
      return;
    }
    el.innerHTML = `<table class="approvals-table">
      <thead><tr>
        <th>ID</th>
        <th>Status</th>
        <th>Capability</th>
        <th>Graph/Node</th>
        <th>Created</th>
        <th>Command</th>
      </tr></thead>
      <tbody>${approvals.map((a: any) => {
        const statusClass = a.status === "approved" ? "status-approved" : a.status === "denied" ? "status-denied" : "status-pending";
        const cmd = a.status === "pending" ? `alix approvals approve ${escapeHtml(a.id)}` : "";
        return `<tr>
          <td class="mono">${escapeHtml(a.id)}</td>
          <td><span class="approval-status-badge ${statusClass}">${a.status}</span></td>
          <td>${escapeHtml(a.capability || a.toolId || "—")}</td>
          <td>${escapeHtml(a.graphId || "")}${a.nodeId ? "/" + escapeHtml(a.nodeId) : ""}</td>
          <td class="mono">${new Date(a.createdAt).toLocaleString()}</td>
          <td>${cmd ? `<code class="copyable-cmd">${escapeHtml(cmd)}</code>` : ""}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  } catch {
    // silently skip
  }
}
```

Wire into page load:
```javascript
loadApprovals();
```

- [ ] **Step 4: Add CSS**

Append to `src/ui/styles.css`:

```css
/* === Approvals view === */
.approvals-view {
  padding: 0;
}

.approvals-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.approvals-table th {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--panel-line, #2f3a36);
  color: var(--muted, #a59f90);
  font-weight: 600;
}

.approvals-table td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid rgba(47,58,54,0.5);
  vertical-align: middle;
}

.approvals-table .mono {
  font-family: var(--font-mono, monospace);
  font-size: 0.8rem;
}

.approval-status-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-size: 0.8rem;
  font-weight: 600;
}

.approval-status-badge.status-pending { background: rgba(210,153,34,0.15); color: #d29922; }
.approval-status-badge.status-approved { background: rgba(63,185,80,0.15); color: #3fb950; }
.approval-status-badge.status-denied { background: rgba(248,81,73,0.15); color: #f85149; }

.copyable-cmd {
  font-size: 0.75rem;
  user-select: all;
  cursor: pointer;
}
```

Also add the CSS class for the new tab:
```css
.panel#panel-approvals-list {
  /* inherits .panel styles, just needs tab routing */
}
```

- [ ] **Step 5: Add HTTP smoke test**

Add to `tests/server/server.test.ts`:

```typescript
it("GET /api/approvals returns array", async () => {
  const { startServer } = await import("../../src/server/server.js");
  const tmpDir = mkdtempSync(join(tmpdir(), "approvals-api-test-"));
  try {
    const { url, close } = await startServer(tmpDir, "127.0.0.1", 0);
    const body = await httpGet(`${url}/api/approvals`);
    const data = JSON.parse(body);
    assert.ok(Array.isArray(data));
    await close();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 6: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/approvals/approval-store.test.js dist/tests/policy/runtime-gate.test.js dist/tests/server/server.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 7: Commit and push**

```bash
git add src/server/server.ts src/ui/index.html src/ui/app.js src/ui/styles.css tests/server/server.test.ts
git commit -m "feat(ui): add Inspector Approvals tab with status badges and copyable commands"
git push
```
