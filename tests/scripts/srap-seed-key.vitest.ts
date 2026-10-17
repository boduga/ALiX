/**
 * SRAP-G3-ACCEPT — fixture evidence-key seeder contract.
 *
 * Exercises `scripts/srap-accept/seed-key.mjs` against throwaway fixture roots.
 * The contract under test:
 *
 *   - the fixture state root must exist and must not escape `$SRAP_ACCEPT_ROOT`
 *     via a symlink (containment is measured against the root, not the target);
 *   - a legitimate in-root layout seeds the `srap-evidence` HMAC key;
 *   - no key material is printed.
 *
 * Requires `dist/` (the script imports built credential APIs).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = process.cwd();
const SCRIPT = join(REPO, "scripts/srap-accept/seed-key.mjs");
const BACKEND_MODULE = join(REPO, "dist/src/governance/security/credentials/backend-selection.js");

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "srap-seedkey-"));
  mkdirSync(join(root, "home"), { recursive: true });
  mkdirSync(join(root, "state", "alix-inspector"), { recursive: true });
  roots.push(root);
  return root;
}

function envFor(root: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SRAP_ACCEPT_ROOT: root,
    ALIX_REPO_ROOT_ABS: REPO,
    HOME: join(root, "home"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    TMPDIR: join(root, "tmp"),
  };
}

function run(root: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env: envFor(root), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

if (!existsSync(BACKEND_MODULE)) {
  throw new Error(`srap-seed-key vitest requires a build (missing ${BACKEND_MODULE}). Run: pnpm build`);
}

describe.skipIf(process.platform !== "linux")("srap seed-key", () => {
  it("seeds the evidence key on a legitimate in-root layout", async () => {
    const root = makeRoot();
    const res = await run(root);

    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    expect(out).toMatchObject({ ok: true, backend: "plain-file", activeKeyVersion: 1 });
    // A raw key value must never be printed.
    expect(res.stdout + res.stderr).not.toMatch(/hmac-key:[^"]*"[A-Za-z0-9+/=]{16,}/);
  });

  it("refuses when the state dir escapes the root via a symlink", async () => {
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), "srap-escape-"));
    const stateDir = join(root, "state", "alix-inspector");
    rmSync(stateDir, { recursive: true, force: true });
    try {
      symlinkSync(outside, stateDir);
      const res = await run(root);

      expect(res.code).not.toBe(0);
      // Distinguishable from the HOME/XDG "escapes the fixture root" message.
      expect(res.stderr).toContain("state dir escapes the fixture root");
      // Nothing may be written into the escape target.
      expect(existsSync(join(outside, "data"))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
