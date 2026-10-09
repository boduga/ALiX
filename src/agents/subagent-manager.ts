import { spawn, type ChildProcess } from "child_process";
import { buildChildEnv } from "../runtime-state/runtime/child-env.js";
import { resolve } from "path";
import { fileURLToPath } from "url";
import type { SubagentRole, SubagentTask, SubagentResult, SubagentRoleConfig, AlixConfig, ModelTierConfig } from "../operations/config/schema.js";
import { parseSessionMode } from "../operations/config/schema.js";
import type { EventLog } from "../runtime-state/events/event-log.js";
import { OwnershipRegistry, type AcquireRequest } from "../coordination/ownership/ownership-registry.js";
import { resolveOwnedScopePrefix } from "../coordination/ownership/path-scope.js";

// Re-export types for consumers
export type { SubagentTask, SubagentResult };

export type SubagentManagerOptions = {
  sessionId: string;
  /** Logical parent identity for Workbench hierarchy. Defaults to the session root. */
  parentAgentId?: string;
  /**
   * Workspace root captured at CONSTRUCTION. Registry files
   * (`<cwd>/.alix/ownership/`) derive from it; per-task `task.cwd` wins for
   * that task's claims. Never re-read from process.cwd() at write time.
   */
  cwd?: string;
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

/**
 * Kill a child and any grandchildren it spawned.
 *
 * On POSIX the child is spawned detached (its own process group whose id
 * is its pid), so signalling the negative pid reaches the whole tree —
 * including shell commands the subagent launched. Windows has no
 * equivalent group signal here, so it falls back to the direct child.
 * Combined with the child's stdin-EOF watchdog, this covers both explicit
 * cancellation and host death.
 */
function terminateProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Group already gone — fall through to the direct kill.
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Already exited.
  }
}

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

function resolvedCredentialPayload(config: AlixConfig | undefined): string | undefined {
  const apiKeys: Record<string, string> = {};
  for (const [provider, value] of Object.entries(config?.apiKeys ?? {})) {
    if (typeof value === "string" && value.length > 0 && !value.startsWith("cred://")) {
      apiKeys[provider] = value;
    }
  }
  return Object.keys(apiKeys).length > 0 ? JSON.stringify(apiKeys) : undefined;
}

/** Renew active chat-delegate leases well inside the registry's 30-min TTL. */
const LEASE_RENEW_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Decide what a single lease-renewal pass does with a task's entry.
 *
 * A task released while `renew` was awaited is no longer tracked
 * (`tracked === false`): the pass must NOT re-insert it (that resurrects a
 * released task and leaks its leases) — instead the caller releases the ids
 * this pass just renewed. Extracted as a pure function so this
 * release/renew race is unit-testable without waiting out the real interval.
 */
export function resolveRenewalResult(
  tracked: boolean,
  kept: string[],
): { action: "set" | "delete" | "release"; releaseIds: string[] } {
  if (!tracked) return { action: "release", releaseIds: kept };
  return kept.length > 0 ? { action: "set", releaseIds: [] } : { action: "delete", releaseIds: [] };
}

export class SubagentManager {
  private running = new Map<string, RunningSubagent>();
  private callbacks: SubagentResultCallback[] = [];
  /**
   * R3.2: ONE durable ownership authority. Spawn-time claims for chat-path
   * write delegates acquire leases on the shared registry
   * (`<cwd>/.alix/ownership/ownership.json`, cross-process lock) — the old
   * in-process `Map<path, subagentId>` was a second, weaker registry (exact
   * string keys only, died with the process, invisible to other hosts).
   * Coordination tasks (`coordinationRunId`/`assignedAgentId` set) SKIP
   * acquisition: the scheduler already pre-claims their leases before dispatch
   * (`acquireWorkerOwnership`), under a different agentId.
   */
  private readonly registryCwd: string;
  private readonly registries = new Map<string, OwnershipRegistry>();
  private readonly leasesByTask = new Map<string, { cwd: string; ids: string[] }>();
  private renewTimer?: ReturnType<typeof setInterval>;
  /**
   * Bumped by `shutdown()`. Because `spawn` now awaits lease acquisition
   * before the child exists, a shutdown racing an in-flight spawn would
   * otherwise kill nothing and orphan the child behind it: the spawn
   * re-checks the epoch after acquisition and cancels itself instead.
   */
  private spawnEpoch = 0;

