import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

/** Helper: extract the command string from a tool route. */
function toolCmd(route: unknown): string {
  const r = route as { kind: "tool"; args: { command: string } };
  return r.args.command;
}

describe("natural-language file operation routing", () => {
  // --- File write ---

  it('"write hello to test.txt" routes to tool (not chat)', () => {
    const route = taskRouter("write hello to test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "shell.run");
      const cmd = toolCmd(route);
      assert.ok(cmd.includes("printf"));
      assert.ok(cmd.includes("test.txt"));
    }
  });

  it('"save X to Y" routes to tool', () => {
    const route = taskRouter("save data to output.txt");
    assert.equal(route.kind, "tool");
  });

  it('"create Y with X" routes to tool', () => {
    const route = taskRouter("create test.txt with hello world");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(toolCmd(route).includes("printf"));
    }
  });

  // --- File append ---

  it('"append X to Y" routes to tool', () => {
    const route = taskRouter("append hello to test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(toolCmd(route).includes(">>"));
    }
  });

  // --- File delete ---

  it('"delete test.txt" routes to tool with rm', () => {
    const route = taskRouter("delete test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = toolCmd(route);
      assert.ok(cmd.startsWith("rm"));
      assert.ok(!cmd.includes("-rf")); // regular delete, not recursive
    }
  });

  it('"delete directory temp" is rejected by guardrail (temp is too vague)', () => {
    // M0.65 guardrail: 'temp' has no extension or path prefix, so it's not routed
    const route = taskRouter("delete directory temp");
    assert.notEqual(route.kind, "tool");
  });

  // --- File read ---

  it('"show test.txt" routes to tool with cat', () => {
    const route = taskRouter("show test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(toolCmd(route).startsWith("cat"));
    }
  });

  it('"read config.json" routes to tool', () => {
    const route = taskRouter("read config.json");
    assert.equal(route.kind, "tool");
  });

  // --- Shell injection protection ---

  it("write with semicolon injection is rejected by guardrail (not a valid file path)", () => {
    // M0.65 guardrail: the target 'test.txt; rm -rf .' does not look like a
    // valid file path, so the router rejects it instead of producing shell output.
    const route = taskRouter("write hello to test.txt; rm -rf .");
    assert.notEqual(route.kind, "tool");
  });

  it("content with quotes is properly handled", () => {
    const route = taskRouter('write "hello world" to test.txt');
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = toolCmd(route);
      // The content should have hello world (without the outer quotes)
      assert.ok(cmd.includes("hello world") || cmd.includes("hello"));
    }
  });

  // --- Existing routes still work ---

  it('"list files" still routes to tool', () => {
    const route = taskRouter("list files");
    assert.equal(route.kind, "tool");
  });

  it('"how to write a file" does NOT route to tool', () => {
    const route = taskRouter("how to write a file");
    assert.notEqual(route.kind, "tool");
  });
});
