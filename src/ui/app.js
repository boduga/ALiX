import { buildUiProjection, createReplayState, visibleEventsForReplay, projectSubagentEvents } from "./projection.js";

const sessionInput = document.getElementById("session-id");
const connectBtn = document.getElementById("connect-btn");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("connection-status");
const panelEls = [...document.querySelectorAll(".panel")];
const tabEls = [...document.querySelectorAll(".tab")];
const contextView = document.getElementById("context-view");
const diffView = document.getElementById("diff-view");
const terminalView = document.getElementById("terminal-view");
const approvalView = document.getElementById("approval-view");
const verificationView = document.getElementById("verification-view");
const tokenView = document.getElementById("token-view");
const subagentView = document.getElementById("subagent-view");
const replayPlay = document.getElementById("replay-play");
const replayStart = document.getElementById("replay-start");
const replayEnd = document.getElementById("replay-end");
const replayStepBack = document.getElementById("replay-step-back");
const replayStepForward = document.getElementById("replay-step-forward");
const replaySpeed = document.getElementById("replay-speed");
const replayPosition = document.getElementById("replay-position");
const compareBtn = document.getElementById("compare-btn");
const compareView = document.getElementById("compare-view");

let eventSource = null;
let allEvents = [];
let replayState = createReplayState([]);
let replayTimer = null;

// Tab switching
for (const tab of tabEls) {
  tab.addEventListener("click", () => {
    const panel = tab.dataset.panel;
    tabEls.forEach((item) => item.classList.toggle("active", item === tab));
    panelEls.forEach((item) => item.classList.toggle("active", item.id === `panel-${panel}`));
  });
}

// Replay controls
replayPlay.addEventListener("click", () => {
  replayState.playing = !replayState.playing;
  replayPlay.textContent = replayState.playing ? "Pause" : "Play";
  if (replayTimer) clearInterval(replayTimer);
  if (replayState.playing) {
    replayTimer = setInterval(() => {
      replayState.cursor = Math.min(replayState.cursor + 1, replayState.events.length);
      if (replayState.cursor === replayState.events.length) {
        replayState.playing = false;
        replayPlay.textContent = "Play";
        clearInterval(replayTimer);
      }
      renderAll();
    }, replayState.speedMs);
  }
});

replayStart.addEventListener("click", () => {
  replayState.cursor = 0;
  if (replayTimer) clearInterval(replayTimer);
  replayState.playing = false;
  replayPlay.textContent = "Play";
  renderAll();
});

replayEnd.addEventListener("click", () => {
  replayState.cursor = replayState.events.length;
  if (replayTimer) clearInterval(replayTimer);
  replayState.playing = false;
  replayPlay.textContent = "Play";
  renderAll();
});

replayStepBack.addEventListener("click", () => {
  replayState.cursor = Math.max(0, replayState.cursor - 1);
  renderAll();
});

replayStepForward.addEventListener("click", () => {
  replayState.cursor = Math.min(replayState.cursor + 1, replayState.events.length);
  renderAll();
});

replaySpeed.addEventListener("input", (e) => {
  replayState.speedMs = parseInt(e.target.value, 10);
});

// Compare button
compareBtn.addEventListener("click", async () => {
  const left = document.getElementById("compare-left").value.trim();
  const right = document.getElementById("compare-right").value.trim();
  if (!left || !right) return;
  const response = await fetch(`/api/sessions/compare?left=${encodeURIComponent(left)}&right=${encodeURIComponent(right)}`);
  compareView.textContent = JSON.stringify(await response.json(), null, 2);
});

// ── Graph tab listeners ────────────────────────────────────
const graphSelect = document.getElementById("graph-select");
const graphLoadBtn = document.getElementById("graph-load-btn");
const graphIdInput = document.getElementById("graph-id-input");

graphSelect?.addEventListener("change", () => {
  const gid = graphSelect.value;
  if (gid) {
    graphIdInput.value = gid;
    loadGraphProjection(gid);
  }
});

graphLoadBtn?.addEventListener("click", () => {
  const gid = graphIdInput.value.trim();
  if (gid) loadGraphProjection(gid);
});

// Delegate click events for node-detail-btn and rerun-btn
document.getElementById("graph-nodes")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.classList.contains("node-detail-btn")) {
    const nodeId = btn.dataset.nodeId;
    showNodeDetail(nodeId);
  }
  if (btn.classList.contains("rerun-btn")) {
    showRerunCommand(btn.dataset.graphId, btn.dataset.nodeId);
  }
});

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

