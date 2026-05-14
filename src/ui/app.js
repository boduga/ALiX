const sessionInput = document.getElementById("session-id");
const connectBtn = document.getElementById("connect-btn");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("connection-status");
const filterEl = document.getElementById("event-filter");
let eventSource = null;
let allEvents = []; // keep for filter re-render
let filter = "all";

connectBtn.addEventListener("click", () => {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) return;
  connect(sessionId);
});

if (filterEl) {
  filterEl.addEventListener("change", () => {
    filter = filterEl.value;
    renderEvents();
  });
}

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
      allEvents.unshift(event); // newest first
      addEventRow(event, eventsEl, true);
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

function addEventRow(event, container, prepend = false) {
  if (filter !== "all") {
    const typeMatch =
      filter === "tool" ? /^tool\./.test(event.type) :
      filter === "agent" ? event.type?.startsWith("agent.") :
      filter === "error" ? event.type === "tool.failed" :
      true;
    if (!typeMatch) return;
  }

  const item = document.createElement("li");
  item.dataset.type = event.type || "unknown";

  // Color code by type
  const isError = event.type === "tool.failed";
  const isTool = /^tool\./.test(event.type);
  const isAgent = event.type?.startsWith("agent.");
  const isSuccess = event.type === "tool.completed";

  if (isError) item.className = "event-row error";
  else if (isSuccess) item.className = "event-row success";
  else if (isTool) item.className = "event-row tool";
  else if (isAgent) item.className = "event-row agent";

  // Type badge
  const typeBadge = document.createElement("span");
  typeBadge.className = "event-type";
  typeBadge.textContent = formatType(event.type || "unknown");

  // Actor chip
  const actorChip = document.createElement("span");
  actorChip.className = `event-actor actor-${event.actor ?? "system"}`;
  actorChip.textContent = event.actor ?? "system";

  // Seq + time
  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = `#${event.seq ?? "?"} · ${event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}`;

  // Collapsible payload
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

function renderEvents() {
  eventsEl.innerHTML = "";
  for (const ev of allEvents) {
    addEventRow(ev, eventsEl, false);
  }
}