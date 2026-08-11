import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityCatalog } from "../../src/capability/canonical/catalog.js";
import { CapabilityDefinitionStore } from "../../src/capability/canonical/catalog-store.js";
import { CatalogBackedCapabilityMutationPort } from "../../src/capability/mutation-port.js";
import { legacyToCanonicalDefinition } from "../../src/capability/legacy-adapter.js";
import type { Capability } from "../../src/capability/types.js";

function makeLegacyCap(): Capability {
  return { id: "tool.file.read", version: "1.0", kind: "tool", title: "Read file", description: "d",
    tags: [], category: "file", risk: "low", requiredPermissions: ["developer"], execution: { strategy: "tool" } };
}

describe("CatalogBackedCapabilityMutationPort", () => {
  let dir: string;
  let catalog: CapabilityCatalog;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cap3-mut-"));
    catalog = new CapabilityCatalog(new CapabilityDefinitionStore({ dir }));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("registers through the catalog (idempotent on duplicate id@version)", () => {
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    const def = legacyToCanonicalDefinition(makeLegacyCap());
    port.register(def);
    expect(catalog.has("tool.file.read")).toBe(true);
    expect(() => port.register(def)).not.toThrow(); // duplicate bootstrap re-run is a no-op
    expect(catalog.list()).toHaveLength(1);          // still exactly one entry
  });

  it("unregisters through the catalog", () => {
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    port.register(legacyToCanonicalDefinition(makeLegacyCap()));
    port.unregister("tool.file.read");
    expect(catalog.has("tool.file.read")).toBe(false);
  });

  it("unregister of an unknown id is a silent no-op", () => {
    const port = new CatalogBackedCapabilityMutationPort(catalog);
    expect(() => port.unregister("nope.missing")).not.toThrow();
  });
});
