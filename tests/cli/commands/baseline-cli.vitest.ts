import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { handleBaselineCommand } from "../../../src/cli/commands/baseline.js";

describe("baseline CLI", () => {
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((msg) => { logs.push(String(msg)); });
    vi.spyOn(console, "error").mockImplementation((msg) => { errors.push(String(msg)); });
    vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit");
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list shows demo", async () => {
    await handleBaselineCommand(["list"]);
    expect(logs.some((l) => l === "demo")).toBe(true);
  });

  it("providers shows demo row", async () => {
    await handleBaselineCommand(["providers"]);
    expect(logs.some((l) => l.includes("demo"))).toBe(true);
  });

  it("providers shows capabilities column", async () => {
    await handleBaselineCommand(["providers"]);
    expect(logs.some((l) => l.includes("capture"))).toBe(true);
  });

  it("providers shows state column", async () => {
    await handleBaselineCommand(["providers"]);
    expect(logs.some((l) => l.includes("ready"))).toBe(true);
  });

  it("health prints score table", async () => {
    await handleBaselineCommand(["health"]);
    expect(logs.some((l) => l.includes("demo"))).toBe(true);
    expect(logs.some((l) => l.includes("Score"))).toBe(true);
    expect(logs.some((l) => l.includes("EXCELLENT") || l.includes("HEALTHY") || l.includes("WARNING") || l.includes("CRITICAL"))).toBe(true);
  });

  it("show demo prints drift report", async () => {
    await handleBaselineCommand(["show", "demo"]);
    expect(logs.some((l) => l.includes("demo"))).toBe(true);
    expect(logs.some((l) => l.includes("Score"))).toBe(true);
    expect(logs.some((l) => l.includes("drift") || l.includes("uptime") || l.includes("responseTime") || l.includes("errorRate"))).toBe(true);
  });

  it("show missing subsystem errors", async () => {
    await expect(
      handleBaselineCommand(["show", "nonexistent"]),
    ).rejects.toThrow("process.exit");
    expect(errors.some((e) => e.includes("no provider registered"))).toBe(true);
  });

  it("health --json valid JSON", async () => {
    await handleBaselineCommand(["health", "--json"]);
    const json = logs.join("\n");
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(6);
    expect(parsed.some((r: any) => r.subsystem === "demo")).toBe(true);
    expect(parsed.some((r: any) => r.subsystem === "governance")).toBe(true);
    expect(parsed.some((r: any) => r.subsystem === "memory")).toBe(true);
    expect(parsed.some((r: any) => r.subsystem === "skills")).toBe(true);
    expect(parsed.some((r: any) => r.subsystem === "agents")).toBe(true);
    expect(parsed.some((r: any) => r.subsystem === "workflow")).toBe(true);
  });

  it("show --json valid JSON", async () => {
    await handleBaselineCommand(["show", "demo", "--json"]);
    const json = logs.join("\n");
    const parsed = JSON.parse(json);
    expect(parsed.subsystem).toBe("demo");
    expect(typeof parsed.score).toBe("number");
  });
});
