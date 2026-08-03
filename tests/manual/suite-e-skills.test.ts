/**
 * Suite E: Skills installer — install non-bundled skills from real GitHub URLs.
 *
 * Live / network-dependent. Runs only via `pnpm test:manual` (the default
 * node:test run excludes tests/manual/). Verifies the full resolution →
 * fetch → validate → install path against real hosts across several layouts:
 *
 *   - tree URL                  → <path>/SKILL.md
 *   - raw.githubusercontent.com → fetched directly
 *   - repo-root URL + name      → HEAD/skills/<name>/SKILL.md (multi-skill repo)
 *   - marketplace auto-resolve  → HEAD/skills/<name>/SKILL.md via default registry
 *
 * Uses anthropics/skills (brand-guidelines) as a stable, langfuse-independent
 * fixture, plus the langfuse/skills repo for a real-world multi-skill layout.
 * HOME is isolated to a temp dir so the real ~/.alix is never touched.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCli, tempDir, pathExists } from "./run-cli.js";

function installSkill(dir: string, args: string[]): ReturnType<typeof runCli> {
  // Isolate HOME so the skill lands in the temp dir, not the real ~/.alix.
  return runCli(["skills", "install", ...args], { env: { HOME: dir } });
}

function assertInstalled(dir: string, name: string, sourceLabel: string): void {
  assert.ok(
    pathExists(dir, ".alix", "skills", name, "SKILL.md"),
    `expected ${name} to be installed from ${sourceLabel}`,
  );
  const content = readFileSync(`${dir}/.alix/skills/${name}/SKILL.md`, "utf8");
  assert.match(content, /^---\n/, `${name}: SKILL.md should open with YAML frontmatter`);
  assert.match(content, /^name:\s*.+$/m, `${name}: frontmatter should have a name`);
  assert.match(content, /^description:\s*.+$/m, `${name}: frontmatter should have a description`);
}

describe("Suite E: Skills installer — GitHub URL sources", () => {
  // ── E.1: tree URL ─────────────────────────────────────────────
  it("E.1: installs brand-guidelines from a tree URL (anthropics/skills)", () => {
    const d = tempDir();
    try {
      const r = installSkill(d.path, ["--from", "https://github.com/anthropics/skills/tree/main/skills/brand-guidelines"]);
      assert.equal(r.exitCode, 0, r.stderr || r.stdout);
      assert.match(r.stdout, /Installed: brand-guidelines/);
      assertInstalled(d.path, "brand-guidelines", "tree URL");
    } finally { d.cleanup(); }
  });

  // ── E.2: raw.githubusercontent.com URL ─────────────────────────
  it("E.2: installs brand-guidelines from a raw.githubusercontent.com URL", () => {
    const d = tempDir();
    try {
      const r = installSkill(d.path, ["--from", "https://raw.githubusercontent.com/anthropics/skills/main/skills/brand-guidelines/SKILL.md"]);
      assert.equal(r.exitCode, 0, r.stderr || r.stdout);
      assert.match(r.stdout, /Installed: brand-guidelines/);
      assertInstalled(d.path, "brand-guidelines", "raw URL");
    } finally { d.cleanup(); }
  });

  // ── E.3: repo-root URL + name (multi-skill repo layout) ────────
  it("E.3: installs langfuse from repo-root URL + name (langfuse/skills)", () => {
    const d = tempDir();
    try {
      const r = installSkill(d.path, ["langfuse", "--from", "https://github.com/langfuse/skills"]);
      assert.equal(r.exitCode, 0, r.stderr || r.stdout);
      assert.match(r.stdout, /Installed: langfuse/);
      assertInstalled(d.path, "langfuse", "langfuse/skills repo-root URL");
    } finally { d.cleanup(); }
  });

  // ── E.4: helpful error when nothing resolvable ─────────────────
  it("E.4: reports a helpful error when no candidate location has a SKILL.md", () => {
    const d = tempDir();
    try {
      // ALiX repo root has no SKILL.md and no skills/tdd at HEAD, so all
      // candidate locations 404 — but the message must name them.
      const r = installSkill(d.path, ["tdd", "--from", "https://github.com/boduga/ALiX"]);
      assert.notEqual(r.exitCode, 0);
      assert.match(r.stderr, /Could not find a valid SKILL\.md/);
      assert.match(r.stderr, /raw\.githubusercontent\.com/);
    } finally { d.cleanup(); }
  });

  // ── E.5: marketplace auto-resolve (live) ───────────────────────
  it("E.5: auto-resolves brand-guidelines from a registered marketplace", () => {
    const d = tempDir();
    try {
      // No --from: resolves against the default marketplaces (anthropics/skills)
      // via HEAD/skills/brand-guidelines/SKILL.md.
      const r = installSkill(d.path, ["brand-guidelines"]);
      assert.equal(r.exitCode, 0, r.stderr || r.stdout);
      assert.match(r.stdout, /Installed: brand-guidelines/);
      assertInstalled(d.path, "brand-guidelines", "marketplace auto-resolve");
    } finally { d.cleanup(); }
  });
});
