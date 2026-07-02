import { describe, it, expect, afterEach, vi } from "vitest";
import { MemoryHealthProvider } from "../../../src/baseline/providers/memory-health-provider.js";

describe("MemoryHealthProvider", () => {
  const provider = new MemoryHealthProvider();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Metadata
  // -----------------------------------------------------------------------
  it("subsystem returns 'memory'", () => {
    expect(provider.subsystem).toBe("memory");
  });

  it("metadata: version, state, capabilities", () => {
    expect(provider.version).toBe("1.0.0");
    expect(provider.state).toBe("ready");
    expect(provider.capabilities).toContain("capture");
  });

  // -----------------------------------------------------------------------
  // classifyDrift
  // -----------------------------------------------------------------------
  it("classifyDrift returns correct categories", () => {
    expect(provider.classifyDrift("healthScore", 0)).toBe("performance");
    expect(provider.classifyDrift("issueCount", 0)).toBe("behavior");
    expect(provider.classifyDrift("unknown", 0)).toBe("performance");
  });

  // -----------------------------------------------------------------------
  // baseline semantics — test the caching behavior directly
  // -----------------------------------------------------------------------
  it("baseline returns same artifact on second call (cached)", async () => {
    const first = await provider.captureBaseline();
    const second = await provider.captureBaseline();
    // Both should reference the same cached artifact
    expect(first.capturedAt).toBe(second.capturedAt);
  });

  it("current returns fresh data even after baseline", async () => {
    const baseline = await provider.captureBaseline();
    // The baseline is cached; captureCurrent always creates a new artifact
    const current = await provider.captureCurrent();
    // Both may happen in the same millisecond, so compare data reference instead
    expect(current).not.toBe(baseline);
    // subequent baseline calls return cached artifact
    const baselineAgain = await provider.captureBaseline();
    expect(baselineAgain).toBe(baseline);
  });
});
