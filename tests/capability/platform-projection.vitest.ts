import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityPlatform } from "../../src/capability/platform.js";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import { EventLog } from "../../src/events/event-log.js";
import type { CapabilityDefinition } from "../../src/capability/canonical/definition.js";

describe("CAP-3 platform composition root", () => {
  let dir: string;
  let sessionDir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "cap3-plat-")); sessionDir = mkdtempSync(join(tmpdir(), "cap3-plat-sess-")); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); rmSync(sessionDir, { recursive: true, force: true }); });

  // R10 — composition correctness uses test-owned catalog; public behavior uses platform.service.
  function makePlatform(): { platform: CapabilityPlatform; catalog: CapabilityCatalog; port: CatalogBackedCapabilityMutationPort } {
    const catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
    const platform = new CapabilityPlatform({ catalog, eventLog: new EventLog(sessionDir) });
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    return { platform, catalog, port };
  }

  const coreSessionList: CapabilityDefinition = {
    id: "core.session.list", version: "1.0.0", kind: "core", title: "List sessions",
    description: "d", tags: [], category: "session", risk: "low", requiredPermissions: ["operator"],
    dependencies: [], bindings: [{ id: "core.session.list", type: "native" }],
  };

  const toolFileRead: CapabilityDefinition = {
    id: "tool.file.read", version: "1.0.0", kind: "operation", title: "Read file", description: "d",
    tags: [], category: "file", risk: "low", requiredPermissions: ["developer"],
    dependencies: [], bindings: [{ id: "tool.file.read", type: "native" }],
  };

  it("boots catalog → registry → runtime; mutation port is bootstrap-only and idempotent", () => {
    const { catalog, port } = makePlatform();
    port.register(coreSessionList);
    expect(catalog.list()).toHaveLength(1);
    // Second identical registration (bootstrap re-run) is a silent no-op via the port.
    port.register(coreSessionList);
    expect(catalog.list()).toHaveLength(1);
  });

  it("catalog persists across fresh platform reloads (the registry is a catalog projection)", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "cap3-plat2-"));
    try {
      const { catalog, port } = (() => {
        const c = new CapabilityCatalog(new CapabilityDefinitionStore({ dir: dir2 }));
        return { catalog: c, port: new CatalogBackedCapabilityMutationPort(c) };
      })();
      port.register(toolFileRead);
      const fresh = new CapabilityPlatform({ catalogDir: dir2, eventLog: new EventLog(sessionDir + "-2") });
      expect(fresh.service.list().items).toHaveLength(1);
      expect(fresh.service.inspect("tool.file.read")?.kind).toBe("operation");
      // The same file-backed catalog is readable from any platform constructed against it.
      expect(catalog.list()).toHaveLength(1);
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });
});
