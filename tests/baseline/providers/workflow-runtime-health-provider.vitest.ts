import { describe, it, expect } from "vitest";
import { WorkflowRuntimeHealthProvider } from "../../../src/baseline/providers/workflow-runtime-health-provider.js";

describe("WorkflowRuntimeHealthProvider", () => {
  const provider = new WorkflowRuntimeHealthProvider();

  it("subsystem returns 'workflow'", () => {
    expect(provider.subsystem).toBe("workflow");
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
