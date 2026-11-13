// tests/scripts/check-evidence-integrity.test.ts
//
// Pins the verdicts of the evidence-integrity checker, not its implementation.
// Every case builds a throwaway git repository with a real commit sequence and
// asserts that the specific defect produces the specific finding.
//
// This exists because the checker's whole value is that it *can* fail: an
// ordering gate that reports OK over a same-commit artifact is worse than none,
// and the failure mode it guards (edit generator, edit artifact, commit both)
// is exactly the one that makes a green suite meaningless. A test that only
// exercised the clean path would reproduce that silence one level up.
//
// Run: pnpm test:node (compiled to dist/tests/scripts/check-evidence-integrity.test.js)
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the repository root by walking up until the checker is found.
 *
 * The suite runs from `tests/scripts/` in source and `dist/tests/scripts/` when
 * compiled, so a fixed `../..` resolves to `dist/` under the node runner and the
 * spawn fails. Walking up is correct in both.
 */
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, "scripts", "check-evidence-integrity.mjs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate repository root from ${start}`);
}

const ROOT = findRoot(__dirname);
const SCRIPT = join(ROOT, "scripts", "check-evidence-integrity.mjs");
const MANIFEST = "docs/security/evidence-manifest.json";

type FileContents = string | object;

interface Step {
  message: string;
  files: Record<string, FileContents>;
}

interface FindResult {
  status: number | null;
  parsed: {
    ok: boolean;
    verdict: string;
    findings: { check: string; path: string; detail: string }[];
    accepted: { check: string; path: string }[];
    notChecked: string[];
    notCovered: string[];
    recomputeSkipped: number;
    recompute: { generator: string; ok: boolean; skipped?: boolean; reason?: string; detail?: string }[];
  } | null;
  stdout: string;
  stderr: string;
}

const sha256 = (contents: FileContents): string =>
  createHash("sha256")
    .update(typeof contents === "string" ? contents : JSON.stringify(contents, null, 2))
    .digest("hex");

