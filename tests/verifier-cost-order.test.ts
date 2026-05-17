import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { discoverVerification } from "../src/verifier/verifier.js";

test("orders typecheck before build before test", async () => {
    const root = await mkdtemp(join(tmpdir(), "cost-order-"));
    await writeFile(join(root, "package.json"), JSON.stringify({
      scripts: {
        "test": "echo test",
        "build": "echo build",
        "typecheck": "echo typecheck",
        "lint": "echo lint"
      }
    }, null, 2));

    const checks = await discoverVerification(root);
    const names = checks.map(c => {
      if (c.command.includes("typecheck") || c.command.includes("lint")) return "typecheck";
      if (c.command.includes("build")) return "build";
      return "test";
    });

    // First non-typecheck must come after all typechecks
    const firstNonTypecheck = names.indexOf("build") !== -1 ? names.indexOf("build") : names.indexOf("test");
    const lastTypecheck = names.lastIndexOf("typecheck");
    assert.ok(lastTypecheck < firstNonTypecheck, `typecheck should come before build/test. Got: ${names.join(", ")}`);

    const buildIdx = names.indexOf("build");
    const testIdx = names.indexOf("test");
    if (buildIdx !== -1 && testIdx !== -1) {
      assert.ok(buildIdx < testIdx, `build should come before test. Got: ${names.join(", ")}`);
    }
  });