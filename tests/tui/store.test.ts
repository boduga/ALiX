import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore, PANELS } from "../../src/tui/store.js";

describe("TuiStore", () => {
  it("defaults to chat panel", () => {
    const store = createTuiStore();
    assert.equal(store.getState().activePanel, "chat");
  });

  it("setPanel switches panels", () => {
    const store = createTuiStore();
    store.setPanel("daemon");
    assert.equal(store.getState().activePanel, "daemon");
    store.setPanel("approvals");
    assert.equal(store.getState().activePanel, "approvals");
  });

  it("cyclePanel wraps forward", () => {
    const store = createTuiStore();
    store.cyclePanel(1);
    assert.equal(store.getState().activePanel, PANELS[1]);
    store.cyclePanel(1);
    assert.equal(store.getState().activePanel, PANELS[2]);
  });

  it("cyclePanel wraps around", () => {
    const store = createTuiStore();
    // Go to last panel
    for (let i = 0; i < PANELS.length - 1; i++) store.cyclePanel(1);
    assert.equal(store.getState().activePanel, PANELS[PANELS.length - 1]);
    // Cycle forward wraps to first
    store.cyclePanel(1);
    assert.equal(store.getState().activePanel, PANELS[0]);
  });

  it("cyclePanel direction -1 wraps backward", () => {
    const store = createTuiStore();
    store.cyclePanel(-1);
    assert.equal(store.getState().activePanel, PANELS[PANELS.length - 1]);
  });

  it("setDaemonRunning updates state", () => {
    const store = createTuiStore();
    store.setDaemonRunning(true);
    assert.equal(store.getState().daemonRunning, true);
  });
});