// ── Graph tab ──────────────────────────────────────────────
let graphList = [];
let currentProjection = null;

async function loadGraphList() {
  try {
    const res = await fetch("/api/graphs");
    graphList = await res.json();
    const select = document.getElementById("graph-select");
    if (!select) return;
    select.innerHTML = `<option value="">— Select a graph —</option>`;
    for (const g of graphList) {
      const opt = document.createElement("option");
      opt.value = g.graphId;
      opt.textContent = `${g.graphId}  (${g.status ?? "?"}, ${g.nodeCount ?? 0} nodes)`;
      select.append(opt);
    }
  } catch { /* silently skip if server doesn't support /api/graphs */ }
}

async function loadGraphProjection(graphId) {
  const overview = document.getElementById("graph-overview");
  const nodes = document.getElementById("graph-nodes");
  const detail = document.getElementById("graph-detail");
  const rerun = document.getElementById("graph-rerun");
  if (!overview || !nodes) return;

  try {
    const res = await fetch(`/api/graphs/${encodeURIComponent(graphId)}/projection`);
    if (!res.ok) {
      overview.classList.remove("hidden");
      overview.innerHTML = `<p class="error">Graph not found: ${escapeHtml(graphId)}</p>`;
      return;
    }
    currentProjection = await res.json();
    renderGraphOverview(currentProjection);
    renderNodeTable(currentProjection);
    detail.classList.add("hidden");
    rerun.classList.add("hidden");
  } catch {
    overview.classList.remove("hidden");
    overview.innerHTML = `<p class="error">Failed to load graph projection</p>`;
  }
}

function renderGraphOverview(proj) {
  const el = document.getElementById("graph-overview");
  el.classList.remove("hidden");
  el.innerHTML = `
    <div class="overview-row">
      <span class="graph-status status-${proj.status}">${escapeHtml(proj.status)}</span>
      <span class="graph-strategy">${escapeHtml(proj.strategy)}</span>
    </div>
    <div class="overview-metrics">
      <div class="metric"><span>Nodes</span><strong>${proj.nodeCount}</strong></div>
      <div class="metric"><span>Completed</span><strong>${proj.nodes.filter(n => n.status === "done").length}</strong></div>
      <div class="metric"><span>Failed</span><strong>${proj.nodes.filter(n => n.status === "failed").length}</strong></div>
      <div class="metric"><span>Blocked</span><strong>${proj.nodes.filter(n => n.status === "blocked").length}</strong></div>
    </div>
    <div class="overview-meta">
      ${proj.sessionIds.length > 0 ? `<p>Sessions: ${proj.sessionIds.map(s => escapeHtml(s)).join(", ")}</p>` : ""}
      ${proj.reports.length > 0 ? `<p>Reports: ${proj.reports.map(r => escapeHtml(r)).join(", ")}</p>` : ""}
      <p>Goal: ${escapeHtml(proj.rootGoal || "(none)")}</p>
    </div>
  `;
}

function renderNodeTable(proj) {
  const el = document.getElementById("graph-nodes");
  el.classList.remove("hidden");

  if (proj.nodes.length === 0) {
    el.innerHTML = '<p class="empty">No nodes in this graph.</p>';
    return;
  }

  el.innerHTML = `<table class="node-table">
    <thead><tr>
      <th></th>
      <th>Node</th>
      <th>Duration</th>
      <th>Capabilities</th>
      <th>Status</th>
      <th>Attempts</th>
      <th></th>
    </tr></thead>
    <tbody>${proj.nodes.map(n => renderNodeRow(n, proj.graphId)).join("")}</tbody>
  </table>`;
}

