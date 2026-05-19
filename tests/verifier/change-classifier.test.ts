import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyChanges, type ChangeType, getSuggestedChecks } from "../../src/verifier/change-classifier.js";

describe("ChangeClassifier", () => {
  it("classifies TypeScript file as code change", () => {
    const result = classifyChanges(["src/utils/helper.ts"]);
    assert.equal(result.primary, "code");
  });

  it("classifies test file as test change", () => {
    const result = classifyChanges(["tests/utils/helper.test.ts"]);
    assert.equal(result.primary, "test");
  });

  it("classifies .md file as docs change", () => {
    const result = classifyChanges(["docs/README.md"]);
    assert.equal(result.primary, "docs");
  });

  it("classifies package.json as config change", () => {
    const result = classifyChanges(["package.json"]);
    assert.equal(result.primary, "config");
  });

  it("classifies dependency changes (package-lock.json)", () => {
    const result = classifyChanges(["package-lock.json"]);
    assert.equal(result.primary, "dependency");
  });

  it("classifies ui changes (.css)", () => {
    const result = classifyChanges(["styles/main.css"]);
    assert.equal(result.primary, "ui");
  });

  it("classifies schema changes (files with schema in path)", () => {
    const result = classifyChanges(["src/db/schema.prisma"]);
    assert.equal(result.primary, "schema");
  });

  it("classifies migration changes (files with migrate in path)", () => {
    const result = classifyChanges(["db/migrate_001_add_users.ts"]);
    assert.equal(result.primary, "migration");
  });

  it("classifies .tsx files as code, not ui", () => {
    const result = classifyChanges(["components/Button.tsx"]);
    assert.equal(result.primary, "code");
  });

  it("classifies unknown extensions as code, not config", () => {
    const result = classifyChanges(["some.random.file"]);
    assert.equal(result.primary, "code");
  });

  it("classifies mixed changes as mixed", () => {
    const result = classifyChanges(["src/app.ts", "tests/app.test.ts", "README.md"]);
    assert.equal(result.primary, "mixed");
  });

  it("suggests typecheck for code changes", () => {
    const classification = classifyChanges(["src/app.ts"]);
    const checks = getSuggestedChecks(classification);
    assert.ok(checks.includes("typecheck"));
  });

  it("suggests test for test file changes", () => {
    const classification = classifyChanges(["tests/app.test.ts"]);
    const checks = getSuggestedChecks(classification);
    assert.ok(checks.includes("test"));
  });
});