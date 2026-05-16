import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { ContextCompiler } from "../../src/repomap/context-compiler.js";

describe("ContextCompiler", () => {
  const tmpDir = join("/tmp", `context-compiler-test-${Date.now()}`);
  let compiler: ContextCompiler;

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    // Create minimal package.json so classifyKind recognizes it as config
    writeFileSync(join(tmpDir, "package.json"), '{"name":"test"}');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function warm() {
    compiler = new ContextCompiler();
    await compiler.warm(tmpDir);
  }

  describe("warm()", () => {
    it("builds a repo map by walking the directory tree", async () => {
      await warm();
      const bundle = await compiler.compile("fix bug", "bugfix", 10000, []);
      assert.ok(bundle.id.startsWith("bundle-"));
    });
  });

  describe("compile()", () => {
    it("returns a ContextBundle with all required fields", async () => {
      await warm();
      const bundle = await compiler.compile("fix bug", "bugfix", 10000, []);
      assert.ok("id" in bundle);
      assert.ok("taskType" in bundle);
      assert.ok("budget" in bundle);
      assert.ok(Array.isArray(bundle.primaryFiles));
      assert.ok(Array.isArray(bundle.supportingFiles));
      assert.ok(Array.isArray(bundle.tests));
      assert.ok(Array.isArray(bundle.pinned));
    });

    it("classifies task type correctly", async () => {
      await warm();
      const bugBundle = await compiler.compile("fix bug in auth.ts", "bugfix", 10000, []);
      assert.strictEqual(bugBundle.taskType, "bugfix");
      const featBundle = await compiler.compile("add login feature", "feature", 10000, []);
      assert.strictEqual(featBundle.taskType, "feature");
    });

    it("extracts task-mentioned files as primary", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "foo.ts"), "export function foo() {}");
      await warm();
      const bundle = await compiler.compile("fix bug in src/foo.ts", "bugfix", 10000, []);
      const paths = bundle.primaryFiles.map(f => f.path);
      assert.ok(paths.some(p => p.includes("foo.ts")), `Expected foo.ts in ${JSON.stringify(paths)}`);
    });

    it("includes config files as supporting", async () => {
      await warm();
      const bundle = await compiler.compile("add feature", "feature", 10000, []);
      const paths = bundle.supportingFiles.map(f => f.path);
      assert.ok(paths.some(p => p.includes("package.json")), `Expected package.json in ${JSON.stringify(paths)}`);
    });

    it("respects token budget — budget.usedTokens <= budget.maxTokens", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "foo.ts"), "export function foo() {}");
      await warm();
      const bundle = await compiler.compile("fix bug in src/foo.ts", "bugfix", 500, []);
      assert.ok(bundle.budget.usedTokens <= bundle.budget.maxTokens);
    });

    it("maps source files to related test files by naming convention", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      mkdirSync(join(tmpDir, "tests"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "foo.ts"), "export function foo() {}");
      writeFileSync(join(tmpDir, "tests", "foo.test.ts"), 'import { foo } from "../src/foo"; test("foo", () => expect(foo()).toBeDefined());');
      await warm();
      const bundle = await compiler.compile("fix bug in src/foo.ts", "bugfix", 10000, []);
      const testPaths = bundle.tests.map(f => f.path);
      assert.ok(testPaths.some(p => p.includes("foo.test.ts")), `Expected foo.test.ts in ${JSON.stringify(testPaths)}`);
    });

    it("prioritizes pinned files (score 200) above all other items", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "foo.ts"), "export function foo() {}");
      await warm();
      const bundle = await compiler.compile("fix bug", "bugfix", 10000, ["src/foo.ts"]);
      assert.ok(bundle.pinned.length > 0, "Expected at least one pinned file");
      assert.ok(bundle.pinned.some(f => f.path.includes("foo.ts")), "Expected foo.ts in pinned");
      assert.strictEqual(bundle.pinned[0].reason, "pinned");
    });

    it("orders results by score descending", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "foo.ts"), "export function foo() {}");
      await warm();
      const bundle = await compiler.compile("fix bug in src/foo.ts", "bugfix", 10000, []);
      const allItems = [...bundle.primaryFiles, ...bundle.pinned];
      for (let i = 1; i < allItems.length; i++) {
        assert.ok(allItems[i - 1].score >= allItems[i].score, `Score order violated at index ${i}: ${allItems[i - 1].score} >= ${allItems[i].score}`);
      }
    });
  });

  describe("extractTaskMentions()", () => {
    it("extracts paths in single-quotes", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "auth.ts"), "export function auth() {}");
      await warm();
      const bundle = await compiler.compile("fix 'src/auth.ts'", "bugfix", 10000, []);
      const paths = bundle.primaryFiles.map(f => f.path);
      assert.ok(paths.some(p => p.includes("auth.ts")), `Expected auth.ts in ${JSON.stringify(paths)}`);
    });

    it("extracts paths in double-quotes", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "utils.ts"), "export function utils() {}");
      await warm();
      const bundle = await compiler.compile('fix "src/utils.ts"', "bugfix", 10000, []);
      const paths = bundle.primaryFiles.map(f => f.path);
      assert.ok(paths.some(p => p.includes("utils.ts")), `Expected utils.ts in ${JSON.stringify(paths)}`);
    });
  });

  describe("bugfix hint", () => {
    it("includes test files for bugfix tasks even without explicit mentions", async () => {
      mkdirSync(join(tmpDir, "tests"), { recursive: true });
      writeFileSync(join(tmpDir, "tests", "foo.test.ts"), "test('foo', () => {});");
      await warm();
      const bundle = await compiler.compile("fix something", "bugfix", 10000, []);
      const testPaths = bundle.tests.map(f => f.path);
      assert.ok(testPaths.length > 0, "Expected test files for bugfix task");
    });
  });

  describe("dependency and symbol signals", () => {
    it("includes dependency-related files for mentioned source files", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "app.ts"), "import { auth } from './auth';\nexport function app() { return auth(); }");
      writeFileSync(join(tmpDir, "src", "auth.ts"), "export function auth() { return true; }");
      await warm();

      const bundle = await compiler.compile("fix src/app.ts", "bugfix", 10000, []);
      const paths = bundle.primaryFiles.map(f => f.path);

      assert.ok(paths.includes("src/app.ts"));
      assert.ok(paths.includes("src/auth.ts"));
      assert.ok(bundle.primaryFiles.find(f => f.path === "src/auth.ts")?.reason.includes("dependency_distance:1"));
    });

    it("includes symbol context when task mentions a symbol", async () => {
      mkdirSync(join(tmpDir, "src"), { recursive: true });
      writeFileSync(join(tmpDir, "src", "auth.ts"), "export function login(user: string) { return user; }\nexport function logout() {}");
      await warm();

      const bundle = await compiler.compile("fix login behavior", "bugfix", 10000, []);
      const symbols = bundle.primaryFiles.filter(f => f.kind === "symbol");

      assert.ok(symbols.some(symbol => symbol.symbolName === "login"));
    });
  });
});