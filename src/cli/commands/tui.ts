import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EventLog } from "../../events/event-log.js";
import { loadConfig } from "../../config/loader.js";
import { ApprovalManager } from "../../tui/approval-manager.js";
import { TuiApp } from "../../tui/app.js";
import { SnapshotBuilder } from "../../tui/snapshot-builder.js";
import { DaemonMetricsCollectorImpl, createPlatformMetricsReader } from "../../tui/daemon-metrics-collector.js";
import { PolicyEngine } from "../../policy/policy-engine.js";

export interface TuiOptions {
  sessionName?: string;
  sessionMode?: "auto" | "ask" | "bypass";
  daemonMode?: boolean;
}

export interface PolicyConfig {
  permissions?: { sessionMode?: string };
}

/**
 * Pure helper for /policy command. Takes the current config and args,
 * mutates config if switching modes, returns display lines.
 * No side effects — no I/O, no TUI output.
 */
export function handlePolicyCommand(
  config: PolicyConfig,
  args: string,
): string[] {
  config.permissions ??= {};
  const currentMode = config.permissions.sessionMode || "bypass";
  const lines: string[] = [];
  const trimmed = args.trim().toLowerCase();

  if (trimmed === "bypass") {
    config.permissions.sessionMode = "bypass";
    lines.push("Session mode changed to: bypass");
    lines.push("  All tools allowed without approval.");
  } else if (trimmed === "ask") {
    config.permissions.sessionMode = "ask";
    lines.push("Session mode changed to: ask");
    lines.push("  Tool approval will be requested when policy requires it.");
  } else if (trimmed === "auto") {
    config.permissions.sessionMode = "auto";
    lines.push("Session mode changed to: auto");
    lines.push("  Previously approved tools allowed automatically.");
  } else if (trimmed === "" || trimmed === "show" || trimmed === "status") {
    const icon = currentMode === "bypass" ? "⚠" : currentMode === "ask" ? "✓" : "●";
    lines.push(`Policy session mode: ${icon} ${currentMode}`);
    lines.push("  Change with: /policy ask | /policy bypass | /policy auto");
    if (currentMode === "ask") {
      lines.push("  Commands requiring approval will prompt inline.");
    } else if (currentMode === "bypass") {
      lines.push("  All tool calls allowed — use with caution.");
    } else if (currentMode === "auto") {
      lines.push("  Previously approved capabilities auto-allowed.");
    }
  } else {
    lines.push("Unknown policy command. Usage:");
    lines.push("  /policy          — show current mode");
    lines.push("  /policy ask      — require approval for risky tools");
    lines.push("  /policy bypass   — allow all tools without approval");
    lines.push("  /policy auto     — auto-allow previously approved tools");
  }

  return lines;
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
    getPhase: () => null,
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
