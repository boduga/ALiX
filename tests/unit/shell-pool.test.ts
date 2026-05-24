import { describe, it } from "node:test";
import assert from "node:assert";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";

describe("ShellPool", () => {
  it("maintains working directory across calls", async () => {
    const cwd = "/tmp";
    const marker = `__SHELLPOOL_TEST_${Date.now()}__`;

    const pool = new ShellPool({ cwd });
    try {
      // Create a test directory
      await pool.run(`mkdir -p shell-pool-test-dir`);

      // Change to that directory
      await pool.run("cd shell-pool-test-dir");

      // Verify pwd is in the test directory
      const result = await pool.run("pwd");

      assert.ok(result.output.includes("shell-pool-test-dir"),
        `Expected output to contain shell-pool-test-dir, got: ${result.output}`);
    } finally {
      await pool.close();
      await rm("/tmp/shell-pool-test-dir", { recursive: true, force: true }).catch(() => {});
    }
  });

  it("captures command output", async () => {
    const pool = new ShellPool({ cwd: "/tmp" });
    try {
      const result = await pool.run("echo hello world");
      assert.ok(result.output.includes("hello world"), `Expected "hello world" in output, got: ${result.output}`);
    } finally {
      await pool.close();
    }
  });
});

// Inline ShellPool implementation for testing
class ShellPool {
  private proc: ReturnType<typeof spawn>;
  private readonly marker: string;

  constructor(options: { cwd: string; timeoutMs?: number }) {
    this.marker = `__SHELLPOOL_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
    this.proc = spawn("/bin/bash", [], {
      cwd: options.cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

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

  close(): void {
    this.proc.kill();
    this.proc.stdin?.end();
  }
}