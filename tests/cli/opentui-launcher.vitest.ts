import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("OpenTUI launcher selection", () => {
  it("adds FFI only for selected OpenTUI and fails before terminal setup", () => {
    const cwd = mkdtempSync(join(tmpdir(), "alix-opentui-launcher-"));
    const preload = join(cwd, "probe.cjs");
    const capturedArgs = join(cwd, "node-args.json");
    const capturedErrors = join(cwd, "errors.txt");
    const launcher = join(process.cwd(), "bin", "alix.js");
    writeFileSync(preload, `
      if (process.argv[1]?.replaceAll('\\\\', '/').endsWith('/dist/src/cli.js')) {
        const fs = require('node:fs');
        fs.writeFileSync(process.env.ALIX_LAUNCH_ARG_PROBE, JSON.stringify(process.execArgv));
        const originalError = console.error;
        console.error = (...args) => {
          fs.appendFileSync(process.env.ALIX_LAUNCH_ERROR_PROBE, args.join(' ') + '\\n');
          originalError(...args);
        };
      }
    `);

    // Workload rationale: each case cold-spawns a fresh Node process
    // (preload probe + launcher + CLI) several times over; 15s per spawn and a
    // 30s test budget absorb cold module load on slow CI runners.
    const run = (args: string[]) => {
      rmSync(capturedErrors, { force: true });
      const result = spawnSync(process.execPath, [launcher, ...args], {
        cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${preload}`].filter(Boolean).join(" "),
          ALIX_LAUNCH_ARG_PROBE: capturedArgs,
          ALIX_LAUNCH_ERROR_PROBE: capturedErrors,
        },
        timeout: 15_000,
      });
      expect(result.status).not.toBeNull();
      const nodeArgs = JSON.parse(readFileSync(capturedArgs, "utf8")) as string[];
      const errors = existsSync(capturedErrors) ? readFileSync(capturedErrors, "utf8") : "";
      return { ...result, nodeArgs, errors };
    };

    try {
      const ordinary = run(["--version"]);
      expect(ordinary.status).toBe(0);
      expect(ordinary.nodeArgs).not.toContain("--experimental-ffi");

      const selected = run(["tui", "--renderer", "opentui"]);
      expect(selected.status).toBe(1);
      expect(selected.nodeArgs).toContain("--experimental-ffi");
      expect(selected.errors).toContain("OpenTUI renderer is not implemented yet");
      expect(existsSync(join(cwd, ".alix"))).toBe(false);

      const selectedEquals = run(["tui", "--renderer=opentui"]);
      expect(selectedEquals.status).toBe(1);
      expect(selectedEquals.nodeArgs).toContain("--experimental-ffi");
      expect(selectedEquals.errors).toContain("OpenTUI renderer is not implemented yet");

      const unknown = run(["tui", "--renderer", "unknown"]);
      expect(unknown.status).toBe(1);
      expect(unknown.nodeArgs).not.toContain("--experimental-ffi");
      expect(unknown.errors).toContain("Unknown TUI renderer 'unknown'");

      const missing = run(["tui", "--renderer"]);
      expect(missing.status).toBe(1);
      expect(missing.errors).toContain("Missing TUI renderer");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
