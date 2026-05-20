import test from "node:test";
import assert from "node:assert/strict";
import { CommandDiscovery } from "../../src/verification/command-discovery.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";

test("discovers npm test scripts", async () => {
  const testDir = join(tmpdir(), "cmd-test-npm-" + Date.now());
  await mkdir(testDir, { recursive: true });
  await writeFile(join(testDir, "package.json"), JSON.stringify({
    scripts: { test: "jest", "test:unit": "jest --testPathPattern=unit" }
  }));

  const discovery = new CommandDiscovery(testDir);
  const commands = await discovery.findTestCommands();

  assert.ok(commands.some(c => c.name === "test" && c.command === "npm test"));
});

test("finds make targets for C projects", async () => {
  const testDir = join(tmpdir(), "cmd-test-make-" + Date.now());
  await mkdir(testDir, { recursive: true });
  await writeFile(join(testDir, "Makefile"), "test:\n\tmake unit-test\n\nunit-test:\n\t./run_tests.sh");

  const discovery = new CommandDiscovery(testDir);
  const commands = await discovery.findTestCommands();

  assert.ok(commands.some(c => c.name === "test"));
});

test("detects pytest configurations", async () => {
  const testDir = join(tmpdir(), "cmd-test-pytest-" + Date.now());
  await mkdir(testDir, { recursive: true });
  await mkdir(join(testDir, "tests"), { recursive: true });
  await writeFile(join(testDir, "pytest.ini"), "[pytest]\ntestpaths = tests");
  await writeFile(join(testDir, "tests", "test_example.py"), "def test_placeholder(): pass");

  const discovery = new CommandDiscovery(testDir);
  const commands = await discovery.findTestCommands();

  assert.ok(commands.length > 0);
});

test("returns empty for non-test projects", async () => {
  const discovery = new CommandDiscovery("/tmp");
  const commands = await discovery.findTestCommands();
  assert.equal(commands.length, 0);
});