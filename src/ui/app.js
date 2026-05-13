const sessionInput = document.getElementById("session-id");
const connectBtn = document.getElementById("connect-btn");
const eventsEl = document.getElementById("events");
const statusEl = document.getElementById("connection-status");
let eventSource = null;

connectBtn.addEventListener("click", () => {
  const sessionId = sessionInput.value.trim();
  if (!sessionId) return;
  connect(sessionId);
});

function connect(sessionId) {
  if (eventSource) {
    eventSource.close();
  }

  eventsEl.innerHTML = "";
  statusEl.textContent = "Connecting...";
  statusEl.className = "status";

  eventSource = new EventSource(`/api/sessions/${sessionId}/events`);

  eventSource.addEventListener("alix", (e) => {
    try {
      const event = JSON.parse(e.data);
      addEvent(event);
    } catch {
      addEvent({ type: "malformed", payload: e.data });
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

function addEvent(event) {
  const item = document.createElement("li");

  const type = document.createElement("span");
  type.className = "event-type";
  type.textContent = event.type || "unknown";

  const actor = document.createElement("span");
  actor.className = `event-actor actor-${event.actor ?? "system"}`;
  actor.textContent = event.actor ?? "system";

  const meta = document.createElement("span");
  meta.className = "event-meta";
  meta.textContent = `#${event.seq} · ${event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ""}`;

  const payload = document.createElement("span");
  payload.className = "event-payload";
  payload.textContent = JSON.stringify(event.payload);

  item.append(type, actor, meta, payload);
  eventsEl.prepend(item);
}
