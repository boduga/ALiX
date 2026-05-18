import { spawn, type ChildProcess } from "child_process";
import { resolve } from "path";
import type { SubagentRole, SubagentRoleConfig } from "../config/schema.js";

export type SubagentManagerOptions = {
  sessionId: string;
  /** Override the spawned command for testing. Defaults to the alix CLI. */
  spawnOverride?: { command: string; args?: string[] };
};

export type SubagentTask = {
  id: string;
  role: SubagentRole;
  mode: string;
  prompt: string;
  ownedPaths?: string[];
  expectedOutput?: unknown;
  contextBundle?: unknown;
};

export type SubagentResult = {
  id: string;
  role: SubagentRole;
  status: "success" | "failed" | "rejected";
  findings: unknown[];
  events: unknown[];
  error?: string;
};

type RunningSubagent = {
  task: SubagentTask;
  process: ChildProcess;
  resolve: (result: SubagentResult) => void;
  reject: (err: Error) => void;
};

export type SubagentResultCallback = (result: SubagentResult) => void;

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

      const roleConfig = this.getRoleConfig(task.role);
      void roleConfig; // model selection deferred to CLI entry point

      const args = [
        "--subagent", task.role,
        "--task-id", task.id,
        "--prompt", task.prompt,
        "--mode", task.mode,
        "--session-id", this.options.sessionId,
      ];

      if (task.ownedPaths?.length) {
        args.push("--owned-paths", task.ownedPaths.join(","));
      }

      // Use spawnOverride for testing, otherwise use alix CLI
      const spawnOverride = this.options.spawnOverride;
      let command: string;
      let commandArgs: string[];
      if (spawnOverride) {
        command = spawnOverride.command;
        commandArgs = spawnOverride.args ?? args;
      } else {
        // Resolve to the alix CLI entry point
        const { fileURLToPath } = require("url");
        const thisFile = fileURLToPath(import.meta.url);
        const repoRoot = resolve(thisFile, "..", "..", "..", "..");
        command = String(process.execPath);
        commandArgs = [resolve(repoRoot, "dist", "src", "cli.js"), ...args];
      }

      const child = spawn(command, commandArgs, {
        stdio: ["pipe", "pipe", "pipe"] as const,
        env: { ...process.env, ALIX_NO_BANNER: "1" },
      }) as ChildProcess;

      this.running.set(task.id, { task, process: child, resolve: resolvePromise, reject });

      let stderr = "";

      if (child.stderr) {
        child.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
      }

      child.on("exit", (code: number | null) => {
        this.running.delete(task.id);

        const exitCode = code ?? 1;
        const result: SubagentResult = {
          id: task.id,
          role: task.role,
          status: exitCode === 0 ? "success" : "failed",
          findings: [],
          events: [],
          error: exitCode !== 0 ? (stderr || `Exit code ${exitCode}`) : undefined,
        };

        for (const cb of this.callbacks) cb(result);

        if (exitCode === 0) {
          resolvePromise(result);
        } else {
          reject(new Error(stderr || `Subagent exited with code ${exitCode}`));
        }
      });

      child.on("error", (err: Error) => {
        this.running.delete(task.id);
        reject(err);
      });
    });
  }

  shutdown(): void {
    for (const [, running] of this.running) {
      running.process.kill();
    }
    this.running.clear();
    this.ownershipRegistry.clear();
  }

  getRoleConfig(role: SubagentRole): SubagentRoleConfig {
    const defaults: Record<SubagentRole, SubagentRoleConfig> = {
      explorer:           { role: "explorer",           mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      reviewer:           { role: "reviewer",            mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      test_investigator:  { role: "test_investigator", mode: "read_only", retryCount: 1 },
      docs_researcher:    { role: "docs_researcher",    mode: "read_only", retryCount: 1, fastModel: "qwen3b" },
      worker:             { role: "worker",             mode: "write",     retryCount: 0 },
    };
    return defaults[role];
  }
}