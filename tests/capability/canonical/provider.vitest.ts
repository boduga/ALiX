import { describe, it, expect } from "vitest";
import { PROVIDER_TYPES, validateProviderBinding } from "../../../src/capability/canonical/provider.js";
import type { CapabilityProviderBinding } from "../../../src/capability/canonical/provider.js";

describe("CapabilityProviderBinding", () => {
  it("defines the ADR-0013 provider classes", () => {
    expect([...PROVIDER_TYPES].sort()).toEqual(
      ["agent", "daemon", "external-cli", "mcp", "native", "plugin", "remote-api", "tool"].sort(),
    );
  });
  it("accepts a valid binding", () => {
    const b: CapabilityProviderBinding = { id: "gh", type: "external-cli", config: { executable: "gh" } };
    expect(() => validateProviderBinding(b)).not.toThrow();
  });
  it("rejects empty provider ids", () => {
    expect(() => validateProviderBinding({ id: "", type: "native" })).toThrow(/provider id/);
    expect(() => validateProviderBinding({ id: "  ", type: "native" })).toThrow(/provider id/);
  });
  it("rejects malformed provider types", () => {
    expect(() => validateProviderBinding({ id: "gh", type: "cli" })).toThrow(/provider type/);
    expect(() => validateProviderBinding({ id: "gh", type: "gitnexus" })).toThrow(/provider type/);
  });
  it("rejects non-serializable config (functions)", () => {
    const fn = () => 1;
    expect(() => validateProviderBinding({ id: "x", type: "native", config: { cb: fn } })).toThrow(/serializable/);
  });
  it("rejects a Date in config as non-serializable", () => {
    expect(() => validateProviderBinding({ id: "x", type: "native", config: { created: new Date() } })).toThrow(/serializable/);
  });
  it("rejects missing required config for external-cli", () => {
    expect(() => validateProviderBinding({ id: "gh", type: "external-cli" })).toThrow(/external-cli/);
  });
  it("accepts a plain id (no config) for native", () => {
    expect(() => validateProviderBinding({ id: "session.list", type: "native" })).not.toThrow();
  });
});
