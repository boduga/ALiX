// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  saveMessages, loadMessages, countSavedMessages,
  saveScope, loadScope,
  saveState, loadState,
  sessionLedgerStatus, resetSessionLedgerStatus,
} from "../../src/session/persist.js";
import { reconcileSessionLedger } from "../../src/session/session-ledger-reconcile.js";
import { getSharedLedger, closeSharedLedger, runtimeLedgerPath } from "../../src/runtime-state/storage/runtime-ledger.js";
import type { NormalizedMessage } from "../../src/models/providers/types.js";
import type { ScopeSnapshot } from "../../src/planning/autonomy/scope-tracker.js";
import type { StateSnapshot } from "../../src/planning/autonomy/state-machine.js";

const dirs: string[] = [];

function fixture(): { root: string; sessionDir: string; sessionId: string } {
  const root = mkdtempSync(join(tmpdir(), "session-ledger-"));
  dirs.push(root);
  resetSessionLedgerStatus(root);
  const sessionId = "sess-abc";
  const sessionDir = join(root, ".alix", "sessions", sessionId);
  mkdirSync(sessionDir, { recursive: true });
  return { root, sessionDir, sessionId };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try { closeSharedLedger(dir); } catch { /* ignore */ }
    resetSessionLedgerStatus(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

function msg(content: string): NormalizedMessage {
  return { role: "user", content } as unknown as NormalizedMessage;
}

describe("session persistence ledger authority (R2.18)", () => {
  it("saveMessages appends facts first; load merges authority + legacy lines", async () => {
    const { root, sessionDir } = fixture();

    assert.equal(await saveMessages(sessionDir, [msg("a"), msg("b")], 0), 2);
    const ledger = getSharedLedger(root);
    assert.equal(ledger.entityVersion("sess-abc#msg-0"), 1);
    assert.equal(ledger.entityVersion("sess-abc#msg-1"), 1);
    assert.equal(sessionLedgerStatus(root).failures, 0);

    const loaded = await loadMessages(sessionDir);
    assert.equal(loaded.length, 2);
    assert.equal((loaded[0] as { content: string }).content, "a");

    // Legacy line (no facts) merges by index; ledger wins on overlap.
    const filePath = join(sessionDir, "messages.jsonl");
    const legacy = { role: "assistant", content: "legacy-0" };
    writeFileSync(filePath, JSON.stringify(legacy) + "\n");
    const merged = await loadMessages(sessionDir);
    assert.equal(merged.length, 2);
    assert.equal((merged[0] as { content: string }).content, "a"); // ledger wins
    assert.equal((merged[1] as { content: string }).content, "b");

    assert.equal(await countSavedMessages(sessionDir), 2);
  });

  it("append failure fails saveMessages — no JSON-only state", async () => {
    const { root, sessionDir } = fixture();
    closeSharedLedger(root);
    mkdirSync(runtimeLedgerPath(root), { recursive: true });

    await assert.rejects(() => saveMessages(sessionDir, [msg("x")], 0), /SQLITE|unable|not a database|session ledger append failed/i);
    assert.equal(sessionLedgerStatus(root).failures >= 1, true);
    assert.ok(!existsSync(join(sessionDir, "messages.jsonl")));

    rmSync(runtimeLedgerPath(root), { recursive: true, force: true });
  });

  it("scope + state: facts first, load prefers ledger over tampered files", async () => {
    const { root, sessionDir } = fixture();
    const scope = { allowed: ["src/**"], denied: [] } as unknown as ScopeSnapshot;
    await saveScope(sessionDir, scope);
    const state = { phase: "executing", turns: 3 } as unknown as StateSnapshot;
    await saveState(sessionDir, state);

    assert.equal(getSharedLedger(root).entityVersion("scope:sess-abc"), 1);
    assert.equal(getSharedLedger(root).entityVersion("state:sess-abc"), 1);

    // Tamper both files.
    writeFileSync(join(sessionDir, "scope.json"), JSON.stringify({ allowed: ["*"], denied: [] }));
    writeFileSync(join(sessionDir, "state.json"), JSON.stringify({ phase: "done", turns: 99 }));

    const scopeLoaded = await loadScope(sessionDir);
    assert.deepEqual((scopeLoaded as unknown as { allowed: string[] }).allowed, ["src/**"]);
    const stateLoaded = await loadState(sessionDir);
    assert.equal((stateLoaded as unknown as { turns: number }).turns, 3);
  });

  it("append failure fails saveScope/saveState — no JSON-only state", async () => {
    const { root, sessionDir } = fixture();
    closeSharedLedger(root);
    mkdirSync(runtimeLedgerPath(root), { recursive: true });

    await assert.rejects(() => saveScope(sessionDir, {} as ScopeSnapshot), /SQLITE|unable|not a database/i);
    await assert.rejects(() => saveState(sessionDir, {} as StateSnapshot), /SQLITE|unable|not a database/i);
    assert.ok(!existsSync(join(sessionDir, "scope.json")));
    assert.ok(!existsSync(join(sessionDir, "state.json")));

    rmSync(runtimeLedgerPath(root), { recursive: true, force: true });
  });

  it("projection write failure is tolerated and counted", async () => {
    const { root, sessionDir } = fixture();
    // Occupy scope.json with a DIRECTORY so writeFile fails.
    mkdirSync(join(sessionDir, "scope.json"), { recursive: true });
    await saveScope(sessionDir, { allowed: [] } as unknown as ScopeSnapshot); // must NOT throw
    assert.equal(sessionLedgerStatus(root).projectionFailures, 1);
    assert.equal(getSharedLedger(root).entityVersion("scope:sess-abc"), 1);
  });

  it("reconcile: clean after saves; legacy + tampered drift reported", async () => {
    const { root, sessionDir } = fixture();

    // Fresh (no artifacts) → clean.
    let report = await reconcileSessionLedger(root);
    assert.equal(report.ok, true, JSON.stringify(report.issues));

    await saveMessages(sessionDir, [msg("a")], 0);
    await saveScope(sessionDir, { allowed: [] } as unknown as ScopeSnapshot);
    await saveState(sessionDir, { phase: "idle" } as unknown as StateSnapshot);
    report = await reconcileSessionLedger(root);
    assert.equal(report.issues.length, 0, JSON.stringify(report.issues));
    assert.equal(report.ok, true);
    assert.deepEqual(report.unknownEventTypes, {});
    assert.equal(report.truncated, false);

    // Tampered state.json → record_mismatch.
    writeFileSync(join(sessionDir, "state.json"), JSON.stringify({ phase: "hacked" }));
    report = await reconcileSessionLedger(root);
    assert.ok(report.issues.some(i => i.kind === "record_mismatch" && i.detail.includes("state.json")), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });

  it("reconcile: legacy session files reported missing_in_ledger", async () => {
    const { root, sessionDir } = fixture();
    writeFileSync(join(sessionDir, "messages.jsonl"), JSON.stringify(msg("legacy")) + "\n");
    writeFileSync(join(sessionDir, "scope.json"), JSON.stringify({ allowed: [] }));

    const report = await reconcileSessionLedger(root);
    const kinds = report.issues.map(i => i.kind);
    assert.ok(kinds.includes("missing_in_ledger"), JSON.stringify(report.issues));
    assert.equal(report.ok, false);
  });
});
