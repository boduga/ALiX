import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { EventLog } from "../../src/events/event-log.js";

describe("CAP-3 platform composition root", () => {
  let dir: string;
  let sessionDir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cap3-plat-")); sessionDir = mkdtempSync(join(tmpdir(), "cap3-plat-sess-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

  it("boots catalog → registry → runtime; register is bootstrap-only through the port", async () => {
    const platform = new CapabilityPlatform({ catalogDir: dir, eventLog: new EventLog(sessionDir) });
    platform.register({ id: "core.session.list", version: "1.0", kind: "core", title: "List sessions",
      description: "d", tags: [], category: "session", risk: "low", requiredPermissions: ["operator"],
      execution: { strategy: "native" } });
    expect(platform.registry.list()).toHaveLength(1);
    expect(platform.find("core.session.list")?.id).toBe("core.session.list");
    // Second identical registration (bootstrap re-run) is a silent no-op
    platform.register({ id: "core.session.list", version: "1.0", kind: "core", title: "List sessions",
      description: "d", tags: [], category: "session", risk: "low", requiredPermissions: ["operator"],
      execution: { strategy: "native" } });
    expect(platform.registry.list()).toHaveLength(1);
  });

  it("registry persists through the catalog (fresh platform reloads it)", () => {
    const eventLog = new EventLog(sessionDir);
    const p1 = new CapabilityPlatform({ catalogDir: dir, eventLog });
    p1.register({ id: "tool.file.read", version: "1.0", kind: "tool", title: "Read file", description: "d",
      tags: [], category: "file", risk: "low", requiredPermissions: ["developer"], execution: { strategy: "tool" } });
    const p2 = new CapabilityPlatform({ catalogDir: dir, eventLog: new EventLog(sessionDir + '-2') });
    expect(p2.registry.list()).toHaveLength(1);
    expect(p2.find("tool.file.read")?.kind).toBe("tool");
  });
});
