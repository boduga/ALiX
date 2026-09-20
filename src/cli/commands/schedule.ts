/**
 * schedule.ts — CLI for approved scheduled jobs.
 *
 *   alix schedule list             List active scheduled jobs
 *   alix schedule show <name>      Show one job (schedule, next run, expiry)
 *   alix schedule run-now <name>   Enqueue one run immediately
 *   alix schedule revoke <name>    Remove a job
 *
 * Proposals are reviewed/approved in `alix approvals` (the one inbox); this
 * command manages jobs that are already approved and active.
 */

import { ScheduledTaskStore } from "../../schedule/scheduled-task-store.js";
import { describeSchedule } from "../../schedule/schedule-spec.js";
import { TaskRegistry } from "../../daemon/task-registry.js";

export async function handleSchedule(args: string[]): Promise<void> {
  const sub = args[0];
  const store = new ScheduledTaskStore();
  await store.load();

  switch (sub) {
    case "list": {
      const jobs = store.list();
      if (jobs.length === 0) {
        console.log("No scheduled jobs. Propose one with the schedule.propose tool, then approve it in `alix approvals`.");
        return;
      }
      for (const j of jobs) {
        console.log(
          `${j.name.padEnd(24)} ${j.status.padEnd(9)} ${describeSchedule(j.schedule).padEnd(22)} next=${j.nextRunAt} runs=${j.runCount} expires=${j.expiresAt.slice(0, 10)}`,
        );
      }
      return;
    }
    case "show": {
      const name = args[1];
      if (!name) { console.error("Usage: alix schedule show <name>"); process.exit(1); }
      const job = store.findByName(name);
      if (!job) { console.error(`No scheduled job named '${name}'.`); process.exit(1); }
      console.log(JSON.stringify(job, null, 2));
      return;
    }
    case "run-now": {
      const name = args[1];
      if (!name) { console.error("Usage: alix schedule run-now <name>"); process.exit(1); }
      const job = store.findByName(name);
      if (!job) { console.error(`No scheduled job named '${name}'.`); process.exit(1); }
      const registry = new TaskRegistry();
      await registry.load();
      const record = registry.create(job.task, job.cwd);
      await registry.flush();
      store.update(job.id, { lastRunAt: new Date().toISOString(), runCount: job.runCount + 1 });
      await store.flush();
      console.log(`Queued one run of '${name}' (task ${record.id}).`);
      return;
    }
    case "revoke": {
      const name = args[1];
      if (!name) { console.error("Usage: alix schedule revoke <name>"); process.exit(1); }
      const job = store.findByName(name);
      if (!job) { console.error(`No scheduled job named '${name}'.`); process.exit(1); }
      store.remove(job.id);
      await store.flush();
      console.log(`Revoked scheduled job '${name}'.`);
      return;
    }
    default:
      console.error("Usage: alix schedule <list|show|run-now|revoke> [name]");
      process.exit(1);
  }
}
