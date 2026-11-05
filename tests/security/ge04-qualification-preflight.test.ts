import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const script = resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/ge04-qualification-preflight.mjs");
// Script lives outside the TypeScript compilation root; import it at runtime.
const qualification = await import(pathToFileURL(script).href);
const { inspectRootOwnedRegularFile, inspectGE04Qualification, GE04_INSTALL_PATHS, GE04_QUALIFICATION_HOLD } = qualification;

test("GE-04 preflight always reports HOLD and eight independent gates", async () => {
  const report = await inspectGE04Qualification();
  assert.equal(report.disposition, "HOLD");
  assert.equal(report.code, GE04_QUALIFICATION_HOLD);
  assert.equal(report.outstanding.length, 8);
  assert.equal(report.paths.length, 4);
  assert.equal("authorized" in report, false);
  assert.equal("ready" in report, false);
  assert.equal("activate" in report, false);
  assert.ok(report.paths.every((path: { permission?: unknown }) => !("permission" in path)));
});

test("all installation paths are fixed, never user supplied", () => {
  assert.deepEqual(Object.keys(GE04_INSTALL_PATHS).sort(), ["executable", "release", "service", "trust"]);
  assert.equal(GE04_INSTALL_PATHS.trust, "/etc/alix/ge04/trust.json");
  assert.equal(GE04_INSTALL_PATHS.release, "/usr/local/lib/alix/ge04/release.json");
  assert.equal(GE04_INSTALL_PATHS.executable, "/usr/local/lib/alix/ge04/supervisor.bin");
});

test("read-only CLI remains denied even if invoked without options or in JSON mode", () => {
  for (const args of [[], ["--json"]]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8", timeout: 8_000,
    });
    assert.equal(result.status, 78, result.stderr);
    if (args.length) {
      const report = JSON.parse(result.stdout);
      assert.equal(report.disposition, "HOLD");
      assert.equal(report.outstanding.length, 8);
    } else assert.match(result.stdout, /SECURITY HOLD ACTIVE/);
  }
});

test("CLI rejects caller-selected trust paths and extra flags", () => {
  for (const args of [["--root", "/tmp"], ["--trust", "/tmp/key.pem"], ["--json", "--override"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", timeout: 8_000 });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /path overrides are prohibited/);
  }
});

test("non-root-owned temporary files cannot establish trusted custody", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ge04-preflight-"));
  try {
    const path = join(dir, "trust.json");
    await writeFile(path, "not trusted");
    const assessment = await inspectRootOwnedRegularFile(path);
    assert.equal(assessment.observed, false);
    assert.ok(["WRITABLE_BY_GROUP_OR_OTHER", "NOT_ROOT_OWNED"].includes(assessment.reason));
    assert.equal((await inspectRootOwnedRegularFile("relative/file")).reason, "INVALID_PATH");
    assert.equal((await inspectRootOwnedRegularFile("/missing/ge04/preflight")).observed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("symlinked file cannot pass read-only preflight", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ge04-symlink-"));
  try {
    const file = join(dir, "file");
    const alias = join(dir, "alias");
    await writeFile(file, "contents");
    await symlink(file, alias);
    assert.equal((await inspectRootOwnedRegularFile(alias)).observed, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("executable symlink alias cannot bypass the mandatory deny exit code", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-ge04-alias-"));
  try {
    const alias = join(dir, "qualification-alias.mjs");
    await symlink(script, alias);
    const result = spawnSync(process.execPath, [alias, "--json"], { encoding: "utf8", timeout: 8_000 });
    assert.equal(result.status, 78, result.stderr);
    assert.equal(JSON.parse(result.stdout).disposition, "HOLD");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
