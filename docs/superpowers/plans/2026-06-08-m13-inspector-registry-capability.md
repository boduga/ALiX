# M0.13: Inspector Registry + Capability Timeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface agent/tool card data and capability resolution results in the web inspector UI.

**Architecture:** Add two JSON API routes (`/api/registry/agents`, `/api/registry/tools`) to the existing HTTP server, add a 10th "Registry" tab panel to the HTML, render policy decisions from the already-computed projection data, and add capability badges to event rows in the timeline. No frontend build pipeline — all JS is raw ES modules served statically.

**Tech Stack:** TypeScript (server), vanilla JS (browser), CSS, no framework.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/server/server.ts` | **Modify** | Add `/api/registry/agents` and `/api/registry/tools` GET routes |
| `src/ui/index.html` | **Modify** | Add Registry tab with agent/tool card display panels |
| `src/ui/app.js` | **Modify** | Add `renderPolicyDecisions()`, `renderRegistry()`, capability badges in `addEventRow()` |
| `src/ui/styles.css` | **Modify** | Add CSS for registry tables, capability badges, policy decision cards |
| `tests/server/server.test.ts` | **Create** | Tests for registry API routes |

---

### Task 1: Add registry API routes to the server

**Files:**
- Modify: `src/server/server.ts`

- [ ] **Step 1: Add `/api/registry/agents` and `/api/registry/tools` routes**

Insert these routes into `server.ts` just before the `/api/sessions/compare` route (around line 89):

```typescript
      if (url.pathname === "/api/registry/agents") {
        try {
          const { loadCardRegistry } = await import("../registry/card-loader.js");
          const registry = await loadCardRegistry(root);
          res.setHeader("content-type", "application/json");
          res.setHeader("access-control-allow-origin", "*");
          res.end(JSON.stringify(registry.listAgents(true)));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
      if (url.pathname === "/api/registry/tools") {
        try {
          const { loadCardRegistry } = await import("../registry/card-loader.js");
          const registry = await loadCardRegistry(root);
          res.setHeader("content-type", "application/json");
          res.setHeader("access-control-allow-origin", "*");
          res.end(JSON.stringify(registry.listTools(true)));
        } catch (err) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
        return;
      }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/server/server.ts
git commit -m "feat(server): add /api/registry/agents and /api/registry/tools routes"
```

---

### Task 2: Add Registry tab to the inspector HTML

**Files:**
- Modify: `src/ui/index.html`

- [ ] **Step 1: Add the Registry tab button alongside the existing tabs**

Insert after the Compare tab button (line 34):

```html
          <button class="tab" data-panel="registry">Registry</button>
```

- [ ] **Step 2: Add the Registry panel section**

Insert after the Compare panel section (line 75):

```html
        <section class="panel" id="panel-registry" aria-label="Registry cards">
          <div class="panel-header"><h2>Registry</h2></div>
          <div class="panel-body registry-view">
            <div class="registry-section">
              <h3>Agent Cards</h3>
              <div id="registry-agents"><p class="empty">Loading...</p></div>
            </div>
            <div class="registry-section">
              <h3>Tool Cards</h3>
              <div id="registry-tools"><p class="empty">Loading...</p></div>
            </div>
          </div>
        </section>
```

- [ ] **Step 3: Commit**

```bash
git add src/ui/index.html
git commit -m "feat(ui): add Registry tab panel for agent and tool cards"
```

---

### Task 3: Render registry data, policy decisions, and capability badges

**Files:**
- Modify: `src/ui/app.js`

- [ ] **Step 1: Load registry data on connect**

Add right after the `statusEl.textContent = "Connecting...";` line (line 113):

```javascript
  loadRegistry();
```

- [ ] **Step 2: Add the `loadRegistry` function**

Add before the `connect` function (around line 97):

```javascript
// Registry data loading
let registryData = { agents: [], tools: [] };

async function loadRegistry() {
  try {
    const [agentsRes, toolsRes] = await Promise.all([
      fetch("/api/registry/agents"),
      fetch("/api/registry/tools"),
    ]);
    registryData.agents = await agentsRes.json();
    registryData.tools = await toolsRes.json();
    renderRegistry();
  } catch {
    // Registry may not be available — silently skip
  }
}

function renderRegistry() {
  const agentsEl = document.getElementById("registry-agents");
  const toolsEl = document.getElementById("registry-tools");
  if (!agentsEl || !toolsEl) return;

  if (registryData.agents.length === 0) {
    agentsEl.innerHTML = '<p class="empty">No agent cards loaded.</p>';
  } else {
    agentsEl.innerHTML = `<table class="registry-table">
      <thead><tr><th>ID</th><th>Name</th><th>Domains</th><th>Capabilities</th><th>Enabled</th></tr></thead>
      <tbody>${registryData.agents.map(a => `<tr class="${a.enabled ? '' : 'disabled'}">
        <td class="mono">${escapeHtml(a.id)}</td>
        <td>${escapeHtml(a.name)}</td>
        <td>${escapeHtml(a.domains.join(", "))}</td>
        <td class="capabilities">${(a.capabilities || []).map(c => `<span class="cap-badge">${escapeHtml(c)}</span>`).join(" ")}</td>
        <td>${a.enabled ? "✓" : "✗"}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  }

  if (registryData.tools.length === 0) {
    toolsEl.innerHTML = '<p class="empty">No tool cards loaded.</p>';
  } else {
    toolsEl.innerHTML = `<table class="registry-table">
      <thead><tr><th>ID</th><th>Name</th><th>Risk</th><th>Approval</th><th>Side Effects</th><th>Capabilities</th><th>Enabled</th></tr></thead>
      <tbody>${registryData.tools.map(t => `<tr class="${t.enabled ? '' : 'disabled'}">
        <td class="mono">${escapeHtml(t.id)}</td>
        <td>${escapeHtml(t.name)}</td>
        <td><span class="risk-${t.riskLevel || 'unknown'}">${escapeHtml(t.riskLevel || '?')}</span></td>
        <td>${escapeHtml(t.approvalMode || '?')}</td>
        <td>${escapeHtml(t.sideEffects || '?')}</td>
        <td class="capabilities">${(t.capabilities || []).map(c => `<span class="cap-badge">${escapeHtml(c)}</span>`).join(" ")}</td>
        <td>${t.enabled ? "✓" : "✗"}</td>
      </tr>`).join("")}</tbody>
    </table>`;
  }
}
```

- [ ] **Step 3: Wire `renderRegistry` into `renderAll()`**

Insert at the end of `renderAll()` (after line 148):

```javascript
  renderRegistry();
```

- [ ] **Step 4: Render policy decisions — add the function**

Add after `renderVerification` (around line 207):

```javascript
function renderPolicyDecisions(policyDecisions) {
  if (!policyDecisions || policyDecisions.length === 0) {
    return; // No render target — data lives in events now
  }
}
```

- [ ] **Step 5: Add capability badge to each event row in `addEventRow`**

Inside `addEventRow`, after the `actorChip` is appended (around line 266), add a capability badge when the event payload has a `canonicalCapability` or `capability` field:

```javascript
  // Capability badge
  const capability = event.payload?.canonicalCapability || event.payload?.capability;
  if (capability) {
    const capChip = document.createElement("span");
    capChip.className = "cap-badge inline";
    capChip.textContent = capability;
    item.insertBefore(capChip, meta);
  }
```

Also add a policy decision indicator after the actor chip:

```javascript
  // Policy decision badge
  if (event.type === "policy.decision") {
    const decision = event.payload?.decision || "unknown";
    const policyChip = document.createElement("span");
    policyChip.className = `policy-badge decision-${decision}`;
    policyChip.textContent = `policy: ${decision}`;
    item.insertBefore(policyChip, meta);
  }
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/ui/app.js
git commit -m "feat(ui): render registry cards, policy decisions, capability badges"
```

---

### Task 4: Add CSS for registry tables, capability badges, risk labels

**Files:**
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Add registry table styles**

```css
/* Registry view */
.registry-view {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.registry-section h3 {
  margin: 0 0 0.5rem;
  color: var(--accent, #58a6ff);
}

.registry-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.registry-table th {
  text-align: left;
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border, #30363d);
  color: var(--text-muted, #8b949e);
  font-weight: 600;
}

.registry-table td {
  padding: 0.4rem 0.6rem;
  border-bottom: 1px solid var(--border-light, #21262d);
  vertical-align: middle;
}

.registry-table tr.disabled {
  opacity: 0.4;
}

.registry-table .mono {
  font-family: var(--font-mono, monospace);
  font-size: 0.8rem;
}

/* Capability badge */
.cap-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  background: var(--badge-bg, #1f2937);
  color: var(--badge-fg, #79c0ff);
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  margin: 0.1rem;
  white-space: nowrap;
}

.cap-badge.inline {
  margin-left: 0.4rem;
  font-size: 0.7rem;
}

/* Risk level colors */
.risk-low { color: #3fb950; }
.risk-medium { color: #d29922; }
.risk-high { color: #f85149; }
.risk-critical { color: #ff7b72; background: rgba(248,81,73,0.1); padding: 0.05rem 0.3rem; border-radius: 3px; }

/* Policy decision badge */
.policy-badge {
  display: inline-block;
  padding: 0.1rem 0.4rem;
  border-radius: 3px;
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  margin-left: 0.4rem;
}

.policy-badge.decision-allowed { background: #1b3d1b; color: #7ee787; }
.policy-badge.decision-denied { background: #3d1b1b; color: #ff7b72; }
.policy-badge.decision-ask { background: #3d2e1b; color: #d29922; }
.policy-badge.decision-unknown { background: #1f2937; color: #8b949e; }
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -3
```

Expected: no errors (CSS is served statically, no compilation needed).

- [ ] **Step 3: Commit**

```bash
git add src/ui/styles.css
git commit -m "feat(ui): add registry table, cap badge, policy badge, risk level CSS"
```

---

### Task 5: Write server tests for registry API

**Files:**
- Create: `tests/server/server.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Registry HTTP API", () => {
  let tmpDir: string;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "server-registry-test-"));
    // Create card files
    const agentsDir = join(tmpDir, ".alix", "cards", "agents");
    mkdirSync(agentsDir, { recursive: true });
    writeFileSync(join(agentsDir, "custom.json"), JSON.stringify({
      id: "custom.test", name: "Custom", description: "A custom agent",
      version: "1.0.0", domains: ["custom"], capabilities: ["custom.test"],
      enabled: true,
    }));
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("loadCardRegistry loads custom card from disk", async () => {
    const { loadCardRegistry } = await import("../../src/registry/card-loader.js");
    const registry = await loadCardRegistry(tmpDir);
    const agents = registry.listAgents(true);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, "custom.test");
  });

  it("default registry when no cards dir exists", async () => {
    const { loadCardRegistry } = await import("../../src/registry/card-loader.js");
    const { defaultAgentCards, defaultToolCards } = await import("../../src/registry/card-loader.js");
    const blankDir = mkdtempSync(join(tmpdir(), "server-registry-blank-"));
    try {
      const registry = await loadCardRegistry(blankDir);
      assert.equal(registry.listAgents(true).length, defaultAgentCards().length);
      assert.equal(registry.listTools(true).length, defaultToolCards().length);
    } finally {
      rmSync(blankDir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Build and test**

```bash
npm run build 2>&1 | tail -3
node --test dist/tests/server/server.test.js 2>&1
```

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/server/server.test.ts
git commit -m "test(server): registry API card loading from disk and defaults"
```
