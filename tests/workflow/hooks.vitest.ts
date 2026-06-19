/**
 * P4.6a — Hook Manager tests.
 */

import { describe, it, expect } from "vitest";
import { HookManager } from "../../src/workflow/hooks.js";

describe("HookManager", () => {
  it("registers and runs a pre-commit hook", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("preCommit", (ctx) => { calls.push(`pre:${ctx.files?.join(",")}`); });
    await hooks.run("preCommit", { type: "preCommit", files: ["a.ts", "b.ts"] });
    expect(calls).toEqual(["pre:a.ts,b.ts"]);
  });

  it("registers and runs a post-commit hook", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("postCommit", (ctx) => { calls.push(`post:${ctx.commitSha}`); });
    await hooks.run("postCommit", { type: "postCommit", commitSha: "abc123" });
    expect(calls).toEqual(["post:abc123"]);
  });

  it("runs multiple hooks for the same event", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("preToolUse", () => { calls.push("hook1"); });
    hooks.register("preToolUse", () => { calls.push("hook2"); });
    await hooks.run("preToolUse", { type: "preToolUse" });
    expect(calls).toEqual(["hook1", "hook2"]);
  });

  it("a pre hook can block execution by returning false", async () => {
    const hooks = new HookManager();
    hooks.register("preToolUse", () => false);
    const result = await hooks.run("preToolUse", { type: "preToolUse" });
    expect(result).toBe(false);
  });

  it("can remove a hook", async () => {
    const calls: string[] = [];
    const hooks = new HookManager();
    hooks.register("preCommit", () => { calls.push("runs"); });
    hooks.remove("preCommit");
    await hooks.run("preCommit", { type: "preCommit" });
    expect(calls).toEqual([]);
  });

  it("rejects unknown hook type on register", () => {
    const hooks = new HookManager();
    expect(() => hooks.register("invalid" as any, () => {})).toThrow();
  });
});
