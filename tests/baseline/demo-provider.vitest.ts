import { describe, it, expect } from "vitest";
import { DemoBaselineProvider } from "../../src/baseline/providers/demo-provider.js";

describe("DemoBaselineProvider", () => {
  const provider = new DemoBaselineProvider();

  it("subsystem returns 'demo'", () => {
    expect(provider.subsystem).toBe("demo");
  });

  it("version returns '1.0.0'", () => {
    expect(provider.version).toBe("1.0.0");
  });

  it("description is non-empty", () => {
    expect(provider.description.length).toBeGreaterThan(0);
  });

  it("capabilities includes 'capture'", () => {
    expect(provider.capabilities).toContain("capture");
  });

  it("state is 'ready'", () => {
    expect(provider.state).toBe("ready");
  });

  it("baseline has expected data shape", async () => {
    const artifact = await provider.captureBaseline();
    expect(artifact.subsystem).toBe("demo");
    const data = artifact.data as Record<string, number>;
    expect(data.uptime).toBe(100);
    expect(data.responseTime).toBe(200);
    expect(data.errorRate).toBe(0);
  });

  it("current has expected data shape", async () => {
    const artifact = await provider.captureCurrent();
    expect(artifact.subsystem).toBe("demo");
    const data = artifact.data as Record<string, number>;
    expect(data.uptime).toBe(95);
    expect(data.responseTime).toBe(350);
    expect(data.errorRate).toBe(2);
  });
});
