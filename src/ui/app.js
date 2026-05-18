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

// Connect
connectBtn.addEventListener("click", () => {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) return;
  connect(sessionId);
});

function connect(sessionId) {
  if (eventSource) eventSource.close();
  eventsEl.innerHTML = "";
  allEvents = [];
  statusEl.textContent = "Connecting...";
  statusEl.className = "status";

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
  replayPosition.textContent = `${visibleEvents.length} / ${replayState.events.length}`;
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
  return `<article class="inspector-card"><strong>${escapeHtml(item.command)}</strong><span>${escapeHtml(item.status ?? "unknown")}</span></article>`;
}

function renderTokens(tokens) {
  tokenView.innerHTML = `<div class="metric-grid"><div><span>Input</span><strong>${tokens.totalInputTokens}</strong></div><div><span>Output</span><strong>${tokens.totalOutputTokens}</strong></div></div>`;
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}