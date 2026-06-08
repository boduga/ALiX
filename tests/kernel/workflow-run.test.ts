import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkflowRun, transitionWorkflowStatus } from "../../src/kernel/workflow-run.js";

describe("WorkflowRun", () => {

  it("creates with generated ID and created status", () => {
    const wf = createWorkflowRun("session_1", "test goal");
    assert.ok(wf.id.startsWith("wf_"), `ID should start with wf_ (got: ${wf.id})`);
    assert.equal(wf.status, "created");
    assert.equal(wf.goal, "test goal");
    assert.equal(wf.schemaVersion, "1.0");
  });

  it("transitions status correctly", () => {
    const wf = createWorkflowRun("session_1", "test");
    const running = transitionWorkflowStatus(wf, "running");
    assert.equal(running.status, "running");
    assert.ok(new Date(running.updatedAt) >= new Date(wf.createdAt));
  });

  it("preserves original fields on transition", () => {
    const wf = createWorkflowRun("session_1", "test", "unattended");
    const completed = transitionWorkflowStatus(wf, "completed");
    assert.equal(completed.id, wf.id);
    assert.equal(completed.goal, "test");
    assert.equal(completed.mode, "unattended");
  });

  it("generates unique IDs", () => {
    const wf1 = createWorkflowRun("s", "a");
    const wf2 = createWorkflowRun("s", "b");
    assert.notEqual(wf1.id, wf2.id);
  });
});
