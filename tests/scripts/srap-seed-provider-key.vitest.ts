/**
 * SRAP-G3-ACCEPT — fixture credential seeder contract.
 *
 * Exercises `scripts/srap-accept/seed-provider-key.mjs` against throwaway
 * fixture roots. The contract under test is the isolation/handling policy:
 *
 *   - the secret is accepted ONLY on stdin or a protected FD (never argv);
 *   - the reserved `srap-evidence` namespace is refused;
 *   - HOME/XDG_STATE_HOME must resolve inside the disposable root;
 *   - the backend is forced to `plain-file` (no keychain fallback, no
 *     keychain-metadata mirror);
 *   - read-back is verified after writing;
 *   - no secret (or key material) is ever printed to stdout/stderr;
 *   - `--remove` deletes an entry.
 *
 * Requires `dist/` (the script imports built credential APIs).
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";

const REPO = process.cwd();
const SCRIPT = join(REPO, "scripts/srap-accept/seed-provider-key.mjs");
const BACKEND_MODULE = join(REPO, "dist/src/governance/security/credentials/backend-selection.js");

interface RunResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "srap-seed-"));
  mkdirSync(join(root, "home"), { recursive: true });
  // Simulate a bootstrapped fixture: the seeder proves containment against
  // `$ROOT/state/alix-inspector` and requires it to exist.
  mkdirSync(join(root, "state", "alix-inspector"), { recursive: true });
  roots.push(root);
  return root;
}

function envFor(root: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    SRAP_ACCEPT_ROOT: root,
    ALIX_REPO_ROOT_ABS: REPO,
    HOME: join(root, "home"),
    XDG_STATE_HOME: join(root, "state"),
    XDG_CACHE_HOME: join(root, "cache"),
    TMPDIR: join(root, "tmp"),
    // Windows resolves the platform state dir from %LOCALAPPDATA%; keep it
    // inside the disposable root so the fixture stays isolated.
    LOCALAPPDATA: join(root, "home", "AppData", "Local"),
    ...extra,
  };
}

function run(
  root: string,
  args: string[],
  opts: { stdin?: string; fd3?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const stdio: ("pipe" | "ignore")[] =
      opts.fd3 !== undefined ? ["pipe", "pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"];
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      env: envFor(root, opts.env),
      stdio,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d));
    child.stderr?.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin?.on("error", () => {});
    child.stdin?.end(opts.stdin ?? "");
    if (opts.fd3 !== undefined) {
      const s3 = child.stdio[3] as Writable | null | undefined;
      if (s3) {
        s3.on("error", () => {});
        s3.end(opts.fd3);
      }
    }
  });
}

function credentialsDir(root: string): string {
  // Mirror `user-state-paths.ts` platform resolution (the fixture keeps HOME —
  // and on Windows LOCALAPPDATA — inside the disposable root).
  const home = join(root, "home");
  switch (process.platform) {
    case "darwin":
      return join(home, "Library", "Application Support", "alix-inspector", "data", "credentials");
    case "win32":
      return join(home, "AppData", "Local", "alix-inspector", "data", "credentials");
    default:
      return join(root, "state", "alix-inspector", "data", "credentials");
  }
}
function storePath(root: string): string {
  return join(credentialsDir(root), "credential-store.json");
}
function entries(root: string): string[] {
  const j = JSON.parse(readFileSync(storePath(root), "utf8")) as {
    credentials?: Array<{ entry: { provider: string; keyLabel: string } }>;
  };
  return (j.credentials ?? []).map((c) => `${c.entry.provider}/${c.entry.keyLabel}`);
}
function storedValue(root: string, provider: string, keyLabel: string): string | undefined {
  const j = JSON.parse(readFileSync(storePath(root), "utf8")) as {
    credentials?: Array<{ entry: { provider: string; keyLabel: string }; value?: string }>;
  };
  return (j.credentials ?? []).find(
    (c) => c.entry.provider === provider && c.entry.keyLabel === keyLabel,
  )?.value;
}

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

const built = existsSync(BACKEND_MODULE);
if (!built) {
  throw new Error(
    `srap-seed-provider-key vitest requires a build (missing ${BACKEND_MODULE}). Run: pnpm build`,
  );
}

// The SRAP acceptance fixture is a POSIX target: `HOME` (and `XDG_STATE_HOME`)
// isolation plus protected-FD/stdin secret delivery rely on POSIX pipe
// semantics. Windows is covered by other suites, not this fixture contract.
describe.skipIf(process.platform === "win32")("srap seed-provider-key", () => {
  it("seeds via stdin into the isolated plain-file store without printing the secret", async () => {
    const root = makeRoot();
    const secret = "fixture-dummy-secret-abc1234567890";
    const res = await run(root, ["--provider", "openrouter", "--label", "apiKey"], { stdin: secret });

    expect(res.code).toBe(0);
    const out = JSON.parse(res.stdout.trim());
    expect(out).toMatchObject({
      ok: true,
      mode: "seed",
      backend: "plain-file",
      provider: "openrouter",
      keyLabel: "apiKey",
      valueLength: secret.length,
      verified: true,
      credentialsDirWithinRoot: true,
    });

    expect(res.stdout + res.stderr).not.toContain(secret);
    expect(entries(root)).toContain("openrouter/apiKey");
    // The stored value must equal the supplied secret (guards the subarray/
    // fill(0) aliasing regression that would otherwise store all-NUL bytes).
    expect(storedValue(root, "openrouter", "apiKey")).toBe(secret);

    // backend forced to plain-file; no keychain-metadata mirror created
    expect(readFileSync(join(credentialsDir(root), ".backend"), "utf8").trim()).toBe("plain-file");
    expect(existsSync(join(credentialsDir(root), "keychain-metadata.json"))).toBe(false);
  });

  it("seeds via a protected FD (3)", async () => {
    const root = makeRoot();
    const secret = "fd3-secret-value-42";
    const res = await run(root, ["--provider", "openrouter", "--label", "apiKey", "--fd", "3"], {
      fd3: secret,
    });

    expect(res.code).toBe(0);
    expect(JSON.parse(res.stdout.trim()).valueLength).toBe(secret.length);
    expect(res.stdout + res.stderr).not.toContain(secret);
    expect(entries(root)).toContain("openrouter/apiKey");
    expect(storedValue(root, "openrouter", "apiKey")).toBe(secret);
  });

  it("rejects a secret supplied as an argv flag", async () => {
    const root = makeRoot();
    const res = await run(root, ["--provider", "openrouter", "--label", "apiKey", "--value", "oops"]);

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("--value");
    expect(res.stdout + res.stderr).not.toContain("oops");
  });

  it("refuses the reserved srap-evidence namespace", async () => {
    const root = makeRoot();
    const res = await run(root, ["--provider", "srap-evidence", "--label", "hmac-key:v9"], {
      stdin: "x",
    });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("reserved");
  });

  it("rejects an empty secret", async () => {
    const root = makeRoot();
    const res = await run(root, ["--provider", "openrouter", "--label", "apiKey"], { stdin: "" });

    expect(res.code).not.toBe(0);
    expect(res.stderr).toContain("empty secret");
  });

  it("refuses when HOME escapes the fixture root", async () => {
    const root = makeRoot();
    const outside = mkdtempSync(join(tmpdir(), "srap-outside-"));
    try {
      const res = await run(root, ["--provider", "openrouter", "--label", "apiKey"], {
        stdin: "x",
        env: { HOME: outside },
      });
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain("escapes the fixture root");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("removes a seeded entry and lists labels only", async () => {
    const root = makeRoot();
    const secret = "to-remove-1";
    await run(root, ["--provider", "openrouter", "--label", "apiKey"], { stdin: secret });
    expect(entries(root)).toContain("openrouter/apiKey");

    const rem = await run(root, ["--remove", "--provider", "openrouter", "--label", "apiKey"]);
    expect(rem.code).toBe(0);

    const list = await run(root, ["--list"]);
    const parsed = JSON.parse(list.stdout.trim());
    expect(parsed.mode).toBe("list");
    expect(parsed.entries).not.toContain("openrouter/apiKey");
    expect(list.stdout + list.stderr).not.toContain(secret);
  });
});
