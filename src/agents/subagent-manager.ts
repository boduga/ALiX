import { spawn, type ChildProcess } from "child_process";
import { buildChildEnv } from "../runtime/child-env.js";
import { resolve } from "path";
import { fileURLToPath } from "url";
import type { SubagentRole, SubagentTask, SubagentResult, SubagentRoleConfig, AlixConfig, ModelTierConfig } from "../config/schema.js";
import { parseSessionMode } from "../config/schema.js";
import type { EventLog } from "../events/event-log.js";

// Re-export types for consumers
export type { SubagentTask, SubagentResult };

export type SubagentManagerOptions = {
  sessionId: string;
  /** Logical parent identity for Workbench hierarchy. Defaults to the session root. */
  parentAgentId?: string;
  config?: AlixConfig;
  /** Override the spawned command for testing. Defaults to the alix CLI. */
  spawnOverride?: { command: string; args?: string[] };
  /** Event log for emitting subagent lifecycle events into the session stream. */
  eventLog?: EventLog;
};

type RunningSubagent = {
  task: SubagentTask;
  process: ChildProcess;
  resolve: (result: SubagentResult) => void;
  reject: (err: Error) => void;
  cancelled: boolean;
};

export type SubagentResultCallback = (result: SubagentResult) => void;

/**
 * Presentation-only coordination correlation fields for lifecycle events.
 * The three always travel together (planner → task → roster drawer), so
 * they are gathered here rather than spread ad hoc at each emit site.
 */
export function coordinationPresentationMeta(task: SubagentTask): {
  coordinationRunId?: string;
  assignedAgentId?: string;
  taskLabel?: string;
} {
  return {
    ...(task.coordinationRunId ? { coordinationRunId: task.coordinationRunId } : {}),
    ...(task.assignedAgentId ? { assignedAgentId: task.assignedAgentId } : {}),
    ...(task.taskLabel ? { taskLabel: task.taskLabel } : {}),
  };
}

export class SubagentManager {
  private running = new Map<string, RunningSubagent>();
  private ownershipRegistry = new Map<string, string>(); // path -> subagentId
  private callbacks: SubagentResultCallback[] = [];

  constructor(private options: SubagentManagerOptions) {}

  onResult(cb: SubagentResultCallback): void {
    this.callbacks.push(cb);
  }

