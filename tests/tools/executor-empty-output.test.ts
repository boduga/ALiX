import test from "node:test";
import assert from "node:assert/strict";
import { EventLog } from "../../src/events/event-log.js";
import { ToolExecutor } from "../../src/tools/executor.js";

// Minimal in-memory EventLog stub by extending EventLog but overriding file ops
class MemLog extends EventLog {
  events: any[] = [];
  constructor() {
    // sessionDir not used for real fs ops in this stub
    super(".alix/sessions/test");
  }
  async init(): Promise<void> {}
  async append(event: any) {
    this.events.push(event);
    return event;
  }
  async readAll() { return this.events; }
}

// Minimal router stub to simulate a tool returning empty success
class EmptySuccessRouter {
  async execute(_request: any) {
    return { kind: "success", output: "" };
  }
  downstream = { execute: async (_: any) => ({ kind: "success", output: "" }) };
}

// Monkey-patch ToolExecutor to avoid full router construction and use the stub
class TestToolExecutor extends ToolExecutor {
  constructor(config: any, log: EventLog, root: string) {
    super(config, log, root);
    // Replace the router with a stub that returns empty success
    (this as any).router = new EmptySuccessRouter();
  }
}

await test("executor emits tool.output for empty results and escalates after repeated empty outputs", async () => {
  const log = new MemLog();
  const config = { permissions: { sessionMode: "ask" }, model: { provider: "test", name: "m" } } as any;
  const executor = new TestToolExecutor(config, log as unknown as EventLog, process.cwd());

  const reqBase = { toolCallId: `call_${Date.now()}`, name: "file.glob", args: { pattern: "src/tools/**/*.ts" } };

  // Call it 3 times with the same logical signature
  await executor.execute(reqBase);
  await executor.execute({ ...reqBase, toolCallId: `call_${Date.now()+1}` });
  await executor.execute({ ...reqBase, toolCallId: `call_${Date.now()+2}` });

  const types = log.events.map(e => e.type);
  // There should be at least one tool.output and one agent.escalation
  assert.ok(types.includes("tool.output"), "tool.output should be emitted");
  assert.ok(types.includes("agent.escalation"), "agent.escalation should be emitted after repeated empty results");
});
