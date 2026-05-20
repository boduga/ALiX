import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { exec as execCallback } from "node:child_process";

const execAsync = promisify(execCallback);

export interface RunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  error?: "timeout" | "killed" | "spawn_error" | string;
  signal?: string;
}

export interface RunOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean;
}

export class CommandRunner {
  private defaultTimeout: number;

  constructor(defaultTimeout = 30000) {
    this.defaultTimeout = defaultTimeout;
  }

  async run(command: string, options: RunOptions = {}): Promise<RunResult> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
        timeout,
              });

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      if (error.killed) {
        return {
          success: false,
          stdout: "",
          stderr: "",
          exitCode: -1,
          durationMs,
          error: "timeout",
          signal: error.signal,
        };
      }

      return {
        success: false,
        stdout: error.stdout?.toString() ?? "",
        stderr: error.stderr?.toString() ?? "",
        exitCode: error.code ?? -1,
        durationMs,
        error: error.message,
      };
    }
  }

  async runWithStreaming(
    command: string,
    options: RunOptions = {},
    onOutput: (data: string, isStderr: boolean) => void
  ): Promise<RunResult> {
    const timeout = options.timeout ?? this.defaultTimeout;
    const startTime = Date.now();

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";

      const child = spawn(command, {
        cwd: options.cwd ?? process.cwd(),
        env: { ...process.env, ...options.env },
              });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
      }, timeout);

      child.stdout.on("data", (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        onOutput(str, false);
      });

      child.stderr.on("data", (data: Buffer) => {
        const str = data.toString();
        stderr += str;
        onOutput(str, true);
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        resolve({
          success: code === 0,
          stdout,
          stderr,
          exitCode: code ?? -1,
          durationMs,
        });
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        resolve({
          success: false,
          stdout,
          stderr,
          exitCode: -1,
          durationMs,
          error: err.message,
        });
      });
    });
  }
}
