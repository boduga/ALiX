import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTuiStore } from "../../src/tui/store.js";

describe("Replays panel rendering data", () => {
  it("store holds replayIndexData", () => {
    const store = createTuiStore();
    const data = {
      entries: [
        { replayId: "replay_001", status: "completed" as const, createdAt: "2026-06-11T10:00:00Z", updatedAt: "2026-06-11T10:01:00Z", replayMode: "approved-live" },
      ],
    };
    store.setReplayIndexData(data);
    const state = store.getState();
    assert.equal(state.replayIndexData?.entries.length, 1);
    assert.equal(state.replayIndexData?.entries[0].replayId, "replay_001");
  });

  it("store holds replayLockStates", () => {
    const store = createTuiStore();
    store.setReplayLockStates({ replay_001: true, replay_002: false });
    assert.equal(store.getState().replayLockStates?.replay_001, true);
    assert.equal(store.getState().replayLockStates?.replay_002, false);
  });

  it("defaults to undefined when no data loaded", () => {
    const store = createTuiStore();
    assert.equal(store.getState().replayIndexData, undefined);
    assert.equal(store.getState().replayLockStates, undefined);
  });
});