function renderNodeRow(node, graphId) {
  const statusIcon = node.status === "done" ? "✓" : node.status === "failed" ? "✗" : node.status === "blocked" ? "⊘" : "○";
  const statusClass = node.status === "done" ? "row-done" : node.status === "failed" ? "row-failed" : node.status === "blocked" ? "row-blocked" : "";
  const caps = (node.requiredCapabilities || []).map(c => `<span class="cap-badge">${escapeHtml(c)}</span>`).join(" ");

  let capStatus = "";
  if (node.capabilityResolution) {
    const cs = node.capabilityResolution.status;
    capStatus = `<span class="cap-badge cap-${cs}">${cs}</span>`;
  }

  const attemptsCount = node.attempts ? node.attempts.length : 0;
  const duration = node.durationMs != null ? `${node.durationMs}ms` : "—";
  const showRerun = node.status === "failed";

  return `<tr class="${statusClass}" data-node-id="${escapeHtml(node.nodeId)}">
    <td class="status-icon">${statusIcon}</td>
    <td class="node-title"><button class="link-btn node-detail-btn" data-node-id="${escapeHtml(node.nodeId)}">${escapeHtml(node.title)}</button></td>
    <td class="node-duration">${duration}</td>
    <td class="node-caps">${caps}</td>
    <td class="node-cap-status">${capStatus}</td>
    <td class="node-attempts">${attemptsCount > 0 ? attemptsCount : ""}</td>
    <td class="node-action">${showRerun ? `<button class="rerun-btn" data-graph-id="${escapeHtml(graphId)}" data-node-id="${escapeHtml(node.nodeId)}">Rerun</button>` : ""}</td>
  </tr>`;
}

function showNodeDetail(nodeId) {
  if (!currentProjection) return;
  const node = currentProjection.nodes.find(n => n.nodeId === nodeId);
  if (!node) return;

  const el = document.getElementById("graph-detail");
  el.classList.remove("hidden");

  const cr = node.capabilityResolution;
  if (!cr) {
    el.innerHTML = `<h3>${escapeHtml(node.title)}</h3><p class="empty">No capability resolution data for this node.</p>`;
    return;
  }

  const statusClass = `cap-${cr.status}`;
  el.innerHTML = `
    <h3>${escapeHtml(node.title)} — Capability Resolution</h3>
    <dl class="detail-grid">
      <dt>Status</dt>
      <dd><span class="cap-badge ${statusClass}">${cr.status}</span></dd>
      ${cr.matchedAgents.length > 0 ? `<dt>Agents</dt><dd>${cr.matchedAgents.map(a => escapeHtml(a)).join(", ")}</dd>` : ""}
      ${cr.matchedTools.length > 0 ? `<dt>Tools</dt><dd>${cr.matchedTools.map(t => escapeHtml(t)).join(", ")}</dd>` : ""}
      ${cr.missingCapabilities.length > 0 ? `<dt>Missing</dt><dd class="error">${cr.missingCapabilities.map(c => escapeHtml(c)).join(", ")}</dd>` : ""}
      ${cr.warnings.length > 0 ? `<dt>Warnings</dt><dd class="warning">${cr.warnings.map(w => escapeHtml(w)).join("; ")}</dd>` : ""}
    </dl>
  `;
}

function showRerunCommand(graphId, nodeId) {
  const el = document.getElementById("graph-rerun");
  el.classList.remove("hidden");

  const baseCmd = `alix graph rerun ${graphId} --node ${nodeId}`;
  const forceCmd = `${baseCmd} --force`;

  el.innerHTML = `
    <h3>⤴ Rerun Node</h3>
    <div class="rerun-command-box">
      <code id="rerun-command-text">${escapeHtml(baseCmd)}</code>
      <button id="rerun-copy-btn">Copy</button>
    </div>
    <div class="rerun-options">
      <label>
        <input type="checkbox" id="rerun-force-toggle" />
        --force (rerun even if not failed)
      </label>
    </div>
  `;

  // Copy handler
  document.getElementById("rerun-copy-btn").addEventListener("click", async () => {
    const codeEl = document.getElementById("rerun-command-text");
    try {
      await navigator.clipboard.writeText(codeEl.textContent);
      const btn = document.getElementById("rerun-copy-btn");
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = "Copy"; }, 2000);
    } catch {
      // Fallback for non-HTTPS environments
      const textArea = document.createElement("textarea");
      textArea.value = codeEl.textContent;
      document.body.append(textArea);
      textArea.select();
      document.execCommand("copy");
      textArea.remove();
    }
  });

  // Force toggle
  document.getElementById("rerun-force-toggle").addEventListener("change", (e) => {
    const codeEl = document.getElementById("rerun-command-text");
    codeEl.textContent = e.target.checked ? forceCmd : baseCmd;
  });
}

connectBtn.setAttribute("aria-label", "Connect to session");

// Connect
connectBtn.addEventListener("click", () => {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) return;
  connect(sessionId);
});

