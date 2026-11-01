// tests/scripts/check-staleness.test.ts
//
// Pins the sentinel's verdicts, not its implementation. A staleness check that
// cannot fail is worse than none: it reports "OK" over the exact drift it was
// written to catch, and the drift then reads as coverage that does not exist.
// Each case below builds a tiny fixture root and asserts the specific finding.
//
// Run: pnpm test:node (compiled to dist/tests/scripts/check-staleness.test.js)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the repository root by walking up until the sentinel is found.
 *
 * The test runs from two depths: `tests/scripts/` in source and
 * `dist/tests/scripts/` when compiled, so a fixed `../..` resolves to `dist/`
 * under the node runner and the spawn fails. Walking up is correct in both.
 */
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "scripts", "check-staleness.mjs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate repository root from ${start}`);
}

const ROOT = findRoot(__dirname);
const SCRIPT = join(ROOT, "scripts", "check-staleness.mjs");

const SCHEMA_REF =
  "https://raw.githubusercontent.com/boduga/ALiX/main/security/schemas/audit-exceptions.schema.json";

interface Finding {
  check: string;
  file: string;
  detail: string;
  reference?: string;
}

interface RunResult {
  status: number | null;
  parsed: { ok: boolean; findings: Finding[] } | null;
  stdout: string;
  stderr: string;
}

/** Build a throwaway repository root and return its path. */
function fixture(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "alix-staleness-"));
  for (const [relPath, contents] of Object.entries(files)) {
    const full = join(dir, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
  }
  return dir;
}

function run(dir: string): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--json"], {
    encoding: "utf-8",
  });
  let parsed: { ok: boolean; findings: Finding[] } | null = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // callers assert on exit code; parsed stays null
  }
  return { status: result.status, parsed, stdout: result.stdout, stderr: result.stderr };
}

const checks = (r: RunResult): string[] => (r.parsed?.findings ?? []).map((f) => f.check);

describe("check-staleness: clean tree", () => {
  it("exits 0 and reports no findings", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "src/real.ts": "export const x = 1;\n",
      "AGENTS.md": "# Doc\n\nSee `src/real.ts`.\n",
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.deepEqual(r.parsed?.findings, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-staleness: $schema references", () => {
  it("fails when a local $schema target does not exist", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { $schema: SCHEMA_REF, advisories: [{ id: "x" }] },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("schema-ref"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when the schema target exists", () => {
    const dir = fixture({
      "security/schemas/audit-exceptions.schema.json": {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object",
        properties: { advisories: { type: "array" } },
      },
      "security/audit-exceptions.json": { $schema: SCHEMA_REF, advisories: [{ id: "x" }] },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores external schema hosts it does not own", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "security/thing.json": { $schema: "https://json.schemastore.org/whatever.json" },
    });
    try {
      assert.equal(run(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-staleness: declared-schema conformance", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    additionalProperties: false,
    required: ["advisories"],
    properties: {
      $schema: { type: "string" },
      advisories: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "expiry"],
          properties: {
            id: { type: "string" },
            expiry: { type: "string", format: "date" },
          },
        },
      },
    },
  };

  it("fails on a key the schema does not declare", () => {
    const dir = fixture({
      "security/schemas/audit-exceptions.schema.json": schema,
      "security/audit-exceptions.json": {
        $schema: SCHEMA_REF,
        advisories: [{ id: "x", expiry: "2026-01-01", typo: true }],
      },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("schema-conformance"));
      assert.match(r.parsed!.findings[0].detail, /typo/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on a missing required key", () => {
    const dir = fixture({
      "security/schemas/audit-exceptions.schema.json": schema,
      "security/audit-exceptions.json": { $schema: SCHEMA_REF, advisories: [{ id: "x" }] },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.parsed!.findings[0].detail, /expiry/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on a date that parses as a pattern but not as a date", () => {
    const dir = fixture({
      "security/schemas/audit-exceptions.schema.json": schema,
      "security/audit-exceptions.json": {
        $schema: SCHEMA_REF,
        advisories: [{ id: "x", expiry: "2026-13-99" }],
      },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("schema-conformance"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not enforce a shape the schema leaves open", () => {
    const dir = fixture({
      "security/schemas/open.schema.json": { type: "object", required: [], properties: {} },
      "security/policy.json": {
        $schema: "https://raw.githubusercontent.com/boduga/ALiX/main/security/schemas/open.schema.json",
        anything: 1,
      },
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
    });
    try {
      assert.equal(run(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-staleness: doc path claims", () => {
  it("fails on a root-relative path that does not resolve", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "AGENTS.md": "# Doc\n\nSee `src/ghost.ts`.\n",
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("doc-path"));
      assert.match(r.parsed!.findings[0].detail, /src\/ghost\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a source file cited with its compiled extension", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "tests/thing.test.ts": "export {};\n",
      "AGENTS.md": "# Doc\n\nRun `tests/thing.test.js`.\n",
    });
    try {
      assert.equal(run(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores host paths, bare filenames, and fenced examples", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "AGENTS.md":
        "# Doc\n\n" +
        "Host config lives at `~/.config/alix/config.json` and `/etc/alix/config.json`.\n" +
        "Runtime artifact: `head.json`.\n" +
        "```sh\nsrc/not-a-claim.ts\n```\n",
    });
    try {
      assert.equal(run(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exempts deliberately historical documentation", () => {
    // An AGENTS.md under a historical prefix is the only shape the exemption
    // actually governs: it matches DOC_GLOBS, so without the prefix check it
    // would be audited like a live contract.
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "docs/superseded/AGENTS.md": "# Old\n\nSee `src/removed-long-ago.ts`.\n",
      "docs/superpowers/plans/archived/AGENTS.md": "# Older\n\nSee `src/also-removed.ts`.\n",
      "docs/AGENTS.md": "# Live\n\nSee `src/real.ts`.\n",
      "src/real.ts": "export {};\n",
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still audits a live AGENTS.md under the same fixture", () => {
    // Guards the case above from passing for the wrong reason: the exemption
    // must be the only thing that suppresses the finding.
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "docs/AGENTS.md": "# Live\n\nSee `src/ghost.ts`.\n",
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.parsed!.findings[0].detail, /src\/ghost\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("checks docs/security but not arbitrary dated hand-off records", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "x" }] },
      "docs/2026-01-01-handoff.md": "# Handoff\n\nSee `src/ghost.ts`.\n",
      "docs/security/inventory.md": "# Inventory\n\nSee `src/also-ghost.ts`.\n",
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      const files = [...new Set(r.parsed!.findings.map((f) => f.file))];
      assert.deepEqual(files, ["docs/security/inventory.md"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-staleness: exception entries", () => {
  it("fails on an entry that can never match an advisory", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ severity: "high", title: "t" }] },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("exceptions"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on a duplicate key", () => {
    const dir = fixture({
      "security/audit-exceptions.json": { advisories: [{ id: "dup" }, { id: "dup" }] },
    });
    try {
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.match(r.parsed!.findings[0].detail, /duplicate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not check expiry — that is the supply-chain gate's verdict", () => {
    const dir = fixture({
      "security/audit-exceptions.json": {
        advisories: [{ id: "x", expiry: "1999-01-01" }],
      },
    });
    try {
      assert.equal(run(dir).status, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-staleness: this repository", () => {
  it("is clean at HEAD", () => {
    const r = run(ROOT);
    assert.equal(r.status, 0, r.stdout);
    assert.deepEqual(r.parsed?.findings, []);
  });
});
