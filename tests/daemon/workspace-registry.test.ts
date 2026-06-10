import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordWorkspaceActivity, listWorkspaces, getWorkspace } from "../../src/daemon/workspace-registry.js";

describe("WorkspaceRegistry", () => {
  let origHome: string | undefined;
  let testHome: string;

  before(() => {
    origHome = process.env.HOME;
    testHome = mkdtempSync(join(tmpdir(), "ws-reg-"));
    process.env.HOME = testHome;
    mkdirSync(join(testHome, ".alix"), { recursive: true });
  });

  after(() => {
    process.env.HOME = origHome;
    rmSync(testHome, { recursive: true, force: true });
  });

  it("returns empty list when no file exists", async () => {
    const ws = await listWorkspaces();
    assert.deepEqual(ws, []);
  });

  it("creates a workspace entry on first activity", async () => {
    await recordWorkspaceActivity("/tmp/project-alpha");
    const ws = await listWorkspaces();
    assert.equal(ws.length, 1);
    assert.equal(ws[0].path, "/tmp/project-alpha");
    assert.equal(ws[0].name, "project-alpha");
    assert.equal(ws[0].taskCount, 1);
    assert.equal(ws[0].status, "active");
  });

  it("increments taskCount on repeat activity", async () => {
    await recordWorkspaceActivity("/tmp/project-alpha");
    await recordWorkspaceActivity("/tmp/project-alpha");
    const ws = await listWorkspaces();
    assert.equal(ws.length, 1);
    assert.equal(ws[0].taskCount, 3); // 1 from create + 2 from this test
  });

  it("registers a second workspace", async () => {
    await recordWorkspaceActivity("/tmp/project-beta");
    const ws = await listWorkspaces();
    assert.equal(ws.length, 2);
  });

  it("sorts by lastUsed descending (most recent first)", async () => {
    await new Promise(r => setTimeout(r, 5));
    await recordWorkspaceActivity("/tmp/project-alpha"); // touch alpha
    const ws = await listWorkspaces();
    assert.equal(ws[0].name, "project-alpha"); // most recent
    assert.equal(ws[1].name, "project-beta");
  });

  it("getWorkspace returns specific workspace", async () => {
    const w = await getWorkspace("/tmp/project-beta");
    assert.ok(w);
    assert.equal(w!.name, "project-beta");
  });

  it("getWorkspace returns undefined for unknown path", async () => {
    const w = await getWorkspace("/tmp/nonexistent");
    assert.equal(w, undefined);
  });

  it("marks old workspaces as idle", async () => {
    // Force a workspace to appear old by setting lastUsed far in the past
    const ws = await listWorkspaces();
    ws[ws.length - 1].lastUsed = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const tmp = join(testHome, ".alix", "workspaces.json") + ".tmp";
    const { writeFile, rename } = await import("node:fs/promises");
    await writeFile(tmp, JSON.stringify(ws, null, 2), "utf-8");
    await rename(tmp, join(testHome, ".alix", "workspaces.json"));

    // Now record activity in a fresh workspace — this triggers idle sweep
    await recordWorkspaceActivity("/tmp/project-gamma");

    const updated = await listWorkspaces();
    const oldEntry = updated.find(w => w.name === "project-beta");
    assert.ok(oldEntry);
    assert.equal(oldEntry!.status, "idle", "workspace older than 24h should be idle");
  });
});
