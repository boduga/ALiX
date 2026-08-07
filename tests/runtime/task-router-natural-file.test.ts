import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

function toolCmd(route: unknown): string {
  const r = route as { kind: "tool"; args: { command: string } };
  return r.args.command;
}

/**
 * Assert a prompt routes to the governed agent path as a workspace mutation
 * (wayfinder T8: workspace_mutation → agent via Layer 1 MUTATION_ANCHORS).
 * Mutations deliberately do NOT route to a raw `shell.run` — they go through
 * the governed ExecutionIntent / agent lifecycle instead.
 */
function assertMutation(route: unknown, prompt: string): void {
  assert.equal(
    (route as { kind: string }).kind,
    "agent",
    `"${prompt}" must route to agent (workspace_mutation), not tool`,
  );
  const r = route as {
    kind: "agent";
    diagnostic?: { classification?: string };
  };
  assert.equal(r.diagnostic?.classification, "workspace_mutation");
}

describe("natural-language file operation routing", () => {
  it('"write hello to test.txt" routes to agent (workspace_mutation), not chat or raw shell', async () => {
    const route = await taskRouter("write hello to test.txt");
    assertMutation(route, "write hello to test.txt");
  });

  it('"save X to Y" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("save data to output.txt");
    assertMutation(route, "save data to output.txt");
  });

  it('"create Y with X" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("create test.txt with hello world");
    assertMutation(route, "create test.txt with hello world");
  });

  it('"append X to Y" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("append hello to test.txt");
    assertMutation(route, "append hello to test.txt");
  });

  it('"delete test.txt" routes to agent (workspace_mutation), not rm via shell', async () => {
    const route = await taskRouter("delete test.txt");
    assertMutation(route, "delete test.txt");
  });

  it('"delete directory temp" is rejected by guardrail', async () => {
    const route = await taskRouter("delete directory temp");
    assert.notEqual(route.kind, "tool");
  });

  it('"show test.txt" routes to tool with cat (read-only stays tool)', async () => {
    const route = await taskRouter("show test.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok(toolCmd(route).startsWith("cat"));
    }
  });

  it('"read config.json" routes to tool (read-only stays tool)', async () => {
    const route = await taskRouter("read config.json");
    assert.equal(route.kind, "tool");
  });

  it("write with semicolon injection is rejected by guardrail", async () => {
    const route = await taskRouter("write hello to test.txt; rm -rf .");
    assert.notEqual(route.kind, "tool");
  });

  it("content with quotes is properly handled", async () => {
    const route = await taskRouter('write "hello world" to test.txt');
    // The quoted content form falls through to the legacy natural-file
    // path and routes to the shell.run tool.
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      const cmd = toolCmd(route);
      assert.ok(cmd.includes("hello world") || cmd.includes("hello"));
    }
  });

  it('"list files" still routes to tool', async () => {
    const route = await taskRouter("list files");
    assert.equal(route.kind, "tool");
  });

  it('"how to write a file" does NOT route to tool', async () => {
    const route = await taskRouter("how to write a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"create a file called test.txt with hello" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("create a file called test.txt with hello");
    assertMutation(route, "create a file called test.txt with hello");
  });

  it('"make a file named foo.txt with content bar" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("make a file named foo.txt with content bar");
    assertMutation(route, "make a file named foo.txt with content bar");
  });

  it('"create file output.txt with hello world" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("create file output.txt with hello world");
    assertMutation(route, "create file output.txt with hello world");
  });

  it('"create a file called readme with notes" rejected (no extension)', async () => {
    const route = await taskRouter("create a file called readme with notes");
    assert.notEqual(route.kind, "tool");
  });
});
