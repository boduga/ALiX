import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { ApprovalManager } from "../../tui/approval-manager.js";
import { TuiApp } from "../../tui/app.js";
import { SnapshotBuilder } from "../../tui/snapshot-builder.js";
import { DaemonMetricsCollectorImpl, createPlatformMetricsReader } from "../../tui/daemon-metrics-collector.js";
import { RuntimeCollectorImpl } from "../../tui/runtime-collector.js";
import { SopCollectorImpl } from "../../tui/sop-collector.js";
import { PolicyEngine } from "../../policy/policy-engine.js";
import { SessionPhase } from "../../tui/state.js";
import { handlePolicyCommand } from "../../tui/helpers/policy-commands.js";
import { createAgentSession } from "../../agent/session.js";
import { webSearchTool } from "../../tools/web-search.js";
export type { PolicyConfig } from "../../tui/helpers/policy-commands.js";
export { handlePolicyCommand } from "../../tui/helpers/policy-commands.js";

export interface TuiOptions {
  sessionName?: string;
  sessionMode?: "auto" | "ask" | "bypass";
  daemonMode?: boolean;
}

/**
 * By default the TUI runs the real `createAgentSession` runtime so
 * chat-tab submits go through the lightweight `processChat` path
 * (real LLM text-in/text-out, no tool loop) when a model is configured.
 *
 * Set `ALIX_TUI_STUB_AGENT=1` to fall back to the legacy echo stub —
 * useful for offline smoke tests and CI environments where the model
 * runtime can't initialize.
 */
function shouldUseStubAgent(): boolean {
  return process.env.ALIX_TUI_STUB_AGENT === '1';
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
  const runtimeCollector = new RuntimeCollectorImpl(eventLog);
  const sopCollector = new SopCollectorImpl();

  // Either the real `createAgentSession` runtime (default) or the
  // legacy echo stub (opt-in via ALIX_TUI_STUB_AGENT=1). The real
  // session wires both processChat (lightweight, no tools) and
  // processTurn (full workflow loop). If loadConfig didn't find a
  // model, chatModel stays undefined and processChat falls back to a
  // clear `[chat:no-provider]` placeholder.
  let agentSession: any;
  if (shouldUseStubAgent()) {
    agentSession = {
      getMode: () => opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
      getPhase: () => SessionPhase.Idle,
      getVersion: () => 'unknown',
      getStartedAt: () => Date.now(),
      getTurns: () => 0,
      processTurn: async (message: string) => ({
        summary: `[agent] ${message}`,
        sessionId: 'stub',
        toolCalls: [],
        reason: 'stub-agent',
      }),
      processChat: async (message: string) => ({
        summary: `[chat] ${message}`,
        sessionId: 'stub',
        toolCalls: [],
        reason: 'stub-chat',
      }),
    };
  } else {
    const configuredModel = (config as { model?: { provider?: string; name?: string } } | undefined)?.model;
    const braveSearch = webSearchTool();
    const chatSearchTool = async (query: string): Promise<string> => {
      // Brave Search is opt-in via BRAVE_API_KEY. When unset, return ''
      // so the chat path gracefully degrades (still gets the model's
      // training-data answer, no search context).
      if (!process.env.BRAVE_API_KEY) return '';
      const result = await braveSearch.execute({ query, count: 5 });
      if (!result.ok || !result.data) return '';
      return result.data.results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   ${r.url}`)
        .join('\n');
    };

    agentSession = createAgentSession({
      cwd,
      task: '',                                  // filled on first processTurn
      sessionId,
      sessionMode: opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
      ...(opts.daemonMode === false ? {} : {}),  // daemon toggle reserved for follow-up
      ...(configuredModel?.provider
        ? { chatModel: { provider: configuredModel.provider, model: configuredModel.name } }
        : {}),
      chatSearchTool,
    });
  }

  const builder = new SnapshotBuilder(
    agentSession, approvals, policy, sopCollector, runtimeCollector, daemonMetrics,
  );

  const app = new TuiApp({ builder, daemonMetrics, agentSession });

  runtimeCollector.start();
  sopCollector.start();

  try {
    await app.start();
    await app.run();
  } catch (err) {
    await app.stop();
    throw err;
  } finally {
    runtimeCollector.stop();
    sopCollector.stop();
  }
}