function git(dir: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${dir}: ${result.stderr || result.error}`);
  }
}

/**
 * Build a repository by applying steps in order, one commit each.
 *
 * Commits are real commits on a real graph: ancestry, not timestamps, is what
 * the checker reads, so the fixture has to carry an actual history. A `files`
 * map with an empty object produces a commit with no tree change, which is how
 * a branch-point commit is created when the interesting part happens later.
 */
function repo(steps: Step[]): string {
  const dir = mkdtempSync(join(tmpdir(), "alix-evidence-"));
  git(dir, ["init", "-q", "--initial-branch=main"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Evidence Test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  for (const step of steps) {
    for (const [relPath, contents] of Object.entries(step.files)) {
      const full = join(dir, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents, null, 2));
    }
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "--allow-empty", "-m", step.message]);
  }
  return dir;
}

function run(dir: string, extra: string[] = []): FindResult {
  const result = spawnSync(process.execPath, [SCRIPT, "--root", dir, "--json", ...extra], {
    encoding: "utf-8",
  });
  let parsed: FindResult["parsed"] = null;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // Invocation errors write their payload to stderr; callers assert on status.
  }
  return { status: result.status, parsed, stdout: result.stdout, stderr: result.stderr };
}

const checks = (r: FindResult): string[] => (r.parsed?.findings ?? []).map((f) => f.check);

/** A manifest listing exactly the given artifacts and generators. */
function manifestFor(
  files: Record<string, FileContents>,
  options: {
    artifacts: { path: string; producedBy?: string; describes?: string[]; class?: string; provenance?: string }[];
    generators?: string[];
    exceptions?: object[];
    notCovered?: object[];
    coverage?: string[];
  },
): object {
  const generators =
    options.generators ??
    [...new Set(options.artifacts.map((a) => a.producedBy).filter((p): p is string => Boolean(p)))];
  return {
    $comment: "fixture",
    schemaVersion: 1,
    coverage: options.coverage ?? ["docs/security/*.json"],
    generators: generators.map((path) => ({
      path,
      recompute: false,
      reason: "the fixture generator is an observation recorder and cannot be replayed in a unit test",
    })),
    generatorSha256: Object.fromEntries(generators.map((path) => [path, sha256(files[path])])),
    artifacts: options.artifacts.map((artifact) => ({
      class: artifact.class ?? (artifact.producedBy ? "generator" : "attested"),
      describes: artifact.describes ?? [],
      sha256: sha256(files[artifact.path]),
      ...artifact,
    })),
    exceptions: options.exceptions ?? [],
    notCovered: options.notCovered ?? [],
  };
}

const GEN = "docs/security/gen.mjs";
const ARTIFACT = "docs/security/artifact.json";

/**
 * Healthy order is three commits, not two: generator, then artifact, then its
 * manifest entry. The manifest records a hash of whatever it is committed with,
 * so an artifact and its index in one commit cannot disagree by construction —
 * that pair is exactly what the index rule refuses.
 */
function healthyRepo(extra: Record<string, FileContents> = {}, stepOverrides: Partial<Step> = {}): string {
  const files: Record<string, FileContents> = {
    [GEN]: "console.log('census');\n",
    [ARTIFACT]: { count: 11 },
  };
  return repo([
    { message: "generator", files: { [GEN]: files[GEN] } },
    { message: "artifact", files: { [ARTIFACT]: files[ARTIFACT], ...extra }, ...stepOverrides },
    {
      message: "manifest entry",
      files: {
        [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }),
      },
    },
  ]);
}

function withRepo(steps: Step[], body: (dir: string) => void): void {
  const dir = repo(steps);
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("check-evidence-integrity: healthy history", () => {
  it("passes when the artifact is a strict descendant of its generator", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(r.parsed?.verdict, "pass");
      assert.deepEqual(r.parsed?.findings, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-evidence-integrity: invocation errors", () => {
  it("exits 2 when the manifest is missing", () => {
    withRepo([{ message: "only a generator", files: { [GEN]: "x\n" } }], (dir) => {
      const r = run(dir);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.equal(r.parsed, null);
      assert.match(r.stderr, /manifest not found/);
    });
  });

  it("exits 2 when the root is not a git repository", () => {
    const dir = mkdtempSync(join(tmpdir(), "alix-evidence-nogit-"));
    try {
      mkdirSync(join(dir, "docs", "security"), { recursive: true });
      writeFileSync(join(dir, MANIFEST), JSON.stringify({ schemaVersion: 1 }));
      const r = run(dir);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /git is unavailable/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("exits 2 on a manifest that is not valid JSON", () => {
    withRepo([{ message: "broken", files: { [MANIFEST]: "{ not json" } }], (dir) => {
      assert.equal(run(dir).status, 2);
    });
  });
});

describe("check-evidence-integrity: coverage", () => {
  it("fails on an artifact matched by a coverage glob but absent from the manifest", () => {
    withRepo(
      [
        { message: "generator", files: { [GEN]: "x\n" } },
        {
          message: "artifact plus an unlisted one",
          files: {
            [ARTIFACT]: { count: 11 },
            "docs/security/extra.json": { unreviewed: true },
          },
        },
      ],
      (dir) => {
        const files = { [GEN]: "x\n", [ARTIFACT]: { count: 11 }, "docs/security/extra.json": { unreviewed: true } };
        writeFileSync(join(dir, MANIFEST), JSON.stringify(manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }), null, 2));
        git(dir, ["add", "-A"]);
        git(dir, ["commit", "-q", "-m", "manifest"]);
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("coverage"));
        assert.match(r.parsed!.findings[0].detail, /absent from the manifest/);
      },
    );
  });

  it("fails on a listed artifact missing from disk", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "artifact",
          files: {
            [ARTIFACT]: files[ARTIFACT],
            [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }),
          },
        },
        { message: "delete the artifact", files: {} },
      ],
      (dir) => {
        rmSync(join(dir, ARTIFACT));
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("coverage"));
      },
    );
  });

  it("fails on a notCovered entry with a placeholder reason", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "manifest with a hand-wave exclusion",
          files: {
            [ARTIFACT]: files[ARTIFACT],
            "docs/security/skip.json": { s: 1 },
            [MANIFEST]: manifestFor(files, {
              artifacts: [{ path: ARTIFACT, producedBy: GEN }],
              notCovered: [{ path: "docs/security/skip.json", reason: "n/a" }],
            }),
          },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("coverage"));
        assert.match(r.stdout, /does not explain why/);
      },
    );
  });

  it("accepts a notCovered entry with a real reason and prints it", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "artifact and the excluded file",
          files: { [ARTIFACT]: files[ARTIFACT], "docs/security/skip.json": { s: 1 } },
        },
        {
          message: "manifest with a justified exclusion",
          files: {
            [MANIFEST]: manifestFor(files, {
              artifacts: [{ path: ARTIFACT, producedBy: GEN }],
              notCovered: [
                { path: "docs/security/skip.json", reason: "operator pin recorded before its readers existed; authorization false" },
              ],
            }),
          },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 0, r.stdout);
        assert.equal(r.parsed?.verdict, "pass");
        // The exclusion must be *visible*, not merely tolerated: it is printed on
        // every run so a reader sees the boundary instead of a shorter list.
        assert.ok(r.parsed!.notCovered.some((entry: string) => entry.startsWith("docs/security/skip.json: ")));
      },
    );
  });
});

describe("check-evidence-integrity: content", () => {
  it("fails when the artifact drifts from its pinned hash", () => {
    const dir = healthyRepo();
    try {
      writeFileSync(join(dir, ARTIFACT), JSON.stringify({ count: 12 }, null, 2));
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("content"));
      assert.match(r.stdout, /hash drifted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a generator drifts from its pinned hash", () => {
    const dir = healthyRepo();
    try {
      writeFileSync(join(dir, GEN), "console.log('edited');\n");
      const r = run(dir);
      assert.equal(r.status, 1);
      assert.ok(checks(r).includes("content"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-evidence-integrity: order", () => {
  it("fails when the artifact shares its last commit with the generator", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        {
          message: "generator and artifact together",
          files: {
            ...files,
            [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }),
          },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("order"));
        assert.match(r.stdout, /shared its last commit/);
      },
    );
  });

  it("fails when the artifact is not descended from its generator", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "artifact first", files: { [ARTIFACT]: files[ARTIFACT] } },
        { message: "generator later", files: { [GEN]: files[GEN] } },
        {
          message: "manifest",
          files: { [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }) },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("order"));
        assert.match(r.stdout, /not descended from/);
      },
    );
  });

  it("fails when a described source has no commit history", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "artifact describing an uncommitted path",
          files: {
            [ARTIFACT]: files[ARTIFACT],
            "docs/security/source.json": { s: 1 },
            [MANIFEST]: manifestFor(files, {
              artifacts: [{ path: ARTIFACT, producedBy: GEN, describes: ["docs/security/source.json"] }],
            }),
          },
        },
        { message: "commit the source after the artifact", files: {} },
      ],
      (dir) => {
        rmSync(join(dir, "docs/security/source.json"));
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("order"));
      },
    );
  });

  it("reports an uncommitted artifact as not_checked under --pending-commit-tolerant", () => {
    const dir = healthyRepo();
    try {
      const files: Record<string, FileContents> = {
        [GEN]: "console.log('census');\n",
        [ARTIFACT]: { count: 11 },
        "docs/security/late.json": { late: true },
      };
      // Listed so this reaches the order question rather than failing coverage,
      // and left uncommitted so there is no `lastCommit` to compare against.
      writeFileSync(join(dir, "docs/security/late.json"), JSON.stringify(files["docs/security/late.json"], null, 2));
      writeFileSync(
        join(dir, MANIFEST),
        JSON.stringify(
          manifestFor(files, {
            artifacts: [
              { path: ARTIFACT, producedBy: GEN },
              {
                path: "docs/security/late.json",
                class: "attested",
                provenance: "recorded by hand during the fixture setup",
                // Order is only asked about a file that has an edge to compare.
                describes: [GEN],
              },
            ],
          }),
          null,
          2,
        ),
      );

      const strict = run(dir);
      assert.equal(strict.status, 1, strict.stdout);
      assert.match(strict.stdout, /is not committed/);

      // A downgraded verdict is still not a verified one: `not_checked` now
      // exits 1 so a caller cannot read "we skipped the order check" as green.
      const tolerant = run(dir, ["--pending-commit-tolerant"]);
      assert.equal(tolerant.status, 1, tolerant.stdout);
      assert.equal(tolerant.parsed?.verdict, "not_checked");
      assert.ok(tolerant.parsed!.notChecked.some((reason) => /uncommitted/.test(reason)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-evidence-integrity: self-recorded markers", () => {
  it("fails when a marker names a commit that does not exist", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n" };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "artifact with a fabricated marker",
          files: {
            [ARTIFACT]: { sourceCommit: "0123456789abcdef0123456789abcdef01234567" },
            [MANIFEST]: manifestFor({ ...files, [ARTIFACT]: { sourceCommit: "0123456789abcdef0123456789abcdef01234567" } }, {
              artifacts: [{ path: ARTIFACT, producedBy: GEN }],
            }),
          },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("markers"));
        assert.match(r.stdout, /not a commit/);
      },
    );
  });

  it("fails when a marker names a commit that is not an ancestor of the artifact", () => {
    // A marker is allowed to be old; it is not allowed to name a commit the
    // artifact does not descend from, because that records a state that is not
    // in this artifact's history. A sibling branch produces exactly that.
    withRepo(
      [
        { message: "generator", files: { [GEN]: "x\n" } },
        { message: "side state", files: { "docs/security/side.json": { s: 1 } } },
      ],
      (dir) => {
        const side = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
        git(dir, ["checkout", "-q", "-B", "main", "HEAD~1"]);
        const artifact = { sourceCommit: side };
        writeFileSync(join(dir, ARTIFACT), JSON.stringify(artifact, null, 2));
        writeFileSync(
          join(dir, MANIFEST),
          JSON.stringify(
            manifestFor({ [GEN]: "x\n", [ARTIFACT]: artifact }, {
              artifacts: [{ path: ARTIFACT, producedBy: GEN }],
              coverage: [ARTIFACT],
            }),
            null,
            2,
          ),
        );
        git(dir, ["add", "-A"]);
        git(dir, ["commit", "-q", "-m", "artifact naming a sibling-branch commit"]);
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("markers"));
        assert.match(r.stdout, /not an ancestor/);
      },
    );
  });

  it("passes when a marker is a genuine ancestor of the artifact commit", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n" };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        { message: "source state", files: { "docs/security/source.json": { s: 1 } } },
        { message: "filler", files: {} },
      ],
      (dir) => {
        const ancestor = spawnSync("git", ["rev-parse", "HEAD~1"], { cwd: dir, encoding: "utf8" }).stdout.trim();
        const artifact = { sourceCommit: ancestor };
        writeFileSync(join(dir, ARTIFACT), JSON.stringify(artifact, null, 2));
        git(dir, ["add", "-A"]);
        git(dir, ["commit", "-q", "-m", "artifact naming an ancestor"]);
        writeFileSync(
          join(dir, MANIFEST),
          JSON.stringify(
            manifestFor({ ...files, [ARTIFACT]: artifact }, {
            artifacts: [{ path: ARTIFACT, producedBy: GEN }],
            coverage: [ARTIFACT],
          }),
            null,
            2,
          ),
        );
        git(dir, ["add", "-A"]);
        git(dir, ["commit", "-q", "-m", "manifest entry"]);
        const r = run(dir);
        assert.equal(r.status, 0, r.stdout);
      },
    );
  });
});

describe("check-evidence-integrity: index ordering", () => {
  it("fails when an artifact and its manifest entry share a commit", () => {
    // The manifest's sha256 is computed from whatever is on disk when it is
    // written, so this pair agrees by construction. That is the same
    // self-consistency the generator rule refuses, one level up.
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "artifact and its index together",
          files: {
            [ARTIFACT]: files[ARTIFACT],
            [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }),
          },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("index"));
        assert.match(r.stdout, /indexed in the same commit/);
      },
    );
  });

  it("fails when the artifact moved in a commit the manifest does not descend from", () => {
    // The honest case this rule exists for: a healthy three-commit history,
    // then the artifact is edited again and the manifest is NOT updated. The
    // manifest now indexes a state that is not an ancestor of its own commit,
    // so it is describing a past this history never had. A side branch would
    // also trip coverage, so the fixture keeps a linear history and lets the
    // ancestor comparison alone produce the finding.
    const dir = healthyRepo();
    try {
      writeFileSync(join(dir, ARTIFACT), JSON.stringify({ count: 12 }, null, 2));
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "-m", "artifact changed without reindexing"]);
      const r = run(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(checks(r).includes("index"), r.stdout);
      assert.match(r.stdout, /not an ancestor/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-evidence-integrity: reflexivity", () => {
  it("fails when the checker and the manifest share a commit", () => {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        { message: "artifact", files: { [ARTIFACT]: files[ARTIFACT] } },
        {
          message: "rule and data edited together",
          files: {
            "scripts/check-evidence-integrity.mjs": "// fixture copy\n",
            [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }),
          },
        },
      ],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("reflexivity"));
      },
    );
  });
});

describe("check-evidence-integrity: exceptions", () => {
  /** Build a same-commit-order repo and return the commit SHAs an exception needs. */
  function sameCommitRepo(): string {
    const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
    const dir = repo([
      {
        message: "generator and artifact together",
        files: { ...files, [MANIFEST]: manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }) },
      },
    ]);
    return dir;
  }

  it("accepts a defect pinned to the exact commits and stays shrink-only", () => {
    const dir = sameCommitRepo();
    try {
      const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
      const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
      writeFileSync(
        join(dir, MANIFEST),
        JSON.stringify(
          manifestFor(files, {
            artifacts: [{ path: ARTIFACT, producedBy: GEN }],
            exceptions: [
              {
                artifact: ARTIFACT,
                check: "order",
                relation: "its generator",
                subject: GEN,
                artifactCommit: head,
                subjectCommit: head,
                reason: "fixture: the first artifact landed beside its generator before this contract existed",
              },
            ],
          }),
          null,
          2,
        ),
      );
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "-m", "pin the historical defect"]);
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout);
      assert.equal(r.parsed?.verdict, "pass_with_accepted");
      assert.equal(r.parsed?.accepted.length, 1);

      assert.equal(run(dir, ["--max-accepted", "1"]).status, 0);
      assert.equal(run(dir, ["--max-accepted", "0"]).status, 1);
      assert.equal(run(dir, ["--max-accepted", "2"]).status, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on an exception without a full 40-character pin", () => {
    const dir = sameCommitRepo();
    try {
      const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
      const files: Record<string, FileContents> = { [GEN]: "x\n", [ARTIFACT]: { a: 1 } };
      writeFileSync(
        join(dir, MANIFEST),
        JSON.stringify(
          manifestFor(files, {
            artifacts: [{ path: ARTIFACT, producedBy: GEN }],
            exceptions: [
              { artifact: ARTIFACT, check: "order", relation: "its generator", subject: GEN, artifactCommit: head.slice(0, 12), reason: "short pin" },
            ],
          }),
          null,
          2,
        ),
      );
      const r = run(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(checks(r).includes("exceptions"));
      assert.match(r.stdout, /full 40-character/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when an exception matches no finding (stale ledger)", () => {
    const dir = healthyRepo();
    try {
      const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
      const files: Record<string, FileContents> = { [GEN]: "console.log('census');\n", [ARTIFACT]: { count: 11 } };
      writeFileSync(
        join(dir, MANIFEST),
        JSON.stringify(
          manifestFor(files, {
            artifacts: [{ path: ARTIFACT, producedBy: GEN }],
            exceptions: [
              {
                artifact: ARTIFACT,
                check: "order",
                relation: "its generator",
                subject: GEN,
                artifactCommit: head,
                subjectCommit: head,
                reason: "a defect that never existed in this history",
              },
            ],
          }),
          null,
          2,
        ),
      );
      git(dir, ["add", "-A"]);
      git(dir, ["commit", "-q", "-m", "stale exception"]);
      const r = run(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(checks(r).includes("exceptions"));
      assert.match(r.stdout, /matched no current finding/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to except a current-tree check", () => {
    const dir = healthyRepo();
    try {
      const files: Record<string, FileContents> = { [GEN]: "console.log('census');\n", [ARTIFACT]: { count: 11 } };
      writeFileSync(
        join(dir, MANIFEST),
        JSON.stringify(
          manifestFor(files, {
            artifacts: [{ path: ARTIFACT, producedBy: GEN }],
            exceptions: [
              { artifact: ARTIFACT, check: "content", artifactCommit: "a".repeat(40), reason: "launder a drift" },
            ],
          }),
          null,
          2,
        ),
      );
      const r = run(dir);
      assert.equal(r.status, 1, r.stdout);
      assert.match(r.stdout, /must be fixed, not excepted/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-evidence-integrity: recompute", () => {
  it("fails when a generator reports drift", () => {
    const files: Record<string, FileContents> = {
      [GEN]: "process.exit(1);\n",
      [ARTIFACT]: { a: 1 },
    };
    withRepo(
      [
        { message: "generator", files: { [GEN]: files[GEN] } },
        {
          message: "artifact",
          files: {
            [ARTIFACT]: files[ARTIFACT],
            [MANIFEST]: {
              ...(manifestFor(files, { artifacts: [{ path: ARTIFACT, producedBy: GEN }] }) as object),
              generators: [GEN],
            },
          },
        },
      ],
      (dir) => {
        const r = run(dir, ["--recompute"]);
        assert.equal(r.status, 1, r.stdout);
        assert.ok(checks(r).includes("recompute"));
      },
    );
  });

  it("never reports a pass when every generator is declared not recomputable", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--recompute"]);
      assert.equal(r.status, 1, r.stdout);
      assert.equal(r.parsed?.verdict, "not_checked");
      assert.equal(r.parsed?.recomputeSkipped, 1);
      const recompute = r.parsed!.recompute;
      assert.equal(recompute.length, 1);
      assert.equal(recompute[0].reason, "declared-not-recomputable");
      assert.ok(r.parsed!.notChecked.some((reason) => /declared not recomputable/.test(reason)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the honest not_checked verdict when the skip count matches its pin", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--recompute", "--max-recompute-skipped", "1"]);
      assert.equal(r.status, 1, r.stdout);
      assert.equal(r.parsed?.verdict, "not_checked");
      assert.equal(r.parsed?.recomputeSkipped, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("acknowledges a bounded declared-skip set as a distinct verdict", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--recompute", "--max-recompute-skipped", "1", "--allow-declared-skips"]);
      assert.equal(r.status, 0, r.stdout);
      assert.equal(r.parsed?.verdict, "pass_with_declared_skips");
      assert.equal(r.parsed?.ok, true);
      assert.equal(r.parsed?.recomputeSkipped, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses --allow-declared-skips without a bounded skip set", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--recompute", "--allow-declared-skips"]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /requires --max-recompute-skipped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not acknowledge away a real finding alongside a declared skip", () => {
    // The acknowledgement exists for a bounded absence, never for a defect.
    // Before the verdict guard, a content-hash drift plus the one declared skip
    // was rewritten from `fail` to `pass_with_declared_skips`: the flag meant to
    // tighten the gate disabled it.
    const dir = healthyRepo();
    try {
      writeFileSync(join(dir, ARTIFACT), JSON.stringify({ a: 2 }));
      const r = run(dir, ["--recompute", "--max-recompute-skipped", "1", "--allow-declared-skips"]);
      assert.equal(r.status, 1, r.stdout);
      assert.equal(r.parsed?.verdict, "fail");
      assert.equal(r.parsed?.ok, false);
      assert.ok(checks(r).length > 0, "the finding must still be reported");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not acknowledge a not_checked reason that is not a declared skip", () => {
    // An empty manifest is a different absence from a generator declaring
    // itself non-reproducible. The acknowledgement must not absorb it: the pin
    // matches (zero skipped), but the vacuous-order reason still fails closed.
    withRepo(
      [{ message: "manifest with no artifacts", files: { [MANIFEST]: { schemaVersion: 1, coverage: [], artifacts: [] } } }],
      (dir) => {
        const r = run(dir, ["--recompute", "--max-recompute-skipped", "0", "--allow-declared-skips"]);
        assert.equal(r.parsed?.verdict, "not_checked", r.stdout);
        assert.equal(r.status, 1, r.stdout);
        assert.equal(r.parsed?.ok, false);
        assert.match(r.stdout, /order vacuous/);
      },
    );
  });

  it("fails when more generators are declared not recomputable than the pin allows", () => {
    // The invisible edit this prevents: mark a reproducible generator
    // `recompute: false` and the recompute step quietly stops checking it.
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--recompute", "--max-recompute-skipped", "0"]);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(checks(r).includes("recompute"));
      assert.match(r.stdout, /skip set is shrink-only/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when the skip count drops below its pin so the ratchet tightens", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--recompute", "--max-recompute-skipped", "2"]);
      assert.equal(r.status, 1, r.stdout);
      assert.ok(checks(r).includes("recompute"));
      assert.match(r.stdout, /lower --max-recompute-skipped/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses the skip pin without --recompute", () => {
    const dir = healthyRepo();
    try {
      const r = run(dir, ["--max-recompute-skipped", "1"]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /requires --recompute/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("check-evidence-integrity: empty manifest", () => {
  it("reports not_checked rather than passing when there is nothing to compare", () => {
    withRepo(
      [{ message: "manifest with no artifacts", files: { [MANIFEST]: { schemaVersion: 1, coverage: [], artifacts: [] } } }],
      (dir) => {
        const r = run(dir);
        assert.equal(r.status, 1, r.stdout);
        assert.equal(r.parsed?.verdict, "not_checked");
        assert.match(r.stdout, /order vacuous/);
      },
    );
  });
});
