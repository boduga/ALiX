const events = document.querySelector("#events");

function addEvent(text) {
  const item = document.createElement("li");
  item.textContent = text;
  events.append(item);
}

addEvent("Inspector loaded");
