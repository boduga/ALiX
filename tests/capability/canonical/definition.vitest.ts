import { describe, it, expect } from "vitest";
import { validateCapabilityDefinition } from "../../../src/capability/canonical/definition.js";
import type { CapabilityDefinition } from "../../../src/capability/canonical/definition.js";

function makeDef(over: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    id: "core.session.list", version: "1.0.0", kind: "core",
    title: "List sessions", description: "List all sessions",
    tags: ["session"], category: "session", risk: "low",
    requiredPermissions: ["operator"], dependencies: [],
    bindings: [{ id: "session.list", type: "native" }],
    ...over,
  };
}

describe("CapabilityDefinition", () => {
  it("accepts a valid definition", () => {
    expect(() => validateCapabilityDefinition(makeDef())).not.toThrow();
  });
  it("rejects short SemVer version", () => {
    expect(() => validateCapabilityDefinition(makeDef({ version: "1.0" }))).toThrow(/version/);
  });
  it("rejects empty id", () => {
    expect(() => validateCapabilityDefinition(makeDef({ id: "" }))).toThrow(/id/);
  });
  it("rejects a kind that is a provider technology", () => {
    expect(() => validateCapabilityDefinition(makeDef({ kind: "tool" as never }))).toThrow(/kind/);
  });
  it("rejects a definition with no bindings", () => {
    expect(() => validateCapabilityDefinition(makeDef({ bindings: [] }))).toThrow(/binding/);
  });
  it("rejects an invalid binding inside the definition", () => {
    expect(() => validateCapabilityDefinition(makeDef({ bindings: [{ id: "", type: "native" }] }))).toThrow(/provider id/);
  });
  it("rejects non-serializable extensions", () => {
    expect(() => validateCapabilityDefinition(makeDef({ extensions: { fn: () => 1 } }))).toThrow(/serializable/);
  });
});
