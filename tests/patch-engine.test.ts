import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditFormatPolicy, defaultEditFormatForProvider } from "../src/patch/edit-format-policy.js";
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

test("search replace writes replacement text literally when it contains dollar sequences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const value = 'old';\n");
    await applyPatch(
      dir,
      "search_replace",
      "<<<<<<< SEARCH path=src/a.ts\nconst value = 'old';\n=======\nconst value = '$&';\n>>>>>>> REPLACE"
    );
    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const value = '$&';\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects ambiguous search replace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\nconst a = 1;\n");
    await assert.rejects(
      () =>
        applyPatch(
          dir,
          "search_replace",
          "<<<<<<< SEARCH path=src/a.ts\nconst a = 1;\n=======\nconst a = 2;\n>>>>>>> REPLACE"
        ),
      /ambiguous/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("search replace validates all blocks before writing any file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    await writeFile(join(dir, "src/b.ts"), "const b = 1;\n");

    await assert.rejects(
      () =>
        applyPatch(
          dir,
          "search_replace",
          [
            "<<<<<<< SEARCH path=src/a.ts",
            "const a = 1;",
            "=======",
            "const a = 2;",
            ">>>>>>> REPLACE",
            "<<<<<<< SEARCH path=src/b.ts",
            "const missing = true;",
            "=======",
            "const b = 2;",
            ">>>>>>> REPLACE"
          ].join("\n")
        ),
      /Search block not found/
    );

    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const a = 1;\n");
    assert.equal(await readFile(join(dir, "src/b.ts"), "utf8"), "const b = 1;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects path traversal in search replace", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await assert.rejects(
      () =>
        applyPatch(
          dir,
          "search_replace",
          "<<<<<<< SEARCH path=../outside.ts\nold\n=======\nnew\n>>>>>>> REPLACE"
        ),
      /outside workspace|Path is unsafe/
    );
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

test("creates parent directories for structured create", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    const patch = JSON.stringify({
      version: 1,
      files: [{ path: "src/new/file.ts", operation: "create", content: "export const value = 1;\n" }]
    });
    const result = await applyPatch(dir, "structured_patch", patch);
    assert.deepEqual(result.changedFiles, ["src/new/file.ts"]);
    assert.equal(await readFile(join(dir, "src/new/file.ts"), "utf8"), "export const value = 1;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("structured patch validates all file preimages before writing any file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    await writeFile(join(dir, "src/b.ts"), "const b = 1;\n");
    const patch = JSON.stringify({
      version: 1,
      files: [
        { path: "src/a.ts", operation: "modify", preimageHash: sha256("const a = 1;\n"), content: "const a = 2;\n" },
        { path: "src/b.ts", operation: "modify", preimageHash: sha256("stale"), content: "const b = 2;\n" }
      ]
    });

    await assert.rejects(() => applyPatch(dir, "structured_patch", patch), /Preimage validation failed/);

    assert.equal(await readFile(join(dir, "src/a.ts"), "utf8"), "const a = 1;\n");
    assert.equal(await readFile(join(dir, "src/b.ts"), "utf8"), "const b = 1;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("structured delete actually removes file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await mkdir(join(dir, "src"));
    await writeFile(join(dir, "src/a.ts"), "const a = 1;\n");
    const patch = JSON.stringify({ version: 1, files: [{ path: "src/a.ts", operation: "delete" }] });
    const result = await applyPatch(dir, "structured_patch", patch);
    assert.equal(result.status, "applied");
    assert.ok(!(await existsSync(join(dir, "src/a.ts"))));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects no-op search replace patch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await assert.rejects(() => applyPatch(dir, "search_replace", ""), /No patch changes found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects unsupported full file format", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await assert.rejects(() => applyPatch(dir, "full_file", "content"), /Unsupported edit format/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("applies a unified diff (modify)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await writeFile(join(dir, "a.ts"), "const x = 1;\n");
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-const x = 1;\n+const x = 2;\n";
    const result = await applyPatch(dir, "unified_diff", patch);
    assert.equal(result.status, "applied");
    assert.deepEqual(result.changedFiles, ["a.ts"]);
    assert.equal(await readFile(join(dir, "a.ts"), "utf8"), "const x = 2;\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("creates and deletes files via unified diff /dev/null", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await writeFile(join(dir, "old.ts"), "gone\n");
    const create = "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1,1 @@\n+fresh\n";
    assert.equal((await applyPatch(dir, "unified_diff", create)).status, "applied");
    assert.equal(await readFile(join(dir, "new.ts"), "utf8"), "fresh\n");
    const del = "--- a/old.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-gone\n";
    assert.equal((await applyPatch(dir, "unified_diff", del)).status, "applied");
    assert.equal(existsSync(join(dir, "old.ts")), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects a conflicting unified diff", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await writeFile(join(dir, "a.ts"), "const x = 1;\n");
    const patch = "--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,1 @@\n-const x = 999;\n+const x = 2;\n";
    await assert.rejects(() => applyPatch(dir, "unified_diff", patch), /conflict/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizes aider *** Begin Patch text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "alix-patch-"));
  try {
    await writeFile(join(dir, "a.ts"), "old\n");
    const patch = "*** Begin Patch\n*** Update File: a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n*** End Patch";
    const result = await applyPatch(dir, "unified_diff", patch);
    assert.equal(result.status, "applied");
    assert.equal(await readFile(join(dir, "a.ts"), "utf8"), "new\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("google provider defaults to search replace", () => {
  assert.equal(defaultEditFormatForProvider("google"), "search_replace");
});

test("buildEditFormatPolicy uses provider preference as the preferred allowed format", () => {
  const policy = buildEditFormatPolicy({ provider: "openai", preferred: "structured_patch" });

  assert.equal(policy.provider, "openai");
  assert.equal(policy.preferred, "structured_patch");
  assert.deepEqual(policy.allowed, ["structured_patch", "search_replace"]);
  assert.equal(policy.fullFileRewrite, "deny");
});

test("buildEditFormatPolicy keeps Gemini on search_replace even with explicit provider policy", () => {
  const policy = buildEditFormatPolicy({ provider: "google", preferred: "structured_patch" });

  assert.equal(policy.preferred, "search_replace");
  assert.deepEqual(policy.allowed, ["search_replace", "structured_patch"]);
});

test("buildEditFormatPolicy falls back to search_replace for unsafe full_file preference", () => {
  const policy = buildEditFormatPolicy({ provider: "local", preferred: "full_file" });

  assert.equal(policy.preferred, "search_replace");
  assert.deepEqual(policy.allowed, ["search_replace", "structured_patch"]);
  assert.equal(policy.fullFileRewrite, "deny");
});

test("buildEditFormatPolicy does not allow unsupported unified_diff until engine supports it", () => {
  const policy = buildEditFormatPolicy({ provider: "custom", preferred: "unified_diff" });

  assert.equal(policy.preferred, "structured_patch");
  assert.deepEqual(policy.allowed, ["structured_patch", "search_replace"]);
});