function connect(sessionId) {
  if (eventSource) eventSource.close();
  eventsEl.innerHTML = `<li class="empty-state loading-state"><span>Connecting to session...</span></li>`;
  allEvents = [];
  statusEl.textContent = "Connecting...";
  statusEl.className = "status";
  loadRegistry();
  loadGraphList();

  eventSource = new EventSource(`/api/sessions/${sessionId}/events`);

  eventSource.addEventListener("alix", (e) => {
    try {
      const event = JSON.parse(e.data);
      allEvents.push(event);
      replayState = createReplayState(allEvents);
      renderAll();
    } catch {
      addEventRow({ type: "malformed", payload: e.data }, eventsEl, true);
    }
  });

  eventSource.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.className = "status connected";
  };

  eventSource.onerror = () => {
    statusEl.textContent = "Disconnected";
    statusEl.className = "status";
  };
}

function renderAll() {
  const visibleEvents = visibleEventsForReplay(replayState);
  const projection = buildUiProjection(visibleEvents);
  renderEventsFrom(visibleEvents);
  renderContext(projection.context);
  renderList(diffView, projection.diffs, renderDiff);
  renderList(terminalView, projection.terminal, renderTerminal);
  renderList(approvalView, projection.approvals, renderApproval);
  renderList(verificationView, projection.verification, renderVerification);
  renderTokens(projection.tokens);
  renderSubagentTimeline(visibleEvents);
  renderRegistry();
  replayPosition.textContent = `${visibleEvents.length} / ${replayState.events.length}`;
}

function renderEventsFrom(events) {
  eventsEl.innerHTML = "";
  if (events.length === 0) {
    eventsEl.innerHTML = `<li class="empty-state"><span>No events yet. Connect to a session or load a replay.</span></li>`;
    return;
  }
  for (const event of events) {
    addEventRow(event, eventsEl);
  }
}

function renderContext(context) {
  if (!context) {
    contextView.innerHTML = `<p class="empty">No context bundle event yet.</p>`;
    return;
  }
  contextView.innerHTML = `
    <div class="metric-row">
      <span>Task: ${escapeHtml(context.taskType ?? "unknown")}</span>
      <span>Budget: ${context.budget?.usedTokens ?? 0} / ${context.budget?.maxTokens ?? 0}</span>
    </div>
    ${renderContextGroup("Primary", context.primaryFiles ?? [])}
    ${renderContextGroup("Tests", context.tests ?? [])}
    ${renderContextGroup("Supporting", context.supportingFiles ?? [])}
    ${renderContextGroup("Pinned", context.pinned ?? [])}
  `;
}

function renderContextGroup(title, items) {
  if (items.length === 0) return "";
  return `<h3>${title}</h3><ul class="compact-list">${items.map((item) => `<li><strong>${escapeHtml(item.path)}</strong><span>${escapeHtml(item.reason ?? "")}</span></li>`).join("")}</ul>`;
}

function renderList(container, items, renderer) {
  container.innerHTML = items.length === 0 ? `<p class="empty">No events yet.</p>` : items.map(renderer).join("");
}

function renderDiff(diff) {
  return `<article class="inspector-card"><strong>${escapeHtml(diff.status)}</strong><ul>${(diff.changedFiles ?? []).map((file) => `<li>${escapeHtml(file)}</li>`).join("")}</ul></article>`;
}

function renderTerminal(item) {
  return `<article class="inspector-card"><strong>${escapeHtml(item.command)}</strong><span>${escapeHtml(item.status ?? "")}</span><pre>${escapeHtml(item.outputPreview ?? item.error ?? "")}</pre></article>`;
}

function renderApproval(item) {
  return `<article class="inspector-card"><strong>${escapeHtml(item.status)}</strong><ul>${(item.paths ?? []).map((path) => `<li>${escapeHtml(path)}</li>`).join("")}</ul></article>`;
}

function renderVerification(item) {
  const statusClass = item.status === "passed" ? "passed" : item.status === "failed" ? "failed" : "not_run";
  const statusLabel = item.status?.toUpperCase() ?? "NOT RUN";
  return `<article class="inspector-card verification-item ${statusClass}">
    <span class="status-badge">${escapeHtml(statusLabel)}</span>
    <code>${escapeHtml(item.command ?? "")}</code>
    ${item.output ? `<pre class="output">${escapeHtml(item.output).slice(0, 300)}</pre>` : ""}
  </article>`;
}

