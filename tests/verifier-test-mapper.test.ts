// tests/verifier-test-mapper.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { mapFilesToTests } from "../src/verifier/test-mapper.js";

describe("mapFilesToTests", () => {
  it("maps src file to matching test file", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-mapper-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "src", "auth.ts"), "// source");
    await writeFile(join(root, "src", "user.ts"), "// source");
    await writeFile(join(root, "tests", "auth.test.ts"), "// test");
    await writeFile(join(root, "tests", "user.test.ts"), "// test");

    const checks = mapFilesToTests(root, ["src/auth.ts", "src/user.ts"]);
    const commands = checks.map(c => c.command);
    assert.ok(commands.some(c => c.includes("auth")), "should include auth test");
    assert.ok(commands.some(c => c.includes("user")), "should include user test");
  });

  it("falls back to full test suite when no specific match", async () => {
    const root = await mkdtemp(join(tmpdir(), "test-mapper-"));
    await mkdir(join(root, "src"), { recursive: true });
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(join(root, "src", "unknown-file.ts"), "// source");
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { test: "npm test" } }));

    const checks = mapFilesToTests(root, ["src/unknown-file.ts"]);
    assert.strictEqual(checks.length, 1);
    assert.ok(checks[0].command.includes("npm test"));
  });
});
