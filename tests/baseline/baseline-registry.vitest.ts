import { describe, it, expect } from "vitest";
import { BaselineRegistry, createDefaultBaselineRegistry } from "../../src/baseline/baseline-registry.js";
import { DemoBaselineProvider } from "../../src/baseline/providers/demo-provider.js";

describe("BaselineRegistry", () => {
  it("register adds a provider", () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    expect(reg.discover()).toHaveLength(1);
  });

  it("register duplicate throws", () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    expect(() => reg.register(new DemoBaselineProvider())).toThrow("already registered");
  });

  it("discover returns all providers", () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    expect(reg.discover().map((p) => p.subsystem)).toEqual(["demo"]);
  });

  it("get returns the correct provider", () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    const p = reg.get("demo");
    expect(p.subsystem).toBe("demo");
    expect(p.version).toBe("1.0.0");
  });

  it("get missing throws", () => {
    const reg = new BaselineRegistry();
    expect(() => reg.get("demo" as any)).toThrow("no provider registered");
  });

  it("describe returns ProviderInfo", () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    const info = reg.describe("demo");
    expect(info.subsystem).toBe("demo");
    expect(info.version).toBe("1.0.0");
    expect(info.description).toBeTruthy();
    expect(info.capabilities).toContain("capture");
    expect(info.state).toBe("ready");
  });

  it("runAll captures and compares", async () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    const results = await reg.runAll();
    expect(results).toHaveLength(1);
    expect(results[0].subsystem).toBe("demo");
    expect(results[0].drift.length).toBeGreaterThan(0);
  });

  it("runOne captures and compares a single subsystem", async () => {
    const reg = new BaselineRegistry();
    reg.register(new DemoBaselineProvider());
    const result = await reg.runOne("demo");
    expect(result.subsystem).toBe("demo");
    expect(typeof result.score).toBe("number");
  });

  it("createDefaultBaselineRegistry registers all nine providers", () => {
    const reg = createDefaultBaselineRegistry();
    const providers = reg.discover();
    const subsystems = providers.map((p) => p.subsystem);
    expect(subsystems).toEqual(["demo", "governance", "memory", "skills", "agents", "workflow", "security", "tools", "adaptation"]);
    expect(providers.length).toBe(9);
    for (const p of providers) {
      expect(p.state).toBe("ready");
    }
  });
});
