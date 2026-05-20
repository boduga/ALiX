import { describe, it } from "node:test";
import assert from "node:assert";
import { StructuredPatchApplier } from "../../src/patch/structured-patch-applier.js";

describe("StructuredPatchApplier", () => {
  it("applies valid unified diff", () => {
    const applier = new StructuredPatchApplier();
    const original = "line1\nline2\nline3\n";
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
 line1
-line2
+modified
 line3
`;

    const result = applier.apply(original, patch);
    assert.ok(result.success);
    assert.equal(result.content, "line1\nmodified\nline3\n");
  });

  it("rejects patch with conflicts", () => {
    const applier = new StructuredPatchApplier({ strict: true });
    const original = "line1\nline2\nline3\n";
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,2 +1,2 @@
-line0
+something
 line1
`;

    const result = applier.apply(original, patch);
    assert.ok(!result.success);
    assert.ok(result.conflicts);
  });

  it("reports applied hunk count", () => {
    const applier = new StructuredPatchApplier();
    const original = "a\nb\nc\nd\ne\n";
    const patch = `--- a/file.txt
+++ b/file.txt
@@ -1,3 +1,3 @@
-a
+one
 b
 c
@@ -4,2 +4,2 @@
-d
+four
 e
`;

    const result = applier.apply(original, patch);
    assert.ok(result.success);
    assert.equal(result.hunksApplied, 2);
  });
});