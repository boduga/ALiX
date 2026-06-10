import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WorkspaceManager, promptLabel, type WorkspaceManagerDeps } from "../../src/tui/workspace-manager.js";
import type { WorkspaceEntry } from "../../src/daemon/workspace-registry.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ws1: WorkspaceEntry = {
  path: "/home/user/Projects/Monolith",
  name: "Monolith",
  lastUsed: "2026-06-10T12:00:00Z",
  taskCount: 42,
  status: "active",
};

const ws2: WorkspaceEntry = {
  path: "/home/user/Projects/alix-test",
  name: "alix-test",
  lastUsed: "2026-06-09T10:00:00Z",
  taskCount: 5,
  status: "active",
};

const ws3: WorkspaceEntry = {
  path: "/home/user/Projects/client-nas/Monolith",
  name: "Monolith",
  lastUsed: "2026-06-08T08:00:00Z",
  taskCount: 3,
  status: "idle",
};

const allWorkspaces = [ws1, ws2, ws3];

// ---------------------------------------------------------------------------
// WorkspaceManager
// ---------------------------------------------------------------------------

describe("WorkspaceManager", () => {
  let recordedActivity: string | null;
  let deps: WorkspaceManagerDeps;

  beforeEach(() => {
    recordedActivity = null;
    deps = {
      listWorkspaces: async () => allWorkspaces,
      recordWorkspaceActivity: async (cwd: string) => {
        recordedActivity = cwd;
      },
      getWorkspace: async (path: string) =>
        allWorkspaces.find((w) => w.path === path),
    };
  });

  // ---- Command parsing ----

  it("non-command input returns handled: false", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("hello world");
    assert.equal(r.handled, false);
  });

  it("empty input returns handled: false", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("");
    assert.equal(r.handled, false);
  });

  // ---- /workspaces ----

  it("/workspaces lists workspaces with active/idle markers", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/workspaces");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("● Monolith"));
    assert.ok((r as any).message.includes("○ Monolith"));
  });

  it("/ws alias lists workspaces", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/ws");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Workspaces:"));
  });

  it("/workspace alias lists workspaces", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/workspace");
    assert.equal(r.handled, true);
    assert.ok((r as any).message.includes("Workspaces:"));
  });

  it("empty list returns No workspaces message", async () => {
    const emptyDeps: WorkspaceManagerDeps = {
      ...deps,
      listWorkspaces: async () => [],
    };
    const mgr = new WorkspaceManager(emptyDeps);
    const r = await mgr.tryHandleCommand("/workspaces");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("No workspaces recorded yet"));
  });

  // ---- /switch exact path ----

  it("/switch exact path match changes workspace", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch /home/user/Projects/Monolith");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/Monolith");
    assert.equal(recordedActivity, "/home/user/Projects/Monolith");
  });

  // ---- /switch exact name (unique) ----

  it("/switch with unique name switches workspace", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch alix-test");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/alix-test");
  });

  // ---- /switch ambiguous name ----

  it("/switch with ambiguous name shows numbered choices", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch Monolith");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("[1]"));
    assert.ok((r as any).message.includes("[2]"));
    assert.ok((r as any).message.includes("Multiple workspaces match"));
  });

  // ---- /switch numeric from cache ----

  it("numeric 1 selects first from ambiguity cache", async () => {
    const mgr = new WorkspaceManager(deps);
    await mgr.tryHandleCommand("/switch Monolith");
    const r = await mgr.tryHandleCommand("/switch 1");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/Monolith");
    assert.equal(recordedActivity, "/home/user/Projects/Monolith");
  });

  it("numeric 2 selects second from ambiguity cache", async () => {
    const mgr = new WorkspaceManager(deps);
    await mgr.tryHandleCommand("/switch Monolith");
    const r = await mgr.tryHandleCommand("/switch 2");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/client-nas/Monolith");
  });

  it("out-of-range numeric preserves cache and returns error", async () => {
    const mgr = new WorkspaceManager(deps);
    await mgr.tryHandleCommand("/switch Monolith");
    const r = await mgr.tryHandleCommand("/switch 3");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("Invalid selection"));
    // Cache is preserved — subsequent numeric should still work
    const r2 = await mgr.tryHandleCommand("/switch 1");
    assert.equal((r2 as any).changedWorkspace, true);
  });

  it("numeric without cache resolves normally (not found)", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch 3");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("No workspace found"));
  });

  // ---- /switch path suffix ----

  it("unique path suffix switches workspace", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch client-nas/Monolith");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/client-nas/Monolith");
  });

  // ---- /switch not found ----

  it("unknown input returns not found", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch nonexistent");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("No workspace found"));
  });

  // ---- /switch no arg ----

  it("no argument returns not found message", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/switch");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("No workspace found"));
  });

  // ---- /switch empty workspaces ----

  it("empty workspaces returns not found for /switch", async () => {
    const emptyDeps: WorkspaceManagerDeps = {
      ...deps,
      listWorkspaces: async () => [],
    };
    const mgr = new WorkspaceManager(emptyDeps);
    const r = await mgr.tryHandleCommand("/switch foo");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("No workspace found"));
  });

  // ---- /sw alias ----

  it("/sw alias switches workspace", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/sw alix-test");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, true);
    assert.equal((r as any).nextCwd, "/home/user/Projects/alix-test");
  });

  // ---- /open ----

  it("nonexistent path returns Path does not exist", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/open /nonexistent-path-12345");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("Path does not exist"));
  });

  it("file path returns Not a directory", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ws-open-"));
    try {
      const filePath = join(tmpDir, "test-file.txt");
      writeFileSync(filePath, "hello", "utf-8");
      const mgr = new WorkspaceManager(deps);
      const r = await mgr.tryHandleCommand(`/open ${filePath}`);
      assert.equal(r.handled, true);
      assert.equal((r as any).changedWorkspace, false);
      assert.ok((r as any).message.includes("Not a directory"));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("no argument returns usage message", async () => {
    const mgr = new WorkspaceManager(deps);
    const r = await mgr.tryHandleCommand("/open");
    assert.equal(r.handled, true);
    assert.equal((r as any).changedWorkspace, false);
    assert.ok((r as any).message.includes("Usage"));
  });

  it("existing dir records activity and switches", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "ws-open-"));
    try {
      const mgr = new WorkspaceManager(deps);
      const r = await mgr.tryHandleCommand(`/open ${tmpDir}`);
      assert.equal(r.handled, true);
      assert.equal((r as any).changedWorkspace, true);
      assert.equal((r as any).nextCwd, tmpDir);
      assert.equal(recordedActivity, tmpDir);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// promptLabel
// ---------------------------------------------------------------------------

describe("promptLabel", () => {
  it("uses workspaceName when available", () => {
    const label = promptLabel("/some/cwd", "my-workspace", "/some/path");
    assert.equal(label, "[my-workspace] > ");
  });

  it("falls back to basename of workspacePath", () => {
    const label = promptLabel("/some/cwd", undefined, "/home/user/my-project");
    assert.equal(label, "[my-project] > ");
  });

  it("falls back to basename of cwd", () => {
    const label = promptLabel("/home/user/some-project");
    assert.equal(label, "[some-project] > ");
  });

  it("truncates to 28 characters", () => {
    const longName = "a".repeat(30);
    const label = promptLabel("/cwd", longName);
    assert.equal(label, `[${"a".repeat(25)}...] > `);
  });

  it("does not truncate at exactly 28 chars", () => {
    const name = "a".repeat(28);
    const label = promptLabel("/cwd", name);
    assert.equal(label, `[${name}] > `);
  });

  it("handles empty workspaceName", () => {
    const label = promptLabel("/home/user/project", "", "/some/workspace");
    assert.equal(label, "[workspace] > ");
  });
});