function renderTokens(tokens) {
  const lastEntry = tokens.entries?.[tokens.entries.length - 1];
  const costStr = lastEntry?.cost != null ? `$${lastEntry.cost.toFixed(6)}` : "—";
  tokenView.innerHTML = `
    <div class="metric-grid">
      <div><span>Input</span><strong>${tokens.totalInputTokens}</strong></div>
      <div><span>Output</span><strong>${tokens.totalOutputTokens}</strong></div>
      <div><span>Total</span><strong>${tokens.totalInputTokens + tokens.totalOutputTokens}</strong></div>
      <div><span>Last Cost</span><strong>${costStr}</strong></div>
    </div>
    ${tokens.entries?.length > 0 ? `<div class="token-entries">${tokens.entries.slice(-10).map(e =>
      `<div class="token-entry"><span>${e.provider ?? ""} ${e.model ?? ""}</span><span>in:${e.inputTokens} out:${e.outputTokens}${e.cost != null ? " $" + e.cost.toFixed(6) : ""}</span></div>`
    ).join("")}</div>` : ""}
  `;
}

function renderSubagentTimeline(events) {
  const subagentEvents = projectSubagentEvents(events);

  if (subagentEvents.length === 0) {
    subagentView.innerHTML = `<p class="empty">No subagent activity</p>`;
    return;
  }

  const items = subagentEvents.map(e => `
    <div class="timeline-item ${e.status ?? ''}">
      <span class="timestamp">${formatTime(e.timestamp)}</span>
      <span class="role badge ${e.role}">${e.role}</span>
      <span class="type">${e.type.replace('subagent.', '')}</span>
      ${e.duration ? `<span class="duration">${e.duration}ms</span>` : ''}
    </div>
  `).join('');

  subagentView.innerHTML = `<div class="timeline">${items}</div>`;
}

function addEventRow(event, container, prepend = false) {
  const item = document.createElement("li");
  item.dataset.type = event.type || "unknown";

  const isError = event.type === "tool.failed";
  const isTool = /^tool\./.test(event.type);
  const isAgent = event.type?.startsWith("agent.");
  const isSuccess = event.type === "tool.completed";

  if (isError) item.className = "event-row error";
  else if (isSuccess) item.className = "event-row success";
  else if (isTool) item.className = "event-row tool";
  else if (isAgent) item.className = "event-row agent";

  const typeBadge = document.createElement("span");
  typeBadge.className = "event-type";
  typeBadge.textContent = formatType(event.type || "unknown");

  const actorChip = document.createElement("span");
  actorChip.className = `event-actor actor-${event.actor ?? "system"}`;
  actorChip.textContent = event.actor ?? "system";

  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = `#${event.seq ?? "?"} · ${event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}`;

  const payload = document.createElement("details");
  payload.className = "event-payload-wrap";

  const payloadSummary = document.createElement("summary");
  const toolName = event.payload?.toolName;
  const error = event.payload?.error;
  if (isError && error) {
    payloadSummary.textContent = `Error: ${error.slice(0, 80)}${error.length > 80 ? "…" : ""}`;
    payloadSummary.className = "summary-error";
  } else if (toolName) {
    payloadSummary.textContent = toolName;
  } else {
    payloadSummary.textContent = formatType(event.type ?? "");
  }

  const payloadBody = document.createElement("pre");
  payloadBody.className = "event-payload";
  payloadBody.textContent = JSON.stringify(event.payload, null, 2);

  // Capability badge
  const capability = event.payload?.canonicalCapability || event.payload?.capability;
  if (capability) {
    const capChip = document.createElement("span");
    capChip.className = "cap-badge inline";
    capChip.textContent = capability;
    item.insertBefore(capChip, meta);
  }

  // Policy decision badge
  if (event.type === "policy.decision") {
    const decision = event.payload?.decision || "unknown";
    const policyChip = document.createElement("span");
    policyChip.className = `policy-badge decision-${decision}`;
    policyChip.textContent = `policy: ${decision}`;
    item.insertBefore(policyChip, meta);
  }

  payload.append(payloadSummary, payloadBody);
  item.append(typeBadge, actorChip, meta, payload);

  if (prepend) {
    container.prepend(item);
  } else {
    container.append(item);
  }
}

function formatType(type) {
  return type.replace(/\./g, " › ").replace(/_/g, " ");
}

function formatTime(timestamp) {
  return timestamp ? new Date(timestamp).toLocaleTimeString() : "";
}

// ── Policy tab ─────────────────────────────────────────────
let policyRules = [];

