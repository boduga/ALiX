import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { ApprovalManager } from "../../tui/approval-manager.js";
import { ApprovalStore } from "../../approvals/approval-store.js";
import { TuiApp } from "../../tui/app.js";
import { SnapshotBuilder } from "../../tui/snapshot-builder.js";
import { DaemonMetricsCollectorImpl, createPlatformMetricsReader } from "../../tui/daemon-metrics-collector.js";
import { RuntimeCollectorImpl } from "../../tui/runtime-collector.js";
import { FileProjectionCheckpointStore } from "../../tui/runtime/projection-checkpoint-store.js";
import { TimelineBuilder } from "../../tui/runtime/timeline-builder.js";
import { IncrementalExecutionTraceBuilder } from "../../tui/runtime/execution-trace-builder.js";
import { ApprovalProjection } from "../../tui/runtime/approval-projection.js";
import { ApprovalProjectionCollector } from "../../tui/runtime/approval-projection-collector.js";
import { CapabilityProjection } from "../../tui/runtime/capability-projection.js";
import { MetricsProjection } from "../../tui/runtime/metrics-projection.js";
import { createProjectionRuntime } from "../../tui/runtime/projection-runtime.js";
import { ProjectionIds } from "../../tui/runtime/projection-ids.js";
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
  themeName?: string;
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
  const sessionId = opts.sessionName ?? `${Date.now()}`;
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

  const approvalStore = new ApprovalStore(cwd, { eventLog });
  await approvalStore.load();
  // Lazy session-ID closure: agentSession is assigned later but the
  // ApprovalManager deps are only called after startup, so by then
  // agentSession will be available. Filtering by sessionId keeps each
  // TUI session's approvals isolated from other sessions' stale state.
  const currentSessionId = () => {
    const id = agentSession?.getSessionId?.();
    return typeof id === 'string' && id.length > 0 ? id : '';
  };
  const approvals = new ApprovalManager({
    listPendingApprovals: async () => {
      const sid = currentSessionId();
      return approvalStore.listPending()
        .filter(r => !r.sessionId || r.sessionId === sid)
        .map(r => ({
          id: r.id,
          capabilities: r.capabilities,
          reason: r.reason,
          toolId: r.toolId,
          createdAt: r.createdAt,
        }));
    },
    resolveApproval: async (id, status) => {
      const result = await approvalStore.resolve(id, status);
      if (result) return { success: true, message: `Approval ${id} ${status}` };
      return { success: false, message: `Approval ${id} not found or already resolved` };
    },
  });

  const policy = new PolicyEngine(config as any);
  const daemonMetrics = new DaemonMetricsCollectorImpl(createPlatformMetricsReader());
  // Phase 6 Task 3 + regression fix (Task 3.5): THREE independent projections
  // over ONE EventLog — each owns its own in-memory cursor + durable
  // checkpoint.
  //   1. runtimeCollector — OUTER sessionId. Projects the execution trace:
  //      capability/tool/runtime events are stamped with the OUTER sessionId
  //      (ToolExecutor derives it from the EventLog sessionDir), so this
  //      collector sees them all. Feeds SnapshotBuilder's `runtime` arg →
  //      snapshot.runtime.trace (Phase 4 Runtime tab).
  //   2. chatCollector — `${sessionId}-chat` sub-session. Projects the chat
  //      timeline (TuiApp stamps chat-tab emits with chatSessionId).
  //   3. agentCollector — `${sessionId}-agent` sub-session. Projects the agent
  //      timeline (TuiApp stamps agent-tab emits with agentSessionId).
  //
  // Each collector gets its OWN checkpoint store (own file under
  // `projections/<role>/`). Sharing a single store file across the three is NOT
  // safe: the first collector's startup sample advances the log-global
  // watermark, and a later-starting collector would recover PAST events it
  // never consumed (missed timeline/trace on resume, or when events exist
  // before the collectors start). Separate stores keep each recovery
  // independent.
  const chatSessionId = `${sessionId}-chat`;
  const agentSessionId = `${sessionId}-agent`;
  const runtimeCheckpointStore = new FileProjectionCheckpointStore(join(sessionDir, 'projections', 'runtime'));
  const chatCheckpointStore = new FileProjectionCheckpointStore(join(sessionDir, 'projections', 'chat'));
  const agentCheckpointStore = new FileProjectionCheckpointStore(join(sessionDir, 'projections', 'agent'));
  // The OUTER (runtime) collector projects the execution TRACE only — the
  // Runtime tab reads snapshot.runtime.trace (Phase 4). No view consumes its
  // timeline, so the composition root registers trace only (no timeline
  // projection) — the collector itself is blind to projection identity.
  const runtimeProjectionRuntime = createProjectionRuntime([
    [ProjectionIds.trace, new IncrementalExecutionTraceBuilder()],
    [ProjectionIds.approval, new ApprovalProjection()],
    [ProjectionIds.capability, new CapabilityProjection()],
    [ProjectionIds.metrics, new MetricsProjection()],
  ]);
  const runtimeCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: runtimeCheckpointStore,
    sessionId,
    projectionRuntime: runtimeProjectionRuntime,
  });
  const chatCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: chatCheckpointStore,
    sessionId: chatSessionId,
    projectionRuntime: createProjectionRuntime([
      [ProjectionIds.timeline, new TimelineBuilder(chatSessionId)],
      [ProjectionIds.trace, new IncrementalExecutionTraceBuilder()],
    ]),
  });
  const agentCollector = new RuntimeCollectorImpl({
    eventLog,
    checkpointStore: agentCheckpointStore,
    sessionId: agentSessionId,
    projectionRuntime: createProjectionRuntime([
      [ProjectionIds.timeline, new TimelineBuilder(agentSessionId)],
      [ProjectionIds.trace, new IncrementalExecutionTraceBuilder()],
    ]),
  });
  const sopCollector = new SopCollectorImpl();

  // Either the real `createAgentSession` runtime (default) or the
  // legacy echo stub (opt-in via ALIX_TUI_STUB_AGENT=1). The real
  // session wires both processChat (lightweight, no tools) and
  // processTurn (full workflow loop). If loadConfig didn't find a
  // model, chatModel stays undefined and processChat falls back to a
  // clear `[chat:no-provider]` placeholder.
  let agentSession: any;
  // Live-streaming bridge: the session (constructed below, before the
  // TuiApp) fires events.onToken per streamed token; the sink forwards them
  // to the app once it exists. Wired at the bottom of this function.
  let onAgentToken: ((token: string) => void) | undefined;
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

    if (opts.daemonMode) {
      const { DaemonAgentSession } = await import("../../tui/daemon-client.js");
      agentSession = new DaemonAgentSession(
        cwd,
        null,
        opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
      );
    } else {
      agentSession = createAgentSession({
        cwd,
        task: '',                                  // filled on first processTurn
        sessionId,
        sessionMode: opts.sessionMode ?? config.permissions?.sessionMode ?? 'auto',
        verbose: false,                            // suppress tool stdout from agent loop
        approvalStore,
        planApprovalMode: "deferred",              // TUI handles plan display/approval
        // Forward the resolved streaming flag so the chat/direct route can
        // stream tokens live (processTurn's direct-route branch runs BEFORE
        // initialize() builds ctx.config.model, so it can't read model.streaming
        // there; we resolve it here from the loaded config and pass it through).
        streaming: config.model?.streaming !== false,
        ...(configuredModel?.provider
          ? { chatModel: { provider: configuredModel.provider, model: configuredModel.name } }
          : {}),
        chatSearchTool,
        // Stream tokens live into the in-process TUI agent view (the daemon
        // path already streams via its own socket protocol). onToolCall /
        // onToolResult stay no-ops — the TUI consumes those via the EventLog
        // timeline, not these callbacks.
        events: {
          onToken: (token: string) => { onAgentToken?.(token); },
          onToolCall: () => {},
          onToolResult: () => {},
        },
      });
    }
  }

  // The OUTER-scoped runtime collector feeds SnapshotBuilder's `runtime` arg —
  // it projects capability/tool/runtime events (all stamped with the outer
  // sessionId), so snapshot.runtime.trace drives the Runtime tab (Phase 4).
  const builder = new SnapshotBuilder(
    agentSession, new ApprovalProjectionCollector(runtimeProjectionRuntime), policy, sopCollector, runtimeCollector, daemonMetrics,
    cwd,
  );

  // Capability Platform consumer wiring — in-process service owns the
  // platform; the bootstrap owns infrastructure construction (ToolExecutor
  // here); TuiApp binds the chat-timeline presenter (it owns the state).
  const { CapabilityService, setCapabilityService } = await import('../../tui/capabilities/capability-service.js');
  const { ToolExecutor } = await import('../../tools/executor.js');
  // config is deliberately Record<string, any> here (loadConfig may fall back
  // to a stub); ToolExecutor reads fields defensively, so a type-only cast at
  // this boundary is safe and matches other call sites' typed config.
  const toolExecutor = new ToolExecutor(config as import('../../config/schema.js').AlixConfig, eventLog, process.cwd());
  const capabilityService = new CapabilityService(undefined, {
    eventLog,
    sessionId: currentSessionId,
    actor: 'operator',
    cwd: process.cwd(),
    toolExecutor,
  });
  setCapabilityService(capabilityService);
  await capabilityService.ready();

  const app = new TuiApp({
    builder,
    daemonMetrics,
    agentSession,
    approvalManager: approvals,
    themeName: opts.themeName,
    capabilityService,
    eventLog,
    chatSessionId,
    agentSessionId,
    runtimeCollectors: { chat: chatCollector, agent: agentCollector },
  });

  // Point the streaming bridge at the now-constructed app: every streamed
  // token the session emits lands in the agent tab's growing pending line.
  onAgentToken = (token: string) => { app.appendAgentStreamToken(token); };

  await runtimeCollector.start();
  await chatCollector.start();
  await agentCollector.start();
  sopCollector.start();

  try {
    await app.start();
    await app.run();
  } catch (err) {
    await app.stop();
    throw err;
  } finally {
    runtimeCollector.stop();
    chatCollector.stop();
    agentCollector.stop();
    sopCollector.stop();
  }
}
