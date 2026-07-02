import { describe, it, expect } from "vitest";
import { AgentRuntimeHealthProvider } from "../../../src/baseline/providers/agent-runtime-health-provider.js";

describe("AgentRuntimeHealthProvider", () => {
  const provider = new AgentRuntimeHealthProvider();

  it("subsystem returns 'agents'", () => {
    expect(provider.subsystem).toBe("agents");
  });

  it("metadata: version, state, capabilities", () => {
    expect(provider.version).toBe("1.0.0");
    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toContain("capture");
  });

  it("baseline caches on repeated calls", async () => {
    const first = await provider.captureBaseline();
    const second = await provider.captureBaseline();
    expect(second).toBe(first);
  });

  it("current returns fresh artifact", async () => {
    const baseline = await provider.captureBaseline();
    const current = await provider.captureCurrent();
    expect(current).not.toBe(baseline);
  });
});
