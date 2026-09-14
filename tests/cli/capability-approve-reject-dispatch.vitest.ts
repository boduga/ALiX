/**
 * Capability approve/reject dispatcher registration (#710).
 *
 * Pins that `approve` and `reject` route through handleCapabilityCommand
 * with the injected service (thin delegation, no second mutation path).
 */
import { describe, it, expect } from "vitest";
import { handleCapabilityCommand } from "../../src/cli/commands/capability.js";

function stubService() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  return {
    calls,
    service: {
      apply: async (...args: unknown[]) => {
        calls.push({ method: "apply", args });
        return { status: "executed", proposalId: "p1" };
      },
      reject: async (...args: unknown[]) => {
        calls.push({ method: "reject", args });
        return { proposalId: "p1", status: "rejected" };
      },
    },
  };
}

describe("capability approve/reject dispatcher", () => {
  it("routes approve through service.apply({ proposalId })", async () => {
    const { calls, service } = stubService();
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...a: unknown[]) => lines.push(a.map(String).join(" "));
    try {
      const exit = await handleCapabilityCommand(["approve", "p1"], {
        cwd: "/tmp",
        service: service as never,
      });
      expect(exit).toBe(0);
    } finally {
      console.log = origLog;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("apply");
    expect(calls[0]!.args).toEqual([{ proposalId: "p1" }]);
  });

  it("routes reject through service.reject(proposalId, reason)", async () => {
    const { calls, service } = stubService();
    const origLog = console.log;
    console.log = () => {};
    try {
      const exit = await handleCapabilityCommand(["reject", "p1", "not", "needed"], {
        cwd: "/tmp",
        service: service as never,
      });
      expect(exit).toBe(0);
    } finally {
      console.log = origLog;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("reject");
    expect(calls[0]!.args).toEqual(["p1", "not needed"]);
  });

  it("approve without a proposalId is a usage error", async () => {
    const { service } = stubService();
    const origError = console.error;
    console.error = () => {};
    try {
      const exit = await handleCapabilityCommand(["approve"], {
        cwd: "/tmp",
        service: service as never,
      });
      expect(exit).toBe(2);
    } finally {
      console.error = origError;
    }
  });
});
