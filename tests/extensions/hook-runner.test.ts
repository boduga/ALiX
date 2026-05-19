import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { HookRunner, HOOK_TYPES, type HookEvent, type HookResult, type HookFn } from "../../src/extensions/hook-runner.js";

describe("HookRunner", () => {
  let runner: HookRunner;

  beforeEach(() => {
    runner = new HookRunner();
  });

  describe("register", () => {
    it("registers a hook under the given name", () => {
      const fn: HookFn = async () => {};
      runner.register("on_session_start", fn);
      const hooks = runner.getRegisteredHooks();
      assert.ok(hooks.includes("on_session_start"), "hook should be registered");
    });

    it("allows multiple hooks under the same name", async () => {
      const executed: string[] = [];
      const fn1: HookFn = async () => { executed.push("first"); };
      const fn2: HookFn = async () => { executed.push("second"); };
      runner.register("on_session_start", fn1);
      runner.register("on_session_start", fn2);
      // getRegisteredHooks returns unique names only
      const hooks = runner.getRegisteredHooks();
      assert.strictEqual(hooks.filter(h => h === "on_session_start").length, 1, "unique names only");
      // but execute runs all hooks registered under that name
      await runner.execute("on_session_start", { type: "on_session_start" });
      assert.deepStrictEqual(executed, ["first", "second"], "both hooks execute in order");
    });
  });

  describe("getRegisteredHooks", () => {
    it("returns empty array when no hooks registered", () => {
      const hooks = runner.getRegisteredHooks();
      assert.strictEqual(hooks.length, 0);
    });

    it("returns unique hook names", () => {
      runner.register("on_session_start", async () => {});
      runner.register("on_session_end", async () => {});
      runner.register("on_session_start", async () => {}); // duplicate
      const hooks = runner.getRegisteredHooks();
      assert.strictEqual(hooks.length, 2);
      assert.ok(hooks.includes("on_session_start"));
      assert.ok(hooks.includes("on_session_end"));
    });
  });

  describe("execute", () => {
    it("executes registered hooks in order", async () => {
      const order: string[] = [];
      runner.register("on_session_start", async () => {
        order.push("first");
      });
      runner.register("on_session_start", async () => {
        order.push("second");
      });
      runner.register("on_session_start", async () => {
        order.push("third");
      });

      const event: HookEvent = { type: "on_session_start" };
      await runner.execute("on_session_start", event);

      assert.deepStrictEqual(order, ["first", "second", "third"]);
    });

    it("returns HookResult with handled=false when no hooks registered", async () => {
      const event: HookEvent = { type: "on_session_start" };
      const result = await runner.execute("on_session_start", event);
      assert.strictEqual(result.handled, false);
    });

    it("returns HookResult with abort=true when a hook sets abort", async () => {
      runner.register("on_pre_tool", async (evt) => {
        return { event: evt, abort: true, reason: "stopped" };
      });

      const event: HookEvent = { type: "on_pre_tool" };
      const result = await runner.execute("on_pre_tool", event);
      assert.strictEqual(result.abort, true);
      assert.strictEqual(result.reason, "stopped");
    });

    it("stops executing hooks when abort is set", async () => {
      const order: string[] = [];
      runner.register("on_pre_tool", async () => {
        order.push("first");
        return { event: { type: "on_pre_tool" }, abort: true };
      });
      runner.register("on_pre_tool", async () => {
        order.push("second"); // should not run
      });

      const event: HookEvent = { type: "on_pre_tool" };
      await runner.execute("on_pre_tool", event);

      assert.deepStrictEqual(order, ["first"]);
    });

    it("includes event data in result", async () => {
      const event: HookEvent = { type: "on_tool_complete", data: { tool: "file_read" } };
      const result = await runner.execute("on_tool_complete", event);
      assert.strictEqual(result.event.type, "on_tool_complete");
      assert.strictEqual(result.event.data?.tool, "file_read");
    });
  });

  describe("executeAll", () => {
    it("executes all registered hooks across all types", async () => {
      const results: string[] = [];
      runner.register("on_session_start", async () => {
        results.push("session_start");
      });
      runner.register("on_session_end", async () => {
        results.push("session_end");
      });

      const event: HookEvent = { type: "test" };
      await runner.executeAll(event);

      assert.ok(results.includes("session_start"));
      assert.ok(results.includes("session_end"));
    });

    it("returns Map of hook names to results", async () => {
      runner.register("on_session_start", async () => ({ event: { type: "on_session_start" }, handled: true }));
      runner.register("on_session_end", async () => ({ event: { type: "on_session_end" }, handled: true }));

      const event: HookEvent = { type: "test" };
      const resultMap = await runner.executeAll(event);

      assert.ok(resultMap instanceof Map);
      assert.strictEqual(resultMap.get("on_session_start")?.handled, true);
      assert.strictEqual(resultMap.get("on_session_end")?.handled, true);
    });

    it("returns empty Map when no hooks registered", async () => {
      const event: HookEvent = { type: "test" };
      const resultMap = await runner.executeAll(event);
      assert.strictEqual(resultMap.size, 0);
    });
  });

  describe("error handling", () => {
    it("logs hook failures without stopping execution", async () => {
      const order: string[] = [];
      runner.register("on_pre_tool", async () => {
        order.push("before_error");
      });
      runner.register("on_pre_tool", async () => {
        throw new Error("Hook failed!");
      });
      runner.register("on_pre_tool", async () => {
        order.push("after_error");
      });

      const event: HookEvent = { type: "on_pre_tool" };
      await runner.execute("on_pre_tool", event);

      assert.deepStrictEqual(order, ["before_error", "after_error"]);
    });

    it("supports error callback", async () => {
      const errors: Error[] = [];
      runner.register("on_pre_tool", async () => {
        throw new Error("Failed hook");
      });

      runner.onError((err, event) => {
        errors.push(err);
      });

      const event: HookEvent = { type: "on_pre_tool" };
      await runner.execute("on_pre_tool", event);

      assert.strictEqual(errors.length, 1);
      assert.strictEqual(errors[0].message, "Failed hook");
    });
  });

  describe("HOOK_TYPES", () => {
    it("contains all required hook types", () => {
      assert.strictEqual(HOOK_TYPES.on_pre_tool, "Before tool execution");
      assert.strictEqual(HOOK_TYPES.on_post_tool, "After tool execution");
      assert.strictEqual(HOOK_TYPES.on_tool_complete, "When tool completes");
      assert.strictEqual(HOOK_TYPES.on_tool_error, "When tool fails");
      assert.strictEqual(HOOK_TYPES.on_pre_patch, "Before patch application");
      assert.strictEqual(HOOK_TYPES.on_post_patch, "After patch application");
      assert.strictEqual(HOOK_TYPES.on_approval_request, "When approval needed");
      assert.strictEqual(HOOK_TYPES.on_approval_resolved, "When approval given");
      assert.strictEqual(HOOK_TYPES.on_session_start, "Session starts");
      assert.strictEqual(HOOK_TYPES.on_session_end, "Session ends");
    });

    it("is frozen and immutable", () => {
      assert.ok(Object.isFrozen(HOOK_TYPES), "HOOK_TYPES should be frozen");
      // Verify the values cannot be changed
      const original = HOOK_TYPES.on_session_start;
      assert.strictEqual(original, "Session starts");
    });
  });
});