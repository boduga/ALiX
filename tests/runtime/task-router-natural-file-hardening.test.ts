import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { taskRouter } from "../../src/runtime/task-router.js";

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
  const r = route as { kind: "agent"; diagnostic?: { classification?: string } };
  assert.equal(r.diagnostic?.classification, "workspace_mutation");
}

describe("router hardening — false positives", () => {
  // --- Conceptual/help prompts must NOT route to tool ---

  it('"how to write a file" does not route to tool', async () => {
    const route = await taskRouter("how to write a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"explain how to delete a file" does not route to tool', async () => {
    const route = await taskRouter("explain how to delete a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"what is a file" does not route to tool', async () => {
    const route = await taskRouter("what is a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"why write to a file" does not route to tool', async () => {
    const route = await taskRouter("why write to a file");
    assert.notEqual(route.kind, "tool");
  });

  it('"how do I create a file" does not route to tool', async () => {
    const route = await taskRouter("how do I create a file");
    assert.notEqual(route.kind, "tool");
  });

  // --- Vague/ambiguous prompts must not route to tool ---

  it('"add a new button to the dashboard" does not route to tool', async () => {
    const route = await taskRouter("add a new button to the dashboard");
    assert.notEqual(route.kind, "tool");
  });

  it('"remove this feature" does not route to tool', async () => {
    const route = await taskRouter("remove this feature");
    assert.notEqual(route.kind, "tool");
  });

  it('"delete the section" does not route to tool', async () => {
    const route = await taskRouter("delete the section");
    assert.notEqual(route.kind, "tool");
  });

  it('"delete it" does not route to tool', async () => {
    const route = await taskRouter("delete it");
    assert.notEqual(route.kind, "tool");
  });

  it('"remove the file" with no specific path does not route to tool', async () => {
    const route = await taskRouter("remove the file");
    assert.notEqual(route.kind, "tool");
  });

  // --- File mutations route to the governed agent path (not raw shell) ---

  it('"write hello to test.txt" routes to agent (workspace_mutation), not raw shell', async () => {
    const route = await taskRouter("write hello to test.txt");
    assertMutation(route, "write hello to test.txt");
  });

  it('"append hello to test.txt" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("append hello to test.txt");
    assertMutation(route, "append hello to test.txt");
  });

  it('"read test.txt" still routes to tool (read-only stays tool)', async () => {
    const route = await taskRouter("read test.txt");
    assert.equal(route.kind, "tool");
  });

  it('"delete test.txt" routes to agent (workspace_mutation), not rm via shell', async () => {
    const route = await taskRouter("delete test.txt");
    assertMutation(route, "delete test.txt");
  });

  it('"show notes.txt" still routes to tool (read-only stays tool)', async () => {
    const route = await taskRouter("show notes.txt");
    assert.equal(route.kind, "tool");
  });

  // --- Path variants ---

  it('"write hello to ./notes/test.txt" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("write hello to ./notes/test.txt");
    assertMutation(route, "write hello to ./notes/test.txt");
  });

  it('"write hello to /tmp/output.txt" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("write hello to /tmp/output.txt");
    assertMutation(route, "write hello to /tmp/output.txt");
  });

  it("write with semicolon injection is rejected by guardrail (not a valid file path)", async () => {
    // The semicolon makes the target "test.txt; rm -rf ." not look like a file path,
    // so the guardrail correctly rejects it as a false positive.
    const route = await taskRouter('write hello to test.txt; rm -rf .');
    assert.notEqual(route.kind, "tool");
  });

  it('"show my file.txt" routes to tool and shell-quotes the path', async () => {
    const route = await taskRouter("show my file.txt");
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.ok((route.args.command as string).includes("'my file.txt'"), "must quote path with spaces");
    }
  });

  // --- Additional path/target variants ---

  it('"create README.md with hello" routes to agent (workspace_mutation)', async () => {
    const route = await taskRouter("create README.md with hello");
    assertMutation(route, "create README.md with hello");
  });

  it('"delete directory ./tmp" routes to agent (workspace_mutation), not rm -rf via shell', async () => {
    const route = await taskRouter("delete directory ./tmp");
    assertMutation(route, "delete directory ./tmp");
  });

  it('"remove ./tmp/cache" routes to agent (workspace_mutation), not rm via shell', async () => {
    const route = await taskRouter("remove ./tmp/cache");
    assertMutation(route, "remove ./tmp/cache");
  });
});
