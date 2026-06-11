import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";

describe("Batch selection state", () => {
  it("starts with empty selection", () => {
    const store = createTuiStore();
    assert.deepEqual(store.getState().selectedReplayIds, []);
  });

  it("addSelectedReplayId appends unique ids", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.addSelectedReplayId("replay_002");
    assert.deepEqual(store.getState().selectedReplayIds, ["replay_001", "replay_002"]);
  });

  it("addSelectedReplayId does not duplicate", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.addSelectedReplayId("replay_001");
    assert.deepEqual(store.getState().selectedReplayIds, ["replay_001"]);
  });

  it("removeSelectedReplayId removes id", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.removeSelectedReplayId("replay_001");
    assert.deepEqual(store.getState().selectedReplayIds, []);
  });

  it("clearSelectedReplayIds empties selection", () => {
    const store = createTuiStore();
    store.addSelectedReplayId("replay_001");
    store.addSelectedReplayId("replay_002");
    store.clearSelectedReplayIds();
    assert.deepEqual(store.getState().selectedReplayIds, []);
  });
});
