import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import Database from "better-sqlite3";

import { RuntimeLedger } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { RuntimeEvent } from "../../src/runtime-state/contracts/runtime-event.js";

const evidence = {
  decisionId: "decision-1",
  principalId: "principal-1",
  credentialRef: "hmac-sha256:v1:known-test-digest",
  decision: "approve",
  nonce: "nonce-1",
  decidedAt: "2026-10-14T12:00:00.000Z",
  transport: "bearer",
};

function decisionEvent(
  payload: Record<string, unknown>,
  overrides: Partial<RuntimeEvent> = {},
): RuntimeEvent {
  return {
    eventId: "event-1",
    eventType: "approval.updated",
    schemaVersion: 1,
    entityType: "approval",
    entityId: "approval-1",
    entityVersion: 1,
    correlationId: "decision-1",
    actor: { type: "operator", id: evidence.principalId },
    occurredAt: evidence.decidedAt,
    recordedAt: evidence.decidedAt,
    payload,
    ...overrides,
  };
}

async function withLedger(
  run: (databasePath: string) => Promise<void> | void,
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "alix-srap-durability-"));
  try {
    await run(path.join(directory, "runtime.db"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("transition and remote decision evidence survive authoritative read-back", async () => {
  await withLedger((databasePath) => {
    const ledger = new RuntimeLedger({ dbPath: databasePath });
    ledger.append({
      expectedVersion: 0,
      event: decisionEvent({ id: "approval-1", status: "approved", remoteDecisionEvidence: evidence }),
    });
    ledger.close();

    const reopened = new RuntimeLedger({ dbPath: databasePath });
    const events = reopened.readEvents({ entityId: "approval-1" });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0]?.payload, {
      id: "approval-1",
      status: "approved",
      remoteDecisionEvidence: evidence,
    });
    reopened.close();
  });
});

test("failure after event and entity writes rolls back transition, evidence, and outbox", async () => {
  await withLedger((databasePath) => {
    const ledger = new RuntimeLedger({ dbPath: databasePath });
    const injector = new Database(databasePath);
    injector.exec(`
      CREATE TRIGGER inject_outbox_failure
      BEFORE INSERT ON runtime_outbox
      BEGIN
        SELECT RAISE(ABORT, 'injected outbox failure');
      END;
    `);
    injector.close();

    assert.throws(() => ledger.append({
      event: decisionEvent({
        id: "approval-1",
        status: "approved",
        remoteDecisionEvidence: evidence,
      }),
      expectedVersion: 0,
    }), /injected outbox failure/);
    assert.equal(ledger.entityVersion("approval-1"), 0);
    assert.equal(ledger.readEvents({ entityId: "approval-1" }).length, 0);
    assert.equal(ledger.claimOutbox().length, 0);
    ledger.close();
  });
});

// Workload-scaled timeout: this test spawns a child process, waits for a commit
// marker, SIGKILLs it, then reopens the ledger — process spawn + fsync can
// exceed the suite default under load.
test("commit-before-ack survives process termination and restart", { timeout: 60_000 }, async () => {
  await withLedger(async (databasePath) => {
    const moduleUrl = pathToFileURL(
      path.resolve("dist/src/runtime-state/storage/runtime-ledger.js"),
    ).href;
    const childScript = `
      import { RuntimeLedger } from ${JSON.stringify(moduleUrl)};
      const ledger = new RuntimeLedger({ dbPath: process.argv[1] });
      ledger.append(JSON.parse(process.argv[2]));
      process.send("COMMITTED");
      setInterval(() => {}, 1000);
    `;
    const input = {
      expectedVersion: 0,
      event: decisionEvent({ id: "approval-1", status: "approved", remoteDecisionEvidence: evidence }),
    };
    const child = spawn(process.execPath, ["--input-type=module", "-e", childScript, databasePath, JSON.stringify(input)], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    let stderr = "";
    const childStderr = child.stderr;
    assert.ok(childStderr);
    childStderr.setEncoding("utf8");
    childStderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    let markerTimeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolve, reject) => {
          child.on("message", (message) => {
            if (message === "COMMITTED") resolve();
            else reject(new Error(`unexpected child message: ${String(message)}`));
          });
        }),
        once(child, "exit").then(([code]) => {
          throw new Error(`child exited before commit marker (${String(code)}): ${stderr}`);
        }),
        new Promise<never>((_, reject) => {
          markerTimeout = setTimeout(
            () => reject(new Error(`child commit marker timeout: ${stderr}`)),
            20_000,
          );
        }),
      ]);
      child.kill("SIGKILL");
      await once(child, "exit");
    } finally {
      if (markerTimeout) clearTimeout(markerTimeout);
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }

    const reopened = new RuntimeLedger({ dbPath: databasePath });
    assert.deepEqual(
      reopened.lastEvent("approval-1", "approval")?.payload,
      input.event.payload,
    );
    reopened.close();
  });
});

test("reopened WAL ledger uses FULL synchronous durability", async () => {
  await withLedger((databasePath) => {
    new RuntimeLedger({ dbPath: databasePath }).close();
    const reopened = new RuntimeLedger({ dbPath: databasePath });
    assert.deepEqual(reopened.durabilitySettings(), {
      journalMode: "wal",
      synchronous: 2,
    });
    reopened.close();
  });
});
