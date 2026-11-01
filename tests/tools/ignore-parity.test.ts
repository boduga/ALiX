/**
 * Ignore-decision parity table.
 *
 * `isIgnoredPath` decides which workspace paths the content search, filename
 * search, and RepoMap walks skip. It is built on `minimatch`, so an upstream
 * matcher upgrade can change what the search surface ignores without touching
 * a line of ALiX code.
 *
 * That happened as a live risk in the minimatch 10 -> 11 upgrade: v11 changed
 * `**` handling, and `ignore.ts` builds a `${pattern}/**` rule for every
 * directory pattern. A behavioural drift there would not fail a typecheck — it
 * would quietly start returning ignored files (including `.env`-class paths)
 * in search results.
 *
 * This table pins the expected outcome for each case independently of the
 * matcher version, so an upgrade that changes behaviour fails here instead of
 * silently widening what search sees.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isIgnoredPath, IGNORED_DIRS } from "../../src/capabilities/tools/ignore.js";

type Case = {
  pattern: string;
  path: string;
  ignored: boolean;
  why: string;
};

const CASES: Case[] = [
  // Directory patterns must also ignore their contents (the `${p}/**` branch).
  { pattern: "node_modules", path: "node_modules/pkg/index.js", ignored: true, why: "directory pattern ignores contents" },
  { pattern: "node_modules", path: "node_modules", ignored: true, why: "directory pattern matches itself" },
  { pattern: "dist", path: "dist/cli.js", ignored: true, why: "directory pattern ignores contents" },
  { pattern: "secrets", path: "secrets/key.pem", ignored: true, why: "directory pattern ignores contents" },

  // Trailing slash is stripped before matching.
  { pattern: "build/", path: "build/out.js", ignored: true, why: "trailing slash stripped" },
  { pattern: "build/", path: "build", ignored: true, why: "trailing slash stripped, self-match" },

  // `dot: true` is set, so dotfiles are matchable.
  { pattern: ".env", path: ".env", ignored: true, why: "literal dotfile pattern" },
  { pattern: ".alix", path: ".alix/state.json", ignored: true, why: "dot-directory ignores contents" },
  { pattern: ".git", path: ".git/config", ignored: true, why: "dot-directory ignores contents" },

  // `dot: true` only discriminates when a WILDCARD has to cross a leading dot:
  // a literal ".env" pattern matches ".env" either way. Without `dot: true`
  // these two fall through and dotfiles become visible to search.
  { pattern: "*", path: ".env", ignored: true, why: "wildcard must match a leading dot" },
  { pattern: "**/*.log", path: ".hidden/debug.log", ignored: true, why: "recursive wildcard must cross a dot-directory" },
  { pattern: "**", path: ".config/settings.json", ignored: true, why: "recursive wildcard must cross a dot-directory" },

  // Explicit globs.
  { pattern: "*.log", path: "debug.log", ignored: true, why: "glob matches basename at root" },
  { pattern: "**/*.log", path: "logs/deep/debug.log", ignored: true, why: "recursive glob" },
  { pattern: "secrets/**", path: "secrets/key.pem", ignored: true, why: "explicit recursive glob" },
  { pattern: "**/*.test.ts", path: "src/a.test.ts", ignored: true, why: "recursive suffix glob" },
  { pattern: "*.{md,txt}", path: "notes.md", ignored: true, why: "brace expansion" },

  // Non-matches must stay visible to search.
  { pattern: "*.log", path: "src/index.ts", ignored: false, why: "unrelated extension" },
  { pattern: "dist", path: "src/dist-helper.ts", ignored: false, why: "prefix is not a path match" },
  { pattern: "secrets", path: "src/secrets-notes.md", ignored: false, why: "prefix is not a path match" },
  { pattern: "**/*.test.ts", path: "src/index.ts", ignored: false, why: "suffix glob does not over-match" },
];

test("isIgnoredPath parity table", () => {
  for (const c of CASES) {
    assert.equal(
      isIgnoredPath(c.path, [c.pattern]),
      c.ignored,
      `pattern ${JSON.stringify(c.pattern)} vs ${JSON.stringify(c.path)} — ${c.why}`
    );
  }
});

test("isIgnoredPath: no patterns ignores nothing", () => {
  assert.equal(isIgnoredPath(".env", []), false);
  assert.equal(isIgnoredPath("node_modules/pkg/index.js", []), false);
});

test("isIgnoredPath: any matching pattern in the list wins", () => {
  const patterns = ["*.log", "node_modules", "secrets"];
  assert.equal(isIgnoredPath("debug.log", patterns), true);
  assert.equal(isIgnoredPath("node_modules/x/y.js", patterns), true);
  assert.equal(isIgnoredPath("secrets/key.pem", patterns), true);
  assert.equal(isIgnoredPath("src/index.ts", patterns), false);
});

test("isIgnoredPath: blank and comment-like patterns are inert", () => {
  // loadGitignore drops these, but a caller-supplied list must not let an
  // empty pattern match everything.
  assert.equal(isIgnoredPath("src/index.ts", ["", "   "]), false);
});

test("every IGNORED_DIRS entry ignores its own contents", () => {
  // IGNORED_DIRS is enforced by the walk itself, not by isIgnoredPath, but the
  // two must agree on the security-relevant decision: a directory in this set
  // is never traversed, so nothing beneath it is reachable.
  for (const dir of IGNORED_DIRS) {
    assert.equal(
      isIgnoredPath(`${dir}/some/file.ts`, [dir]),
      true,
      `${dir} contents must be ignored`
    );
  }
});
