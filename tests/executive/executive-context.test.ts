import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createExecutiveStores,
  executiveDir,
  executivePlansDir,
  loadExecutiveState,
} from "../../src/execution/executive/executive-context.js";
import { PlanStore } from "../../src/execution/executive/plan-store.js";
import { ExecutionStateStore } from "../../src/execution/executive/execution-state-store.js";

test("executive dirs resolve under the workspace root", () => {
  const cwd = join(tmpdir(), "exec-ctx-dirs");
  assert.equal(executivePlansDir(cwd), join(cwd, ".alix", "executive", "plans"));
  assert.equal(executiveDir(cwd), join(cwd, ".alix", "executive"));
});

test("seam constructs both stores over the same plans dir", () => {
  const cwd = mkdtempSync(join(tmpdir(), "exec-ctx-"));
  try {
    const { planStore, stateStore } = createExecutiveStores(cwd);
    assert.ok(planStore instanceof PlanStore);
    assert.ok(stateStore instanceof ExecutionStateStore);
    assert.equal(loadExecutiveState(cwd, "missing-plan"), null);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
