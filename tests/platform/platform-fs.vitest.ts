/**
 * platform-fs.vitest.ts — platform-sensitive filesystem coverage (#693).
 *
 * Proves the macOS/Windows CI lanes execute tests (not just build):
 * exercises per-OS filesystem semantics the runtime depends on —
 * exclusive file creation, concurrent appends with unique sequences,
 * and platform-native path handling in tmpdir-backed stores.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform, EOL } from "node:os";
import { EventLog } from "../../src/events/event-log.js";
import { ApprovalStore } from "../../src/approvals/approval-store.js";

describe("platform filesystem semantics", () => {
  it(`runs on this platform (${platform()}) with native line endings`, () => {
    // Lane proof: these assertions can only pass where the suite executes,
    // and they pin the platform facts the runtime relies on.
    expect(["darwin", "linux", "win32"]).toContain(platform());
    expect(EOL).toBe(platform() === "win32" ? "\r\n" : "\n");
  });

  it("exclusive file creation is atomic (wx fails when present)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "platform-wx-"));
    try {
      const { open, writeFile } = await import("node:fs/promises");
      const p = join(dir, "lock");
      const fd = await open(p, "wx", 0o600);
      await fd.writeFile("{}");
      await fd.close();
      await expect(writeFile(p, "{}", { flag: "wx" } as never)).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("concurrent EventLog appends keep unique seqs on this OS", async () => {
    const dir = mkdtempSync(join(tmpdir(), "platform-evlog-"));
    try {
      const log = new EventLog(dir);
      await log.init();
      const events = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          log.append({ sessionId: `s${i}`, type: "test.event", actor: "system", payload: {} }),
        ),
      );
      const seqs = events.map((e) => e.seq);
      expect(new Set(seqs).size).toBe(seqs.length);
      expect(await log.readAll()).toHaveLength(10);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ApprovalStore round-trips through platform tmpdir paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "platform-approvals-"));
    try {
      const store = new ApprovalStore(dir);
      await store.load();
      const record = await store.request({ reason: "platform test" });
      expect(record.status).toBe("pending");
      const fresh = new ApprovalStore(dir);
      await fresh.load();
      expect(fresh.get(record.id)?.reason).toBe("platform test");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
