import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

describe("router hardening — false positives", () => {
  // --- Conceptual/help prompts must NOT route to tool ---

  it('"how to write a file" does not route to tool', () => {
    const route = taskRouter("how to write a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"explain how to delete a file" does not route to tool', () => {
    const route = taskRouter("explain how to delete a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"what is a file" does not route to tool', () => {
    const route = taskRouter("what is a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"why write to a file" does not route to tool', () => {
    const route = taskRouter("why write to a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"how do I create a file" does not route to tool', () => {
    const route = taskRouter("how do I create a file");
    assert.notEqual(route.kind, "tool");
  });

  // --- Vague/ambiguous prompts must not route to tool ---

  it('"add a new button to the dashboard" does not route to tool', () => {
    const route = taskRouter("add a new button to the dashboard");
    assert.notEqual(route.kind, "tool");
  });

  it('"remove this feature" does not route to tool', () => {
    const route = taskRouter("remove this feature");
    assert.notEqual(route.kind, "tool");
  });

  it('"delete the section" does not route to tool', () => {
    const route = taskRouter("delete the section");
    assert.notEqual(route.kind, "tool");
  });

  it('"delete it" does not route to tool', () => {
    const route = taskRouter("delete it");
    assert.notEqual(route.kind, "tool");
  });

  it('"remove the file" with no specific path does not route to tool', () => {
    const route = taskRouter("remove the file");
    assert.notEqual(route.kind, "tool");
  });

  // --- Real file operations still route to tool ---

  it('"write hello to test.txt" still routes to tool', () => {
    const route = taskRouter("write hello to test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"append hello to test.txt" still routes to tool', () => {
    const route = taskRouter("append hello to test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"read test.txt" still routes to tool', () => {
    const route = taskRouter("read test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"delete test.txt" still routes to tool', () => {
    const route = taskRouter("delete test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"show notes.txt" still routes to tool', () => {
    const route = taskRouter("show notes.txt");
    assert.equal(route.kind, "tool");
  });

  // --- Path variants ---

  it('"write hello to ./notes/test.txt" routes to tool', () => {
    const route = taskRouter("write hello to ./notes/test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"write hello to /tmp/output.txt" routes to tool', () => {
    const route = taskRouter("write hello to /tmp/output.txt");
    assert.equal(route.kind, "tool");
  });

  it("write with semicolon injection is rejected by guardrail (not a valid file path)", () => {
    // The semicolon makes the target "test.txt; rm -rf ." not look like a file path,
    // so the guardrail correctly rejects it as a false positive.
    const route = taskRouter('write hello to test.txt; rm -rf .');
    assert.notEqual(route.kind, "tool");
  });

  it('"show my file.txt" routes to tool and shell-quotes the path', () => {
    const route = taskRouter("show my file.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok((route.args.command as string).includes("'my file.txt'"), "must quote path with spaces");
    }
  });

  // --- Additional path/target variants ---

  it('"create README.md with hello" routes to tool', () => {
    const route = taskRouter("create README.md with hello");
    assert.equal(route.kind, "tool");
  });

  it('"delete directory ./tmp" routes to rm -rf with quoted path', () => {
    const route = taskRouter("delete directory ./tmp");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok((route.args.command as string).includes("-rf"), "directory delete must use -rf");
      assert.ok((route.args.command as string).includes("'./tmp'"), "path must be quoted");
    }
  });

  it('"remove ./tmp/cache" routes to tool with specific path', () => {
    const route = taskRouter("remove ./tmp/cache");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok((route.args.command as string).startsWith("rm"), "must use rm");
      assert.ok((route.args.command as string).includes("'./tmp/cache'"), "path must be quoted");
    }
  });
});
