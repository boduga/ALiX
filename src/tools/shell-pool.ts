import { spawn } from "node:child_process";

/**
 * ShellPool maintains a persistent bash process for commands
 * that need working directory persistence.
 */
export class ShellPool {
  private proc: ReturnType<typeof spawn>;
  private readonly marker: string;

  constructor(options: { cwd: string; timeoutMs?: number }) {
    this.marker = `__SHELLPOOL_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    this.proc = spawn("/bin/bash", [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  /**
   * Run a command in the persistent shell.
   * Resolves when the command completes.
   */
  async run(command: string, timeoutMs = 120000): Promise<{ output: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      let output = "";
      let stderr = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
        }
      }, timeoutMs);

      this.proc.stdout?.on("data", (d) => {
        output += d.toString();
        if (output.includes(this.marker)) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            // Remove the marker from output
            const cleanOutput = output.replace(new RegExp(`.*${this.marker}\\n?`), "");
            resolve({
              output: cleanOutput + (stderr ? `\n--- stderr ---\n${stderr}` : ""),
              exitCode: 0
            });
          }
        }
      });

      this.proc.stderr?.on("data", (d) => { stderr += d.toString(); });

      this.proc.on("close", (code) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          const cleanOutput = output.replace(new RegExp(`.*${this.marker}\\n?`), "");
          resolve({
            output: cleanOutput + (stderr ? `\n--- stderr ---\n${stderr}` : ""),
            exitCode: code ?? 0
          });
        }
      });

      this.proc.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });

      this.proc.stdin?.write(`${command}\necho '${this.marker}'\n`);
    });
  }

  /**
   * Close the shell process.
   */
  close(): void {
    this.proc.kill();
    this.proc.stdin?.end();
  }
}