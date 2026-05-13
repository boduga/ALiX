import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultEditFormatForProvider } from "../src/patch/edit-format-policy.js";
import { applyPatch, sha256 } from "../src/patch/patch-engine.js";

test("applies exact search replace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    await applyPatch(
      dir,
      "search_replace",
      "<<<<<<< SEARCH path=src/a.ts\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE"
    );
    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const a = 2;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects stale structured patch preimage", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const patch = JSON.stringify({
      version: 1,
      files: [{ path: "src/a.ts", operation: "modify", preimageHash: sha256("old"), content: "const a = 2;\n" }]
    });
    await assert.rejects(() => applyPatch(dir, "structured_patch", patch), /Preimage validation failed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("google provider defaults to search replace", () => {
  assert.equal(defaultEditFormatForProvider("google"), "search_replace");
});