  /**
   * Spawn a subagent process. Throws if owned paths overlap with an active worker.
   */
  spawn(task: SubagentTask): Promise<SubagentResult> {
    return new Promise((resolvePromise, reject) => {
      if (task.mode === "write" && task.ownedPaths?.length) {
        for (const path of task.ownedPaths) {
          const owner = this.ownershipRegistry.get(path);
          if (owner && owner !== task.id) {
            reject(new Error(`Overlapping ownership: '${path}' is already owned by '${owner}'`));
            return;
          }
        }
        for (const path of task.ownedPaths) {
          this.ownershipRegistry.set(path, task.id);
        }
      }

      try {
        // Resolve the model before publishing the spawn so the roster never
        // shows a fabricated or guessed model identity.
        const { provider, name } = this.getRoleModel(task.role);
        const parentAgentId = this.options.parentAgentId ?? `session:${this.options.sessionId}`;
        const lifecycleBase = {
          agentId: task.id,
          parentAgentId,
          taskId: task.id,
          role: task.role,
          model: `${provider}/${name}`,
          ...coordinationPresentationMeta(task),
        };
        // Emit subagent.started event
        this.options.eventLog?.append({
          sessionId: this.options.sessionId,
          actor: "system",
          type: "subagent.started",
          payload: { role: task.role, taskId: task.id, prompt: task.prompt.slice(0, 200), ownedPaths: task.ownedPaths ?? [] },
        });
        this.emitLifecycle("agent.spawned", {
          ...lifecycleBase,
          state: "starting",
          operation: task.prompt.slice(0, 200),
          ownedPaths: task.ownedPaths ?? [],
        });
        this.emitLifecycle("agent.task_assigned", {
          ...lifecycleBase,
          title: task.taskLabel ?? task.prompt.slice(0, 200),
          prompt: task.prompt.slice(0, 200),
          ownedPaths: task.ownedPaths ?? [],
        });
        if (task.ownedPaths?.length) {
          this.emitLifecycle("agent.ownership_changed", { ...lifecycleBase, ownedPaths: task.ownedPaths });
        }

        // Build CLI args array
        const sessionMode = parseSessionMode(this.options.config?.permissions?.sessionMode);
        const cliArgs = [
          "run", "--subagent", task.role,
          "--task-id", task.id,
          "--prompt", task.prompt,
          "--mode", task.mode,
          "--session-id", task.contextBundle ?? `sub-${Date.now()}`,
          "--provider", provider,
          "--model", name,
          "--session-mode", sessionMode,
          ...(task.ownedPaths?.length ? ["--owned-paths", task.ownedPaths.join(",")] : []),
        ];

        // Use spawnOverride for testing, otherwise use alix CLI
        const spawnOverride = this.options.spawnOverride;
        let command: string;
        let commandArgs: string[];
        if (spawnOverride) {
          command = spawnOverride.command;
          commandArgs = spawnOverride.args ?? cliArgs;
        } else {
          // Resolve to the alix CLI entry point
          const thisFile = fileURLToPath(import.meta.url);
          const repoRoot = resolve(thisFile, "..", "..", "..", "..");
          command = String(process.execPath);
          commandArgs = [resolve(repoRoot, "dist", "src", "cli.js"), ...cliArgs];
        }

        const child = spawn(command, commandArgs, {
          cwd: task.cwd,
          stdio: ["pipe", "pipe", "pipe"] as const,
          env: buildChildEnv(this.options.config?.runtime?.envAllowlist, {
            ALIX_NO_BANNER: "1",
            // Marks a manager-spawned child so it can install the
            // parent-death watchdog (exit when the stdin pipe closes).
            ALIX_SUBAGENT_CHILD: "1",
            // Secret-service IPC so the child can resolve cred:// references
            // through loadConfig exactly like the parent. Without the bus
            // address, libsecret lookups fail with "Credential not found" and
            // every delegate call dies. No secret VALUES cross this boundary —
            // only the address of the user's own keyring bus (plus the runtime
            // dir that normally holds its socket).
            ...(process.env.DBUS_SESSION_BUS_ADDRESS
              ? { DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS }
              : {}),
            ...(process.env.XDG_RUNTIME_DIR
              ? { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR }
              : {}),
            ...(task.scriptedScenarioJson ? { ALIX_EVAL_SCENARIO: task.scriptedScenarioJson } : {}),
          }),
        }) as ChildProcess;

        const running: RunningSubagent = { task, process: child, resolve: resolvePromise, reject, cancelled: false };
        this.running.set(task.id, running);
        this.emitLifecycle("agent.state_changed", { ...lifecycleBase, state: "thinking", operation: "Subagent running" });

        let stdoutData = "";
        if (child.stdout) {
          child.stdout.on("data", (chunk: Buffer) => { stdoutData += chunk.toString(); });
        }
        let stderr = "";

        if (child.stderr) {
          child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        }

        child.on("exit", (code: number | null) => {
          this.running.delete(task.id);
          this.releaseOwnership(task);

          const exitCode = code ?? 1;
          // The subagent may write streaming output to stdout before
          // its final JSON result. Take only the last JSON line.
          let parsed: Partial<SubagentResult> | null = null;
          if (stdoutData.trim()) {
            const lines = stdoutData.trim().split("\n").filter(Boolean);
            for (let i = lines.length - 1; i >= 0; i--) {
              try { parsed = JSON.parse(lines[i]) as Partial<SubagentResult>; break; } catch { /* skip non-JSON lines */ }
            }
          }
          const status: SubagentResult["status"] =
            parsed?.status === "success" || parsed?.status === "failed" || parsed?.status === "rejected" || parsed?.status === "partial"
              ? parsed.status
              : exitCode === 0 ? "success" : "failed";

          const result: SubagentResult = {
            id: task.id,
            role: task.role,
            status,
            findings: parsed?.findings ?? [],
            events: parsed?.events ?? [],
            error: status !== "success" ? (parsed?.error || stderr || `Exit code ${exitCode}`) : undefined,
          };

          for (const cb of this.callbacks) cb(result);

          // Emit subagent.result event
          this.options.eventLog?.append({
            sessionId: this.options.sessionId,
            actor: "system",
            type: "subagent.result",
            payload: { role: task.role, taskId: task.id, status: result.status, findings: result.findings },
          });
          if (!running.cancelled) {
            const terminalType = result.status === "failed" || result.status === "rejected"
              ? "agent.failed"
              : "agent.completed";
            this.emitLifecycle(terminalType, {
              ...lifecycleBase,
              state: result.status === "success" ? "completed" : result.status,
              status: result.status,
              ...(result.error ? { error: result.error } : {}),
            });
          }

          // Resolve whenever we have a structured result (even a failed one, so the
          // parent keeps findings) or the child exited cleanly. Reject only on a
          // genuine crash: no parseable JSON AND a non-zero exit code.
          if (parsed || exitCode === 0) {
            resolvePromise(result);
          } else {
            reject(new Error(result.error ?? `Subagent exited with code ${exitCode}`));
          }
        });

        child.on("error", (err: Error) => {
          this.running.delete(task.id);
          this.releaseOwnership(task);
          if (!running.cancelled) {
            this.emitLifecycle("agent.failed", {
              ...lifecycleBase,
              state: "failed",
              status: "failed",
              error: err.message,
            });
          }
          reject(err);
        });
      } catch (err) {
        // Spawn setup failed — release ownership so future delegate
        // attempts don't hit "Overlapping ownership" for a dead subagent.
        this.releaseOwnership(task);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Parallel fan-out: launch every spec before awaiting any of them.
   * Per-child error isolation — a spawn rejection becomes a failed result
   * for that child, never a batch rejection. Results align to input order
   * even when completion order differs. Reuses the single-spawn path, so
   * ownership, lifecycle, and session-mode propagation behave identically.
   */
  async spawnMany(specs: SubagentTask[]): Promise<SubagentResult[]> {
    const indices = new Map<string, number>();
    specs.forEach((task, i) => indices.set(task.id, i));
    const settled = await Promise.allSettled(specs.map(task => this.spawn(task)));
    return settled.map((outcome, i) => {
      if (outcome.status === "fulfilled") return outcome.value;
      const task = specs[i];
      return {
        id: task.id,
        role: task.role,
        status: "failed" as const,
        findings: [],
        events: [],
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      };
    });
  }

  /** Cancel one running subagent (kill + release ownership). No-op when unknown. */
  cancel(taskId: string): boolean {
    const running = this.running.get(taskId);
    if (!running) return false;
    running.cancelled = true;
    this.emitLifecycle("agent.cancelled", {
      agentId: taskId,
      parentAgentId: this.options.parentAgentId ?? `session:${this.options.sessionId}`,
      taskId: running.task.id,
      role: running.task.role,
      state: "cancelled",
      status: "cancelled",
      operation: "Manager cancel",
    });
    running.process.kill();
    this.running.delete(taskId);
    this.releaseOwnership(running.task);
    return true;
  }

  shutdown(): void {
    for (const [agentId, running] of this.running) {
      running.cancelled = true;
      this.emitLifecycle("agent.cancelled", {
        agentId,
        parentAgentId: this.options.parentAgentId ?? `session:${this.options.sessionId}`,
        taskId: running.task.id,
        role: running.task.role,
        state: "cancelled",
        status: "cancelled",
        operation: "Manager shutdown",
      });
      running.process.kill();
    }
    this.running.clear();
    this.ownershipRegistry.clear();
  }

  private releaseOwnership(task: SubagentTask): void {
    if (task.mode === "write" && task.ownedPaths?.length) {
      for (const path of task.ownedPaths) {
        this.ownershipRegistry.delete(path);
      }
    }
  }

  private emitLifecycle(type: string, payload: Record<string, unknown>): void {
    void this.options.eventLog?.append({
      sessionId: this.options.sessionId,
      actor: "system",
      type,
      payload,
    });
  }

  getRoleConfig(role: SubagentRole): SubagentRoleConfig | undefined {
    return this.options.config?.subagents?.roles.find((r: SubagentRoleConfig) => r.role === role);
  }

  getRoleModel(role: SubagentRole): { provider: string; name: string } {
    const roleConfig = this.getRoleConfig(role);
    const style = roleConfig?.style ?? "fast";
    const tier = this.options.config?.subagents?.[style] as ModelTierConfig | undefined;
    if (!tier) {
      throw new Error(
        `Subagent tier "${style}" is unconfigured. ` +
        `This should not happen because loadConfig fills unset tiers from the main model. ` +
        `Please file a bug report.`
      );
    }
    return { provider: tier.provider, name: tier.name };
  }
}
