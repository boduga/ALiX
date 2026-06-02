import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { replay } from "../../src/events/replay.js";

describe("replay", () => {
  it("reconstructs changed files from patch.applied", () => {
    const projection = replay([
      {
        id: "1", seq: 1, version: 1, sessionId: "s1",
        timestamp: new Date().toISOString(),
        type: "patch.applied",
        actor: "system",
        payload: { changedFiles: ["a.ts", "a.ts", "b.ts"] }
      }
    ]);
    assert.deepEqual(projection.changedFiles, ["a.ts", "b.ts"]);
  });

  it("reconstructs changed files from tool.completed for patch.apply", () => {
    const projection = replay([
      {
        id: "1", seq: 1, version: 1, sessionId: "s1",
        timestamp: new Date().toISOString(),
        type: "tool.completed",
        actor: "system",
        payload: { toolName: "patch.apply", changedFiles: ["x.ts"] }
      }
    ]);
    assert.deepEqual(projection.changedFiles, ["x.ts"]);
  });

  it("deduplicates changed files", () => {
    const projection = replay([
      {
        id: "1", seq: 1, version: 1, sessionId: "s1",
        timestamp: new Date().toISOString(),
        type: "patch.applied",
        actor: "system",
        payload: { changedFiles: ["a.ts", "a.ts", "b.ts", "a.ts"] }
      }
    ]);
    assert.deepEqual(projection.changedFiles, ["a.ts", "b.ts"]);
  });

  it("extracts session.ended summary", () => {
    const projection = replay([
      {
        id: "1", seq: 1, version: 1, sessionId: "s1",
        timestamp: new Date().toISOString(),
        type: "session.ended",
        actor: "system",
        payload: { summary: "All done" }
      }
    ]);
    assert.equal(projection.summary, "All done");
  });

  it("returns empty projection for no events", () => {
    const projection = replay([]);
    assert.equal(projection.sessionId, "");
    assert.equal(projection.eventCount, 0);
    assert.deepEqual(projection.changedFiles, []);
  });
});