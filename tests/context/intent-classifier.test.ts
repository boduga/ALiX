import { describe, it } from "node:test";
import assert from "node:assert";
import { IntentClassifier } from "../../src/context/intent-classifier.js";

describe("IntentClassifier", () => {
  const classifier = new IntentClassifier();

  describe("classify", () => {
    it("should classify bugfix intent", () => {
      assert.strictEqual(classifier.classify("fix the login bug"), "bugfix");
      assert.strictEqual(classifier.classify("the app crashes when clicking submit"), "bugfix");
      assert.strictEqual(classifier.classify("button click handler is broken"), "bugfix");
    });

    it("should classify feature intent", () => {
      assert.strictEqual(classifier.classify("add user authentication"), "feature");
      assert.strictEqual(classifier.classify("implement dark mode"), "feature");
      assert.strictEqual(classifier.classify("create a new dashboard"), "feature");
    });

    it("should classify refactor intent", () => {
      assert.strictEqual(classifier.classify("refactor the auth module"), "refactor");
      assert.strictEqual(classifier.classify("extract common logic into utility"), "refactor");
      assert.strictEqual(classifier.classify("simplify the validation logic"), "refactor");
    });

    it("should classify explanation intent", () => {
      assert.strictEqual(classifier.classify("what is the auth flow"), "explanation");
      assert.strictEqual(classifier.classify("how does the routing work"), "explanation");
      assert.strictEqual(classifier.classify("explain the data model"), "explanation");
    });

    it("should classify test intent", () => {
      assert.strictEqual(classifier.classify("add tests for the service"), "test");
      assert.strictEqual(classifier.classify("write unit tests for utils"), "test");
      assert.strictEqual(classifier.classify("increase test coverage"), "test");
    });

    it("should classify docs intent", () => {
      assert.strictEqual(classifier.classify("document the API endpoints"), "docs");
      assert.strictEqual(classifier.classify("update the README"), "docs");
      assert.strictEqual(classifier.classify("add comments to the code"), "docs");
    });

    it("should classify review intent", () => {
      assert.strictEqual(classifier.classify("review the PR changes"), "review");
      assert.strictEqual(classifier.classify("audit the security implementation"), "review");
      assert.strictEqual(classifier.classify("check the code for issues"), "review");
    });

    it("should default to unknown for unrecognized intent", () => {
      assert.strictEqual(classifier.classify("hello world"), "unknown");
      assert.strictEqual(classifier.classify("just some random text"), "unknown");
    });
  });

  describe("classifyWithFiles", () => {
    it("should extract files from bugfix intent", () => {
      const result = classifier.classifyWithFiles("fix the bug in src/auth/login.ts");
      assert.strictEqual(result.type, "bugfix");
      assert.ok(result.files?.includes("src/auth/login.ts"));
    });

    it("should extract files from feature intent", () => {
      const result = classifier.classifyWithFiles("add pagination to src/api/users.ts");
      assert.strictEqual(result.type, "feature");
      assert.ok(result.files?.includes("src/api/users.ts"));
    });

    it("should extract multiple files", () => {
      const result = classifier.classifyWithFiles("refactor src/utils/helper.ts and src/core/engine.ts");
      assert.strictEqual(result.type, "refactor");
      assert.ok(result.files?.includes("src/utils/helper.ts"));
      assert.ok(result.files?.includes("src/core/engine.ts"));
    });

    it("should return confidence scores", () => {
      const result = classifier.classifyWithFiles("fix the critical bug");
      assert.ok(result.confidence > 0);
      assert.ok(result.confidence <= 1);
    });

    it("should return keywords", () => {
      const result = classifier.classifyWithFiles("implement the new authentication flow");
      assert.ok(result.keywords.length > 0);
      assert.strictEqual(result.type, "feature");
    });

    it("should handle intent without files", () => {
      const result = classifier.classifyWithFiles("fix the login bug");
      assert.strictEqual(result.type, "bugfix");
      assert.ok(!result.files);
    });
  });
});