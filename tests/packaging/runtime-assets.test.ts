import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packaging guard: the published tarball's `files` allowlist includes `dist/`,
 * so every runtime data asset that `copy-build-artifacts.mjs` is responsible
 * for must exist under `dist/` after a build. Data files that tsc never emits
 * (JSON patterns, profiles, SQL migrations, template .md) silently vanish from
 * the package if that copier regresses.
 *
 * Node tests run after `pnpm build` (see CI), so `dist/` is present here.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
// TS compiles tests/ → dist/tests/ so __dirname is dist/tests/packaging.
const DIST = resolve(__dirname, "../../"); // dist/

function assertHasFiles(dir: string, ext: string, label: string): void {
  assert.ok(existsSync(dir), `${label}: missing directory ${dir}`);
  const files = readdirSync(dir).filter((f) => f.endsWith(ext));
  assert.ok(files.length > 0, `${label}: no ${ext} files under ${dir}`);
}

describe("packaged runtime assets exist under dist/", () => {
  it("ships tool-repair model patterns (PatternRegistry.loadModel data)", () => {
    assertHasFiles(
      resolve(DIST, "packages/tool-repair/src/patterns"),
      ".json",
      "tool-repair patterns",
    );
  });

  it("ships config profiles", () => {
    assertHasFiles(resolve(DIST, "src/operations/config/profiles"), ".json", "config profiles");
  });

  it("ships DB migrations", () => {
    assertHasFiles(resolve(DIST, "src/operations/db/migrations"), ".sql", "db migrations");
  });

  it("ships refine-strategy templates", () => {
    assertHasFiles(
      resolve(DIST, "src/execution/run/task-loop/refine-strategies"),
      ".md",
      "refine strategies",
    );
  });

  it("ships the Inspector UI assets", () => {
    for (const f of ["index.html", "app.js", "projection.js", "styles.css"]) {
      assert.ok(existsSync(resolve(DIST, "src/interfaces/ui", f)), `missing UI asset ${f}`);
    }
  });
});
