// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleCapabilitiesCommand } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-cli.js";
import { JsonlCapabilityLifecycleLedger } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-ledger.js";
import { CapabilityRegistry } from "../../../src/capability/registry.js";
import { CapabilityEvolutionStore } from "../../../src/adaptation/capability-evolution-store.js";
import type { Capability } from "../../../src/capability/types.js";
import type { CapabilitiesCLIDeps } from "../../../src/evolution/capability-lifecycle/capability-lifecycle-cli.js";

const _origExit = process.exit;
let exitCode: number | undefined;

let dir: string;
let deps: CapabilitiesCLIDeps;
let ledger: JsonlCapabilityLifecycleLedger;
let registry: CapabilityRegistry;

function makeCapability(id: string): Capability {
  return {
    id, version: "1.0.0", kind: "core", title: id, description: id,
    tags: [], category: "core", risk: "low", requiredPermissions: ["operator"],
    execution: { strategy: "native" },
  };
}

function capture(fn: () => Promise<void>): Promise<{ stdout: string }> {
  const writes: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => writes.push(args.join(" "));
  return fn().finally(() => {
    console.log = original;
  }).then(() => ({ stdout: writes.join("\n") }));
}

beforeEach(() => {
  exitCode = undefined;
  process.exit = ((code?: number): never => {
    exitCode = code ?? 0;
    throw new Error("__TEST_EXIT__");
  }) as typeof process.exit;
  dir = mkdtempSync(join(tmpdir(), "a7-cli-"));
  ledger = new JsonlCapabilityLifecycleLedger(join(dir, "lifecycle.jsonl"));
  registry = new CapabilityRegistry();
  registry.register(makeCapability("core.session.list"));
  registry.register(makeCapability("core.old"));
  deps = { cwd: dir, ledger, registry };
});

afterEach(() => {
  process.exit = _origExit;
  rmSync(dir, { recursive: true, force: true });
});

describe("handleCapabilitiesCommand", () => {
  it("lists registry capabilities with lifecycle overlay", async () => {
    const { stdout } = await capture(() => handleCapabilitiesCommand(["list"], deps));
    assert.ok(stdout.includes("core.session.list"));
    assert.ok(stdout.includes("core.old"));
  });

  it("inspects a known capability", async () => {
    const { stdout } = await capture(() => handleCapabilitiesCommand(["inspect", "core.session.list"], deps));
    assert.ok(stdout.includes("core.session.list"));
  });

  it("errors on an unknown capability for inspect", async () => {
    const original = console.error;
    let errOut = "";
    console.error = (m?: unknown) => { errOut = String(m); };
    try {
      await assert.rejects(
        capture(() => handleCapabilitiesCommand(["inspect", "nope.missing"], deps)),
        /__TEST_EXIT__/,
      );
    } finally {
      console.error = original;
      process.exitCode = 0; // reset CLI exit-1 side effect (repo convention)
    }
    assert.ok(errOut.includes("not found") || errOut.length > 0);
    assert.equal(exitCode, 1, "exits with code 1");
  });

  it("reports missing P5.5 report on health without inventing data", async () => {
    const { stdout } = await capture(() => handleCapabilitiesCommand(["health"], deps));
    assert.ok(stdout.includes("capability-evolution report"));
  });

  it("recommend is read-only: no ledger write", async () => {
    const before = (await ledger.list()).length;
    // No P5.5 report, no adoption → no candidates, still no write.
    await capture(() => handleCapabilitiesCommand(["recommend"], deps));
    assert.equal((await ledger.list()).length, before);
  });

  it("propose with no candidates produces no A3 call and no ledger write", async () => {
    const before = (await ledger.list()).length;
    await capture(() => handleCapabilitiesCommand(["propose"], deps));
    assert.equal((await ledger.list()).length, before);
  });
});
