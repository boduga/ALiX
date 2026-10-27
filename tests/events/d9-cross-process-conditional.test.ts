import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { EventLog } from "../../src/runtime-state/events/event-log.js";

it("D9 conditional completion is unique across eight OS processes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-d9-multiprocess-"));
  try {
    const moduleUrl = new URL("../../src/runtime-state/events/event-log.js", import.meta.url).href;
    const worker = `
      const { EventLog } = await import(${JSON.stringify(moduleUrl)});
      const log = new EventLog(${JSON.stringify(dir)});
      await log.init();
      const completion = { sessionId: "d9-os-session", actor: "coordination", type: "coordination.aggregate.completed", payload: { runId: "d9-os-run", aggregateResultRef: "d9-ref", sourceFingerprint: "d9-fp" } };
      const matches = e => e.type === completion.type && e.sessionId === completion.sessionId && e.payload?.runId === completion.payload.runId && e.payload?.aggregateResultRef === completion.payload.aggregateResultRef && e.payload?.sourceFingerprint === completion.payload.sourceFingerprint;
      const event = await log.appendIfAbsent(completion, matches);
      process.stdout.write(JSON.stringify({ id: event.id, seq: event.seq }));
      await log.close();
    `;
    const run = promisify(execFile);
    const outputs = await Promise.all(Array.from({ length: 8 }, () => run(process.execPath, ["--input-type=module", "-e", worker], { timeout: 60_000 })));
    const identities = outputs.map(({ stdout }) => JSON.parse(stdout) as { id: string; seq: number });
    assert.equal(new Set(identities.map(e => e.id)).size, 1);
    assert.equal(new Set(identities.map(e => e.seq)).size, 1);
    const reader = new EventLog(dir);
    await reader.init();
    assert.equal((await reader.readAll()).length, 1);
    await reader.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
