import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScheduledTaskStore } from "../../src/schedule/scheduled-task-store.js";

let dir: string;
let store: ScheduledTaskStore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sched-store-"));
  store = new ScheduledTaskStore(join(dir, "scheduled-tasks.json"));
  await store.load();
});

afterEach(async () => {
  await store.flush();
  rmSync(dir, { recursive: true, force: true });
});

const base = {
  name: "nightly-report",
  task: "summarize yesterday's failures",
  cwd: "/srv/repo",
  schedule: { kind: "daily" as const, time: "02:30" },
  status: "active" as const,
  approvalId: "apr-1",
  expiresAt: "2026-10-19T23:59:59.000Z",
  nextRunAt: "2026-09-20T08:30:00.000Z",
};

describe("ScheduledTaskStore", () => {
  it("creates, persists, and reloads records", async () => {
    const created = store.create(base);
    expect(created.id).toMatch(/^sched_/);
    expect(created.runCount).toBe(0);
    await store.flush();

    const reloaded = new ScheduledTaskStore(join(dir, "scheduled-tasks.json"));
    await reloaded.load();
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.findByName("nightly-report")?.task).toBe(base.task);
  });

  it("updates and removes", async () => {
    const created = store.create(base);
    store.update(created.id, { runCount: 3, lastRunAt: "2026-09-20T08:30:01.000Z" });
    expect(store.get(created.id)?.runCount).toBe(3);
    expect(store.remove(created.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it("returns only active, due jobs", () => {
    const now = new Date("2026-09-20T09:00:00.000Z");
    const due = store.create({ ...base, name: "due", nextRunAt: "2026-09-20T08:30:00.000Z" });
    store.create({ ...base, name: "later", nextRunAt: "2026-09-21T08:30:00.000Z" });
    store.create({ ...base, name: "paused", status: "disabled", nextRunAt: "2026-09-20T08:00:00.000Z" });
    const got = store.due(now).map((t) => t.name);
    expect(got).toEqual(["due"]);
    expect(store.get(due.id)?.status).toBe("active");
  });
});
