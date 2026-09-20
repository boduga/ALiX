import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScheduledTaskStore } from "../../src/schedule/scheduled-task-store.js";
import { ScheduledTaskService } from "../../src/schedule/scheduled-task-service.js";
import { proposeSchedule, SCHEDULE_CAPABILITY, proposalFingerprint } from "../../src/schedule/propose.js";
import { MAX_ACTIVE_JOBS } from "../../src/schedule/schedule-spec.js";
import type { ApprovalStore } from "../../src/approvals/approval-store.js";
import type { ApprovalRecord } from "../../src/approvals/approval-types.js";

let dir: string;
let store: ScheduledTaskStore;
let enqueued: Array<{ task: string; cwd: string }>;

const NOW = new Date(2026, 8, 19, 12, 0, 0); // Sat 2026-09-19 12:00 local

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sched-svc-"));
  store = new ScheduledTaskStore(join(dir, "scheduled-tasks.json"));
  await store.load();
  enqueued = [];
});

afterEach(async () => {
  await store.flush();
  rmSync(dir, { recursive: true, force: true });
});

const proposal = {
  name: "nightly-report",
  task: "summarize failures",
  cwd: "/srv/repo",
  schedule: { kind: "daily" as const, time: "02:30" },
  expires: "2026-10-10",
};

function approved(overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: "apr-1",
    schemaVersion: "2.0",
    status: "approved",
    usePolicy: "single_use",
    bindingKey: "schedule:nightly-report",
    requestFingerprint: proposalFingerprint(proposal),
    policyRevision: "schedule-v1",
    capabilities: [SCHEDULE_CAPABILITY],
    ownershipClaims: [],
    reason: "test",
    createdAt: NOW.toISOString(),
    expiresAt: "2026-10-10T23:59:59.000Z",
    metadata: { scheduleProposal: proposal },
    ...overrides,
  } as ApprovalRecord;
}

function fakeApprovals(records: ApprovalRecord[]): ApprovalStore {
  return { list: () => records } as unknown as ApprovalStore;
}

function service(records: ApprovalRecord[]): ScheduledTaskService {
  return new ScheduledTaskService({
    approvals: fakeApprovals(records),
    tasks: store,
    enqueue: (task, cwd) => enqueued.push({ task, cwd }),
    now: () => NOW,
  });
}

describe("proposeSchedule", () => {
  it("creates a pending approval and schedules nothing", async () => {
    const calls: unknown[] = [];
    const approvals = {
      requestBound: async (input: unknown) => {
        calls.push(input);
        return { id: "approval_1" };
      },
    } as unknown as ApprovalStore;

    const out = await proposeSchedule(proposal, { approvals, sessionId: "ses-1" });
    expect(out).toEqual({ ok: true, approvalId: "approval_1", description: "daily at 02:30" });
    const input = calls[0] as Record<string, unknown>;
    expect(input.bindingKey).toBe("schedule:nightly-report");
    expect(input.capabilities).toEqual([SCHEDULE_CAPABILITY]);
    expect(input.metadata).toEqual({ scheduleProposal: proposal });
    expect(store.list()).toHaveLength(0);
  });

  it("rejects bad proposals before touching the store", async () => {
    const approvals = { requestBound: async () => ({ id: "x" }) } as unknown as ApprovalStore;
    expect((await proposeSchedule({ ...proposal, name: "Bad Name" }, { approvals })).ok).toBe(false);
    expect((await proposeSchedule({ ...proposal, cwd: "relative/path" }, { approvals })).ok).toBe(false);
    expect((await proposeSchedule({ ...proposal, expires: "2000-01-01" }, { approvals })).ok).toBe(false);
    expect((await proposeSchedule({ ...proposal, schedule: { kind: "every", minutes: 1 } }, { approvals })).ok).toBe(false);
  });
});

describe("ScheduledTaskService", () => {
  it("materializes an approved proposal into one active job, idempotently", async () => {
    const svc = service([approved()]);
    const first = await svc.materializeApproved();
    expect(first.created).toEqual(["nightly-report"]);
    const second = await svc.materializeApproved();
    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(["apr-1"]);
    expect(store.list()).toHaveLength(1);
    expect(store.findByName("nightly-report")?.status).toBe("active");
  });

  it("ignores pending/denied approvals and non-schedule capabilities", async () => {
    const svc = service([
      approved({ id: "pending-1", status: "pending" }),
      approved({ id: "other-1", capabilities: ["file.create"] }),
      approved({ id: "bad-meta-1", metadata: {} }),
    ]);
    expect((await svc.materializeApproved()).created).toEqual([]);
    expect(store.list()).toHaveLength(0);
  });

  it("enqueues due jobs, advances nextRun, and expires overdue", async () => {
    store.create({
      name: "due", task: "t", cwd: "/srv/repo", status: "active", approvalId: "a1",
      schedule: { kind: "daily", time: "02:30" }, expiresAt: "2026-10-10T23:59:59",
      nextRunAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    store.create({
      name: "future", task: "t", cwd: "/srv/repo", status: "active", approvalId: "a2",
      schedule: { kind: "daily", time: "02:30" }, expiresAt: "2026-10-10T23:59:59",
      nextRunAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
    });
    store.create({
      name: "stale", task: "t", cwd: "/srv/repo", status: "active", approvalId: "a3",
      schedule: { kind: "daily", time: "02:30" }, expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
      nextRunAt: new Date(NOW.getTime() - 1000).toISOString(),
    });

    const tick = await service([]).tick();
    expect(tick.enqueued).toEqual(["due"]);
    expect(tick.expired).toEqual(["stale"]);
    expect(enqueued).toEqual([{ task: "t", cwd: "/srv/repo" }]);
    expect(store.findByName("stale")?.status).toBe("expired");
    expect(store.findByName("due")?.runCount).toBe(1);
    expect(Date.parse(store.findByName("due")!.nextRunAt)).toBeGreaterThan(NOW.getTime());
  });

  it("refuses to materialize beyond the active-job cap", async () => {
    for (let i = 0; i < MAX_ACTIVE_JOBS; i++) {
      store.create({
        name: `job-${i}`, task: "t", cwd: "/srv/repo", status: "active", approvalId: `a${i}`,
        schedule: { kind: "daily", time: "02:30" }, expiresAt: "2026-10-10T23:59:59",
        nextRunAt: NOW.toISOString(),
      });
    }
    const out = await service([approved({ id: "apr-over" })]).materializeApproved();
    expect(out.created).toEqual([]);
    expect(out.skipped).toEqual(["apr-over"]);
  });
});
