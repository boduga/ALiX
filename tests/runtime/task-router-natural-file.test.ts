import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

function toolCmd(route: unknown): string {
  const r = route as { kind: "tool"; args: { command: string } };
  return r.args.command;
}

describe("natural-language file operation routing", () => {
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
  });

  it('"append X to Y" routes to tool', () => {
    const route = taskRouter("append hello to test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(toolCmd(route).includes(">>"));
    }
  });

  it('"delete test.txt" routes to tool with rm', () => {
    const route = taskRouter("delete test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = toolCmd(route);
      assert.ok(cmd.startsWith("rm"));
      assert.ok(!cmd.includes("-rf"));
    }
  });

  it('"delete directory temp" is rejected by guardrail', () => {
    const route = taskRouter("delete directory temp");
    assert.notEqual(route.kind, "tool");
  });

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

  it("write with semicolon injection is rejected by guardrail", () => {
    const route = taskRouter("write hello to test.txt; rm -rf .");
    assert.notEqual(route.kind, "tool");
  });

  it("content with quotes is properly handled", () => {
    const route = taskRouter('write "hello world" to test.txt');
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = toolCmd(route);
      assert.ok(cmd.includes("hello world") || cmd.includes("hello"));
    }
  });

  it('"list files" still routes to tool', () => {
    const route = taskRouter("list files");
    assert.equal(route.kind, "tool");
  });

  it('"how to write a file" does NOT route to tool', () => {
    const route = taskRouter("how to write a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"create a file called test.txt with hello" routes to tool', () => {
    const route = taskRouter("create a file called test.txt with hello");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = toolCmd(route);
      assert.ok(cmd.includes("printf"));
      assert.ok(cmd.includes("'test.txt'"));
    }
  });

  it('"make a file named foo.txt with content bar" routes to tool', () => {
    const route = taskRouter("make a file named foo.txt with content bar");
    assert.equal(route.kind, "tool");
  });

  it('"create file output.txt with hello world" routes to tool', () => {
    const route = taskRouter("create file output.txt with hello world");
    assert.equal(route.kind, "tool");
  });

  it('"create a file called readme with notes" rejected (no extension)', () => {
    const route = taskRouter("create a file called readme with notes");
    assert.notEqual(route.kind, "tool");
  });
});
