import { describe, it } from "node:test";
import assert from "node:assert";
import { PatchParser, normalizeAiderFormat } from "../../src/patch/patch-parser.js";

describe("PatchParser", () => {
  it("parses unified diff format", () => {
    const parser = new PatchParser();
    const patch = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 3;`;

    const parsed = parser.parse(patch, "unified");
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.files[0].hunks.length, 1);
  });

  it("handles CRLF line endings", () => {
    const parser = new PatchParser();
    const patch = "--- a/file.ts\r\n+++ b/file.ts\r\n@@ -1 +1 @@\r\n-old\r\n+new";
    const parsed = parser.parse(patch, "unified");
    // Parser should normalize CRLF internally and indicate normalization
    assert.equal(parsed.normalized, true);
  });

  it("extracts metadata from patch header", () => {
    const parser = new PatchParser();
    const patch = `--- a/src/main.ts
+++ b/src/main.ts
@@ -5,7 +5,7 @@
 function test() {`;

    const parsed = parser.parse(patch, "unified");
    assert.equal(parsed.files[0].oldPath, "src/main.ts");
    assert.equal(parsed.files[0].newPath, "src/main.ts");
  });

  it("serializes parsed patch back to unified format", () => {
    const parser = new PatchParser();
    const parsed: import("../../src/patch/patch-parser.js").ParsedPatch = {
      files: [{
        oldPath: "file.ts",
        newPath: "file.ts",
        hunks: [{
          oldStart: 1, oldLines: 3,
          newStart: 1, newLines: 3,
          lines: [
            { type: "context", content: "const a = 1;" },
            { type: "delete", content: "const b = 2;" },
            { type: "add", content: "const b = 3;" },
            { type: "context", content: "const c = 3;" },
          ]
        }]
      }],
      raw: "",
      normalized: false,
    };
    const output = parser.serialize(parsed);
    assert.ok(output.includes("--- a/file.ts"));
    assert.ok(output.includes("+const b = 3;"));
  });

  it("normalizeAiderFormat converts *** Update File header to unified diff headers", () => {
    const input = [
      "*** Begin Patch",
      "*** Update File: src/foo.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      "*** End Patch",
    ].join("\n");
    assert.equal(
      normalizeAiderFormat(input),
      "--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1,2 +1,2 @@\n-old\n+new"
    );
  });

  it("normalizeAiderFormat converts *** Add File / Delete File headers", () => {
    const add = normalizeAiderFormat("*** Add File: a.ts\n@@ -0,0 +1,1 @@\n+hi");
    assert.ok(add.startsWith("--- /dev/null\n+++ b/a.ts\n"));
    const del = normalizeAiderFormat("*** Delete File: b.ts\n@@ -1,1 +0,0 @@\n-gone");
    assert.ok(del.startsWith("--- a/b.ts\n+++ /dev/null\n"));
  });

  it("normalizeAiderFormat passes through non-aider text unchanged", () => {
    const plain = "--- a/x.ts\n+++ b/x.ts\n@@ -1,1 +1,1 @@\n-a\n+b";
    assert.equal(normalizeAiderFormat(plain), plain);
  });
});