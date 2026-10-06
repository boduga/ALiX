import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluatePattern } from "../../src/run/task-loop/context-helpers.js";

type SessionInfo = { sessionId: string; actor: "system" };

function fakeLog() {
  const appended: Array<{ type: string }> = [];
  return {
    appended,
    log: { append: async (e: { type: string }) => { appended.push(e); } } as never,
  };
}

describe("evaluatePattern pattern-store path", () => {
  it("writes outcomes to <root>/.alix/patterns, never inside the sessions directory", async () => {
    const root = mkdtempSync(join(tmpdir(), "alix-pattern-path-"));
    const sessionDir = join(root, ".alix", "sessions", "sess-1");
    const { log, appended } = fakeLog();

    await evaluatePattern(log, { sessionId: "sess-1", actor: "system" } satisfies SessionInfo, sessionDir, "unknown");

    assert.ok(
      existsSync(join(root, ".alix", "patterns", "stats.json")),
      "expected pattern stats at <root>/.alix/patterns/stats.json",
    );
    assert.ok(
      !existsSync(join(root, ".alix", "sessions", ".alix")),
      "must not nest a second .alix tree inside the sessions directory",
    );
    assert.equal(appended.length, 1, "outcome event must still be appended");
    assert.equal(appended[0]!.type, "context.pattern_evaluated");
  });

  it("skips the pattern write when sessionDir is not <root>/.alix/sessions/<id>", async () => {
    const root = mkdtempSync(join(tmpdir(), "alix-pattern-nocanonical-"));
    const { log, appended } = fakeLog();

    await evaluatePattern(log, { sessionId: "s", actor: "system" } satisfies SessionInfo, join(root, "plain"), "unknown");

    assert.ok(!existsSync(join(root, ".alix")), "no pattern store may be created for an unrecognised sessionDir");
    assert.equal(appended.length, 1, "outcome event is independent of the pattern write");
  });
});