async function loadPolicyRules() {
  try {
    const res = await fetch("/api/policy/rules");
    policyRules = await res.json();
    renderPolicyRules();
  } catch {
    // silently skip
  }
}

function renderPolicyRules() {
  const el = document.getElementById("policy-rules-list");
  if (!el) return;
  if (policyRules.length === 0) {
    el.innerHTML = '<p class="empty">No policy rules loaded.</p>';
    return;
  }
  el.innerHTML = `<table class="policy-table">
    <thead><tr>
      <th>ID</th>
      <th>Decision</th>
      <th>Enabled</th>
      <th>Match</th>
      <th>Reason</th>
    </tr></thead>
    <tbody>${policyRules.map(r => {
      const matchParts = [];
      if (r.match.capability) matchParts.push(`capability=${escapeHtml(r.match.capability)}`);
      if (r.match.toolId) matchParts.push(`toolId=${escapeHtml(r.match.toolId)}`);
      if (r.match.riskLevel) matchParts.push(`riskLevel=${escapeHtml(r.match.riskLevel)}`);
      if (r.match.executionProfile) matchParts.push(`profile=${escapeHtml(r.match.executionProfile)}`);
      if (r.match.pathPattern) matchParts.push(`path=${escapeHtml(r.match.pathPattern)}`);
      return `<tr class="${r.enabled ? '' : 'disabled'}">
        <td class="mono">${escapeHtml(r.id)}</td>
        <td><span class="policy-badge decision-${r.decision}">${r.decision}</span></td>
        <td>${r.enabled ? '✓' : '✗'}</td>
        <td class="match-cell">${matchParts.join(', ')}</td>
        <td class="reason-cell">${escapeHtml(r.reason || '')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// Policy eval form
document.getElementById("policy-eval-btn")?.addEventListener("click", async () => {
  const capability = document.getElementById("policy-cap-input").value.trim() || undefined;
  const risk = document.getElementById("policy-risk-select").value || undefined;
  const params = new URLSearchParams();
  if (capability) params.set("capability", capability);
  if (risk) params.set("risk", risk);
  const resultEl = document.getElementById("policy-eval-result");
  resultEl.classList.remove("hidden");
  resultEl.innerHTML = '<p>Evaluating...</p>';
  try {
    const res = await fetch(`/api/policy/eval?${params}`);
    const result = await res.json();
    resultEl.innerHTML = `
      <div class="eval-result-card">
        <span class="policy-badge decision-${result.decision}">${result.decision}</span>
        ${result.matchedRuleId ? `<span class="eval-rule">${escapeHtml(result.matchedRuleId)}</span>` : ''}
        ${result.reason ? `<span class="eval-reason">${escapeHtml(result.reason)}</span>` : ''}
      </div>`;
  } catch {
    resultEl.innerHTML = '<p class="error">Evaluation failed</p>';
  }
});

// ── Approvals tab ────────────────────────────────────────────
async function loadApprovals() {
  try {
    const res = await fetch("/api/approvals");
    const approvals = await res.json();
    const el = document.getElementById("approvals-list-content");
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
      <tbody>${approvals.map((a) => {
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

// ── Audit tab ────────────────────────────────────────────────
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
    el.innerHTML = `<div class="audit-timeline">${records.map((r) => {
      const actionClass = r.action.replace(/\./g, "-");
      return `<div class="audit-entry">
        <span class="audit-action action-${actionClass}">${escapeHtml(r.action)}</span>
        <span class="audit-time">${new Date(r.timestamp).toLocaleString()}</span>
        ${r.details.capability ? `<span class="cap-badge">${escapeHtml(r.details.capability)}</span>` : ""}
        ${r.details.graphId ? `<span class="audit-meta">${escapeHtml(r.details.graphId)}</span>` : ""}
        ${r.details.nodeId ? `<span class="audit-meta">/${escapeHtml(r.details.nodeId)}</span>` : ""}
        ${r.details.approvalId ? `<span class="audit-meta">${escapeHtml(r.details.approvalId)}</span>` : ""}
        ${r.details.reason ? `<div class="audit-reason">${escapeHtml(r.details.reason)}</div>` : ""}
      </div>`;
    }).join("")}</div>`;
  } catch { /* silently skip */ }
}

// Load registry, graph list, and policy on page load so tabs work without connecting
loadRegistry();
loadGraphList();
loadPolicyRules();
loadApprovals();
loadAudit();