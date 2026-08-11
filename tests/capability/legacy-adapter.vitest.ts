import { describe, it, expect } from "vitest";
import type { Capability } from "../../src/capability/types.js";
import { legacyToCanonicalDefinition, canonicalToLegacyCapability, buildLegacyBindings } from "../../src/capability/legacy-adapter.js";
import { migrateKind } from "../../src/capability/canonical/kind.js";

function makeLegacyCap(overrides: Partial<Capability> = {}): Capability {
  return {
    id: "tool.file.read", version: "1.0", kind: "tool",
    title: "Read file", description: "Read file contents",
    tags: ["file"], category: "file", risk: "low",
    requiredPermissions: ["developer"],
    argsSchema: { type: "object" }, resultSchema: { type: "object" },
    execution: { strategy: "tool", timeout: 10_000, cancellable: false },
    extensions: { toolName: "file.read" },
    ...overrides,
  };
}

describe("legacy↔canonical conversion adapter", () => {
  it("converts a legacy capability to a canonical definition losslessly", () => {
    const def = legacyToCanonicalDefinition(makeLegacyCap());
    expect(def.id).toBe("tool.file.read");
    expect(def.version).toBe("1.0.0");                       // short semver normalized (#479)
    expect(def.kind).toBe("operation");                       // migrateKind("tool") → operation
    expect(def.bindings).toHaveLength(1);
    expect(def.bindings[0]!.type).toBe("tool");               // execution.strategy → provider type
    expect(def.bindings[0]!.config).toMatchObject({ toolName: "file.read" }); // extensions.toolName rides binding.config
  });

  it("round-trips back to a legacy capability, preserving toolName", () => {
    const def = legacyToCanonicalDefinition(makeLegacyCap());
    const back = canonicalToLegacyCapability(def);
    expect(back.id).toBe("tool.file.read");
    expect(back.kind).toBe("tool");                           // operation → tool (best-effort reverse)
    expect(back.execution.strategy).toBe("tool");
    expect(back.extensions?.toolName).toBe("file.read");      // recovered from binding.config
    expect(back.title).toBe("Read file");
    expect(back.requiredPermissions).toEqual(["developer"]);
  });

  it("maps every real initial capability losslessly (representability)", () => {
    // core.session.list (kind core, strategy native) + tool.shell.run (kind tool)
    const core = legacyToCanonicalDefinition(makeLegacyCap({ id: "core.session.list", kind: "core", execution: { strategy: "native" }, extensions: undefined }));
    expect(core.kind).toBe("core");
    expect(core.bindings[0]!.type).toBe("native");
    const shell = legacyToCanonicalDefinition(makeLegacyCap({ id: "tool.shell.run", risk: "high", requiredPermissions: ["admin"], execution: { strategy: "tool" }, extensions: { toolName: "shell.run" } }));
    expect(shell.bindings[0]!.config).toEqual({ toolName: "shell.run" });
  });

  it("round-trips execution timeout/cancellable through binding.config (lossless)", () => {
    const def = legacyToCanonicalDefinition(makeLegacyCap({ execution: { strategy: "tool", timeout: 10_000, cancellable: true } }));
    expect(def.bindings[0]!.config).toMatchObject({ timeout: 10_000, cancellable: true });
    const back = canonicalToLegacyCapability(def);
    expect(back.execution.timeout).toBe(10_000);
    expect(back.execution.cancellable).toBe(true);
  });

  it("throws on a legacy custom kind (no canonical equivalent)", () => {
    expect(() => legacyToCanonicalDefinition(makeLegacyCap({ kind: "custom" }))).toThrow(/migrate|kind/i);
  });
});
