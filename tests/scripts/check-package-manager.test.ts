import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "scripts", "check-package-manager.sh"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate repository root from ${start}`);
}

const SCRIPT = join(findRoot(__dirname), "scripts", "check-package-manager.sh");

function fixture(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "alix-package-manager-"));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return dir;
}

function run(files: Record<string, string>): { status: number | null; output: string } {
  const dir = fixture(files);
  try {
    const result = spawnSync("bash", [SCRIPT], { cwd: dir, encoding: "utf-8" });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const pkg = (scripts: Record<string, string>): string => JSON.stringify({ scripts }, null, 2);

describe("check-package-manager", () => {
  it("accepts pnpm scripts and package.json", () => {
    const result = run({ "package.json": pkg({ test: "pnpm exec vitest" }) });
    assert.equal(result.status, 0, result.output);
  });

  it("rejects npx in package.json", () => {
    const result = run({ "package.json": pkg({ test: "npx vitest" }) });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /package\.json/);
  });

  it("rejects npx in a workflow", () => {
    const result = run({ ".github/workflows/ci.yml": "run: npx vitest\n" });
    assert.equal(result.status, 1, result.output);
  });

  it("rejects an ordinary npm install in a script", () => {
    const result = run({ "scripts/install.sh": "npm install express\n" });
    assert.equal(result.status, 1, result.output);
  });

  it("rejects npm install in documentation outside the exact prose exemption", () => {
    const result = run({ "docs/setup.md": "Run `npm install` before starting.\n" });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /docs\/setup\.md/);
  });

  it("allows only the historical command-detection prose in the research note", () => {
    const exemptLine =
      "- Detect `npm test`, `npm run test`, `npm run typecheck`, `pytest`, `make test`, and common package-manager variants.\n";
    const result = run({
      "docs/agentic-harness-research.md": exemptLine,
    });
    assert.equal(result.status, 0, result.output);
  });

  it("still checks the rest of the historical research note", () => {
    const result = run({
      "docs/agentic-harness-research.md":
        "- Detect `npm test`, `npm run test`, `npm run typecheck`, `pytest`, `make test`, and common package-manager variants.\n" +
        "Run `npm install` to provision the repository.\n",
    });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /agentic-harness-research\.md/);
  });

  it("rejects npx in a shell script", () => {
    const result = run({ "scripts/install.sh": "npx vitest\n" });
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /scripts\/install\.sh/);
  });

  it("allows the packed-artifact npm install", () => {
    const result = run({
      "scripts/install.sh": 'npm install --prefix "$TMP_DIR" --no-audit --no-fund "$TARBALL"\n',
    });
    assert.equal(result.status, 0, result.output);
  });

  it("ignores comment-only policy lines", () => {
    const result = run({
      "scripts/notes.sh": "# npm install express\n# npx vitest\n",
    });
    assert.equal(result.status, 0, result.output);
  });
});
