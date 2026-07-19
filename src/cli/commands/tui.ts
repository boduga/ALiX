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
import { createAgentSession } from "../../agent/session.js";
export type { PolicyConfig } from "../../tui/helpers/policy-commands.js";
export { handlePolicyCommand } from "../../tui/helpers/policy-commands.js";

export interface TuiOptions {
  sessionName?: string;
  sessionMode?: "auto" | "ask" | "bypass";
  daemonMode?: boolean;
}

/**
 * By default the TUI uses a stub `agentSession` that responds with a
 * fixed echo — the real `createAgentSession().processTurn()` does not
 * yet handle non-actionable inputs (e.g. a "Hi" greeting) gracefully
 * and reports 'Agent reached maximum iteration' back to the chat.
 *
 * Set `ALIX_TUI_REAL_AGENT=1` to opt into the real AgentSession for
 * actionable queries. The wire-up stays in place so a future runtime
 * that handles casual chat can be enabled with that one env var.
 */
function shouldUseStubAgent(): boolean {
  if (process.env.ALIX_TUI_REAL_AGENT === '1') return false;
  return true;
}

export async function runTui(opts: TuiOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const sessionId = opts.sessionName ?? `tui-${Date.now()}`;
  const sessionDir = join(cwd, '.alix', 'sessions', sessionId);
  await mkdir(sessionDir, { recursive: true });

  // The TUI dashboard doesn't need a configured model — it renders panel
  // content from snapshot data.  loadConfig may throw if no model is
  // configured (e.g. CI, fresh install); fall back to defaults.
  let config: Record<string, any>;
  try {
    config = await loadConfig(cwd);
  } catch {
    config = { permissions: { sessionMode: 'auto' } };
  }
  const eventLog = new EventLog(sessionDir);
  await eventLog.init();

  const approvals = new ApprovalManager({
    listPendingApprovals: async () => [],
    resolveApproval: async (id, status) => ({ success: false, message: `No approval store` }),
  });

  const policy = new PolicyEngine(config as any);
  const daemonMetrics = new DaemonMetricsCollectorImpl(createPlatformMetricsReader());

  // Either a real AgentSession runtime (opt-in via env), or the stub
  // echo. The real session is created here (a sync closure factory)
  // and initializes lazily on first processTurn. If init throws later,
  // the TuiApp's submitChatInput catches it and surfaces the error in
  // the chat scrollback.
  let agentSession: any;
  if (shouldUseStubAgent()) {
    agentSession = {
      getMode: () => opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
      getPhase: () => SessionPhase.Idle,
      getVersion: () => 'unknown',
      getStartedAt: () => Date.now(),
      getTurns: () => 0,
      processTurn: async (message: string) => ({
        summary: `Acknowledged: ${message}. (Stub: wire a real AgentSession to produce a runtime response.)`,
        sessionId: 'stub',
        toolCalls: [],
        reason: 'stub-agent',
      }),
    };
  } else {
    agentSession = createAgentSession({
      cwd,
      task: '',                                  // filled on first processTurn
      sessionId,
      sessionMode: opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
      ...(opts.daemonMode === false ? {} : {}),  // daemon toggle reserved for follow-up
    });
  }

  const builder = new SnapshotBuilder(
    agentSession, approvals, policy, null as unknown, eventLog, daemonMetrics,
  );

  const app = new TuiApp({ builder, daemonMetrics, agentSession });

  try {
    await app.start();
    await app.run();
  } catch (err) {
    await app.stop();
    throw err;
  }
}