  constructor(private options: SubagentManagerOptions) {
    this.registryCwd = resolve(options.cwd ?? process.cwd());
  }

  private registryFor(cwd: string): OwnershipRegistry {
    const key = resolve(cwd);
    let registry = this.registries.get(key);
    if (!registry) {
      registry = new OwnershipRegistry(key, { sessionId: this.options.sessionId });
      this.registries.set(key, registry);
    }
    return registry;
  }

  /**
   * Acquire exclusive-write leases for a chat-path write task's ownedPaths.
   * Throws on conflict (overlapping ownership) or on an uninterpretable path —
   * spawn never proceeds without the leases it depends on (fail closed).
   */
  private async acquireTaskOwnership(task: SubagentTask): Promise<void> {
    if (task.mode !== "write" || !task.ownedPaths?.length) return;
    if (task.coordinationRunId || task.assignedAgentId) return; // scheduler pre-claimed
    const cwd = resolve(task.cwd ?? this.registryCwd);
    const registry = this.registryFor(cwd);
    const reqs: AcquireRequest[] = [];
    for (const path of task.ownedPaths) {
      // Enforcement-faithful scope: the same reduction PolicyGate and
      // FileToolRouter apply to ownedPaths (`.`, `dir`, `dir/**`, file all
      // reduce to a workspace prefix), so lease conflicts and runtime
      // authorization agree on what a claim covers.
      const prefix = resolveOwnedScopePrefix(path, cwd);
      if (prefix === undefined) {
        throw new Error(`Invalid ownership path '${path}' — cannot be reduced to a workspace scope`);
      }
      reqs.push({
        agentId: task.id,
        scope: { kind: "path", root: prefix, recursive: true },
        mode: "exclusive-write",
        taskId: task.id,
        sessionId: this.options.sessionId,
        reason: `Subagent ${task.id}`,
      });
    }
    const results = await registry.acquireMany(reqs);
    const acquired: string[] = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.acquired && result.record) {
        acquired.push(result.record.id);
        continue;
      }
      for (const id of acquired) {
        await registry.release(id).catch(() => false); // best-effort rollback
      }
      const other = result.conflict?.conflictingRecords[0]?.agentId;
      if (other) {
        throw new Error(`Overlapping ownership: '${task.ownedPaths[i]}' is already owned by '${other}'`);
      }
      throw new Error(result.conflict?.reason ?? `Ownership acquisition failed for '${task.ownedPaths[i]}'`);
    }
    if (acquired.length > 0) {
      this.leasesByTask.set(task.id, { cwd, ids: acquired });
      this.ensureLeaseRenewal();
    }
  }

  /** Release a task's leases. Idempotent; safe to call from exit/error paths. */
  private async releaseTaskOwnership(taskId: string): Promise<void> {
    const entry = this.leasesByTask.get(taskId);
    if (!entry) return;
    this.leasesByTask.delete(taskId);
    const registry = this.registryFor(entry.cwd);
    for (const id of entry.ids) {
      await registry.release(id).catch(() => false); // TTL is the backstop
    }
  }

  /**
   * Keep running delegates' leases alive past the registry TTL (agents have
   * unlimited lifetime). Renewals that find their record gone (released or
   * expired externally) drop the id; the timer stops itself when no leases
   * remain. `unref` so it never holds the process open.
   */
  private ensureLeaseRenewal(): void {
    if (this.renewTimer) return;
    this.renewTimer = setInterval(() => {
      void (async () => {
        for (const [taskId, entry] of [...this.leasesByTask]) {
          const registry = this.registryFor(entry.cwd);
          const kept: string[] = [];
          for (const id of entry.ids) {
            const ok = await registry.renew(id).catch(() => false);
            if (ok) kept.push(id);
          }
          const outcome = resolveRenewalResult(this.leasesByTask.has(taskId), kept);
          if (outcome.action === "set") {
            this.leasesByTask.set(taskId, { ...entry, ids: kept });
          } else if (outcome.action === "delete") {
            this.leasesByTask.delete(taskId);
          } else {
            // Task released during the awaits: release the ids this pass
            // renewed rather than resurrecting a released task.
            for (const id of outcome.releaseIds) {
              await registry.release(id).catch(() => false);
            }
          }
        }
        if (this.leasesByTask.size === 0 && this.renewTimer) {
          clearInterval(this.renewTimer);
          this.renewTimer = undefined;
        }
      })();
    }, LEASE_RENEW_INTERVAL_MS);
    this.renewTimer.unref?.();
  }

  onResult(cb: SubagentResultCallback): void {
    this.callbacks.push(cb);
  }

  /**
   * Spawn a subagent process. For chat-path write tasks, acquires durable
   * ownership leases first — rejects if owned paths overlap another agent's
   * active claim, or if a path cannot be reduced to a workspace scope.
   */
  async spawn(task: SubagentTask): Promise<SubagentResult> {
    // Throws → the async function rejects (same rejection surface the old
    // in-Promise overlap check produced; spawnMany maps it to a failed result).
    const epoch = this.spawnEpoch;
    await this.acquireTaskOwnership(task);
    if (epoch !== this.spawnEpoch) {
      // shutdown() raced this spawn while it awaited acquisition — cancel
      // here (release leases, publish the cancelled lifecycle row) rather
      // than spawning a child nothing will ever kill.
      await this.releaseTaskOwnership(task.id);
      const eventSessionId = task.eventSessionId ?? this.options.sessionId;
      this.emitLifecycle("agent.cancelled", {
        agentId: task.id,
        parentAgentId: this.options.parentAgentId ?? `session:${eventSessionId}`,
        taskId: task.id,
        role: task.role,
        state: "cancelled",
        status: "cancelled",
        operation: "Manager shutdown",
      }, eventSessionId);
      throw new Error("SubagentManager shut down during spawn");
    }
    return new Promise((resolvePromise, reject) => {
      try {
        // Resolve the model before publishing the spawn so the roster never
        // shows a fabricated or guessed model identity.
        const { provider, name } = this.getRoleModel(task.role);
        // Coordination managers have their own internal id (`coord-sub-*`),
        // but their lifecycle events stay in the explicit parent runtime
        // session so session-scoped projections can observe the worker.
        const eventSessionId = task.eventSessionId ?? this.options.sessionId;
        const parentAgentId = this.options.parentAgentId ?? `session:${eventSessionId}`;
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
          sessionId: eventSessionId,
          actor: "system",
          type: "subagent.started",
          payload: { role: task.role, taskId: task.id, prompt: task.prompt.slice(0, 200), ownedPaths: task.ownedPaths ?? [] },
        });
        this.emitLifecycle("agent.spawned", {
          ...lifecycleBase,
          state: "starting",
          operation: task.prompt.slice(0, 200),
          ownedPaths: task.ownedPaths ?? [],
        }, eventSessionId);
        this.emitLifecycle("agent.task_assigned", {
          ...lifecycleBase,
          title: task.taskLabel ?? task.prompt.slice(0, 200),
          prompt: task.prompt.slice(0, 200),
          ownedPaths: task.ownedPaths ?? [],
        }, eventSessionId);
        if (task.ownedPaths?.length) {
          this.emitLifecycle("agent.ownership_changed", { ...lifecycleBase, ownedPaths: task.ownedPaths }, eventSessionId);
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
          ...(task.coordinationRunId ? ["--coordination-run-id", task.coordinationRunId] : []),
          ...(task.coordinationRunId ? ["--credential-fd", "3"] : []),
          ...(task.ownedPaths?.length ? ["--owned-paths", task.ownedPaths.join(",")] : []),
          ...(task.inputPaths?.length ? ["--input-paths", JSON.stringify(task.inputPaths)] : []),
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

        const credentialPayload = task.coordinationRunId ? resolvedCredentialPayload(this.options.config) : undefined;
        const child = spawn(command, commandArgs, {
          cwd: task.cwd,
          stdio: ["pipe", "pipe", "pipe", "pipe"] as const,
          // Own process group on POSIX so terminateProcessTree can reap the
          // whole tree; the stdin pipe still closes on host death, which
          // the child's watchdog turns into a clean exit.
          detached: process.platform !== "win32",
          env: buildChildEnv(this.options.config?.runtime?.envAllowlist, {
            ALIX_NO_BANNER: "1",
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

        const credentialPipe = child.stdio[3];
        if (credentialPipe && "end" in credentialPipe) {
          credentialPipe.on("error", () => { /* child may exit before consuming the optional snapshot */ });
          credentialPipe.end(credentialPayload ?? "{}");
        }

        const running: RunningSubagent = { task, process: child, resolve: resolvePromise, reject, cancelled: false };
        this.running.set(task.id, running);
        this.emitLifecycle("agent.state_changed", { ...lifecycleBase, state: "thinking", operation: "Subagent running" }, eventSessionId);

        let stdoutData = "";
        if (child.stdout) {
          child.stdout.on("data", (chunk: Buffer) => { stdoutData += chunk.toString(); });
        }
        let stderr = "";

        if (child.stderr) {
          child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
        }

        child.on("exit", async (code: number | null) => {
          this.running.delete(task.id);
          // Await before resolving: callers that spawn a successor task for
          // the same paths observe the lease release deterministically.
          await this.releaseTaskOwnership(task.id);

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
            sessionId: eventSessionId,
            actor: "system",
            type: "subagent.result",
            payload: {
              role: task.role,
              taskId: task.id,
              status: result.status,
              findings: result.findings,
              ...coordinationPresentationMeta(task),
              ...(task.deferTerminalLifecycle ? { attemptTerminal: false } : {}),
              agentId: task.id,
            },
          });
          if (!running.cancelled && !task.deferTerminalLifecycle) {
            const terminalType = result.status === "failed" || result.status === "rejected"
              ? "agent.failed"
              : "agent.completed";
            this.emitLifecycle(terminalType, {
              ...lifecycleBase,
              state: result.status === "success" ? "completed" : result.status,
              status: result.status,
              ...(result.error ? { error: result.error } : {}),
            }, eventSessionId);
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

        child.on("error", async (err: Error) => {
          this.running.delete(task.id);
          await this.releaseTaskOwnership(task.id);
          if (!running.cancelled) {
            this.emitLifecycle("agent.failed", {
              ...lifecycleBase,
              state: "failed",
              status: "failed",
              error: err.message,
            }, eventSessionId);
          }
          reject(err);
        });
      } catch (err) {
        // Spawn setup failed — release leases so future delegate attempts
        // don't hit "Overlapping ownership" for a subagent that never ran.
        void this.releaseTaskOwnership(task.id);
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
      parentAgentId: this.options.parentAgentId ?? `session:${running.task.eventSessionId ?? this.options.sessionId}`,
      taskId: running.task.id,
      role: running.task.role,
      state: "cancelled",
      status: "cancelled",
      operation: "Manager cancel",
    }, running.task.eventSessionId ?? this.options.sessionId);
    terminateProcessTree(running.process);
    this.running.delete(taskId);
    // Kick release now (idempotent — the child's exit handler no-ops once the
    // task's lease entry is gone), so an immediate successor spawn on the same
    // paths serializes behind this release under the registry lock.
    void this.releaseTaskOwnership(taskId);
    return true;
  }

  shutdown(): void {
    this.spawnEpoch++;
    for (const [agentId, running] of this.running) {
      running.cancelled = true;
      this.emitLifecycle("agent.cancelled", {
        agentId,
        parentAgentId: this.options.parentAgentId ?? `session:${running.task.eventSessionId ?? this.options.sessionId}`,
        taskId: running.task.id,
        role: running.task.role,
        state: "cancelled",
        status: "cancelled",
        operation: "Manager shutdown",
      }, running.task.eventSessionId ?? this.options.sessionId);
      terminateProcessTree(running.process);
    }
    this.running.clear();
    // Leases release via each child's exit handler; the TTL is the backstop
    // for any exit event that never arrives. The renewal timer stops itself
    // once the lease map empties.
  }

  private emitLifecycle(type: string, payload: Record<string, unknown>, sessionId = this.options.sessionId): void {
    void this.options.eventLog?.append({
      sessionId,
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
