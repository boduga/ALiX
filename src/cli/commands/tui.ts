import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { ApprovalManager } from "../../tui/approval-manager.js";
import { TuiApp } from "../../tui/app.js";
import { SnapshotBuilder } from "../../tui/snapshot-builder.js";
import { DaemonMetricsCollectorImpl, createPlatformMetricsReader } from "../../tui/daemon-metrics-collector.js";
import { PolicyEngine } from "../../policy/policy-engine.js";
import { SessionPhase } from "../../tui/state.js";
import { handlePolicyCommand } from "../../tui/helpers/policy-commands.js";
export type { PolicyConfig } from "../../tui/helpers/policy-commands.js";
export { handlePolicyCommand } from "../../tui/helpers/policy-commands.js";

export interface TuiOptions {
  sessionName?: string;
  sessionMode?: "auto" | "ask" | "bypass";
  daemonMode?: boolean;
}

export async function runTui(opts: TuiOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const sessionId = opts.sessionName ?? `tui-${Date.now()}`;
  const sessionDir = join(cwd, '.alix', 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  const eventLog = new EventLog(sessionDir);
  await eventLog.init();

  const approvals = new ApprovalManager({
    listPendingApprovals: async () => [],
    resolveApproval: async (id, status) => ({ success: false, message: `No approval store` }),
  });

  const policy = new PolicyEngine(config);
  const daemonMetrics = new DaemonMetricsCollectorImpl(createPlatformMetricsReader());

  const agentSession = {
    getMode: () => opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
    getPhase: () => SessionPhase.Idle,
    getVersion: () => 'unknown',
    getStartedAt: () => Date.now(),
    getTurns: () => 0,
  } as any;

  const builder = new SnapshotBuilder(
    agentSession, approvals, policy, null as unknown, eventLog, daemonMetrics,
  );

  const app = new TuiApp({ builder, daemonMetrics });

  let resolveStop: () => void;
  const exited = new Promise<void>((resolve) => { resolveStop = resolve; });
  const origStop = app.stop.bind(app);
  app.stop = async () => { await origStop(); resolveStop(); };

  try {
    await app.start();
    await exited;
  } catch (err) {
    await app.stop();
    throw err;
  }
}
