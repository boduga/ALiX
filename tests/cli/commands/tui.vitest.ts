import { describe, expect, it } from "vitest";
import { handlePolicyCommand } from "../../../src/cli/commands/tui.js";

describe("handlePolicyCommand", () => {
  it("returns current mode when called with empty string", () => {
    const config: any = {};
    const output = handlePolicyCommand(config, "");
    expect(output[0]).toContain("bypass");
  });

  it("returns current mode when called with 'show'", () => {
    const config: any = { permissions: { sessionMode: "ask" } };
    const output = handlePolicyCommand(config, "show");
    expect(output[0]).toContain("ask");
  });

  it("returns current mode when called with 'status'", () => {
    const config: any = { permissions: { sessionMode: "auto" } };
    const output = handlePolicyCommand(config, "status");
    expect(output[0]).toContain("auto");
  });

  it("changes mode to ask", () => {
    const config: any = {};
    const output = handlePolicyCommand(config, "ask");
    expect(config.permissions.sessionMode).toBe("ask");
    expect(output[0]).toContain("ask");
  });

  it("changes mode to bypass", () => {
    const config: any = {};
    const output = handlePolicyCommand(config, "bypass");
    expect(config.permissions.sessionMode).toBe("bypass");
    expect(output[0]).toContain("bypass");
  });

  it("changes mode to auto", () => {
    const config: any = {};
    const output = handlePolicyCommand(config, "auto");
    expect(config.permissions.sessionMode).toBe("auto");
    expect(output[0]).toContain("auto");
  });

  it("mutates config permissions object in place", () => {
    const config: any = {};
    handlePolicyCommand(config, "ask");
    expect(config.permissions).toBeDefined();
    expect(config.permissions.sessionMode).toBe("ask");
  });

  it("returns unknown command usage for unrecognized args", () => {
    const config: any = {};
    const output = handlePolicyCommand(config, "unknown");
    expect(output[0]).toContain("Unknown");
    expect(output[0]).toContain("policy");
  });
});
