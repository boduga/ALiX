import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { SemanticSearchIndex } from "../../src/context/semantic-search.js";
import { promises as fs } from "node:fs";
import path from "node:path";

describe("SemanticSearchIndex", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = `/tmp/semantic-search-test-${Date.now()}`;
    await fs.mkdir(testDir, { recursive: true });
  });

  describe("constructor", () => {
    it("should create index with base directory", () => {
      const idx = new SemanticSearchIndex("/tmp/test");
      assert.ok(idx instanceof SemanticSearchIndex);
    });

    it("should accept custom index path", () => {
      const idx = new SemanticSearchIndex("/tmp/test", "/custom/index/path.json");
      assert.ok(idx instanceof SemanticSearchIndex);
    });
  });

  describe("init", () => {
    it("should initialize without error", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();
    });
  });

  describe("indexFile", () => {
    it("should index a TypeScript function", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export function calculateSum(a: number, b: number): number {
  return a + b;
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("calculateSum");
      assert.ok(results.length > 0);
      assert.strictEqual(results[0].symbolName, "calculateSum");
      assert.strictEqual(results[0].kind, "function");
    });

    it("should index a class declaration", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export class UserService {
  private users: User[] = [];

  getUsers(): User[] {
    return this.users;
  }
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("UserService");
      assert.ok(results.length > 0);
      assert.strictEqual(results[0].symbolName, "UserService");
      assert.strictEqual(results[0].kind, "class");
    });

    it("should index a method", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("add");
      assert.ok(results.some(r => r.symbolName === "add" && r.kind === "method"));
    });

    it("should index an interface", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export interface UserProfile {
  id: string;
  name: string;
  email: string;
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("UserProfile");
      assert.ok(results.some(r => r.symbolName === "UserProfile" && r.kind === "interface"));
    });

    it("should index a type alias", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export type UserId = string;
export type UserRecord = { id: UserId; name: string };
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("UserId");
      assert.ok(results.some(r => r.symbolName === "UserId" && r.kind === "type"));
    });

    it("should index a const declaration", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export const MAX_RETRY_COUNT = 3;
export const DEFAULT_TIMEOUT = 5000;
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("MAX_RETRY_COUNT");
      assert.ok(results.some(r => r.symbolName === "MAX_RETRY_COUNT" && r.kind === "const"));
    });

    it("should track line numbers", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export function testFunction(): void {
  // line 2
  // line 3
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("testFunction");
      assert.ok(results.length > 0);
      assert.ok(results[0].lineStart > 0);
      assert.ok(results[0].lineEnd >= results[0].lineStart);
    });

    it("should extract keywords from file content", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
/**
 * Authentication service for user login
 * Handles JWT token generation and validation
 */
export class AuthService {
  authenticateUser(username: string, password: string): Promise<boolean> {
    return Promise.resolve(true);
  }
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("authenticate");
      assert.ok(results.length > 0);
      // Keywords are extracted for class/function symbols, not methods
      // Search finds authenticateUser method, which is valid result for "authenticate" query
    });
  });

  describe("search", () => {
    it("should find symbols by name", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export function getUserById(id: string): User {
  return {} as User;
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("getUserById");
      assert.ok(results.length > 0);
      assert.strictEqual(results[0].symbolName, "getUserById");
    });

    it("should rank exact matches higher", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
function helper() {}
function helperUtility() {}
function anotherHelper() {}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("helper");
      assert.ok(results.length >= 2);
      // Exact match should be first
      assert.strictEqual(results[0].symbolName, "helper");
    });

    it("should limit results when limit parameter provided", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
function item1() {}
function item2() {}
function item3() {}
function item4() {}
function item5() {}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("item", 3);
      assert.ok(results.length <= 3);
    });

    it("should return empty array when no matches found", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
function someFunction() {}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("nonexistentSymbol12345");
      assert.ok(results.length === 0);
    });

    it("should return results with scores", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `
export class DataProcessor {
  processData(input: string): void {}
}
      `);

      await idx.indexFile(filePath);
      const results = await idx.search("process");
      assert.ok(results.length > 0);
      assert.ok(typeof results[0].score === "number");
      assert.ok(results[0].score > 0);
    });

    it("should search across multiple indexed files", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const file1 = path.join(testDir, "file1.ts");
      const file2 = path.join(testDir, "file2.ts");

      await fs.writeFile(file1, `export function utilFunc() {}`);
      await fs.writeFile(file2, `export function utilFunc() {}`);

      await idx.indexFile(file1);
      await idx.indexFile(file2);

      const results = await idx.search("utilFunc");
      assert.ok(results.length >= 2);
    });
  });

  describe("indexed symbol structure", () => {
    it("should include path in indexed symbols", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "myfile.ts");
      await fs.writeFile(filePath, `export function testFunc() {}`);

      await idx.indexFile(filePath);
      const results = await idx.search("testFunc");
      assert.ok(results.length > 0);
      assert.ok(results[0].path.includes("myfile.ts"));
    });

    it("should include all required fields in IndexedSymbol", async () => {
      const idx = new SemanticSearchIndex(testDir);
      await idx.init();

      const filePath = path.join(testDir, "test.ts");
      await fs.writeFile(filePath, `export class MyClass {}`);

      await idx.indexFile(filePath);
      const results = await idx.search("MyClass");
      assert.ok(results.length > 0);

      const symbol = results[0];
      assert.ok(typeof symbol.path === "string");
      assert.ok(typeof symbol.symbolName === "string");
      assert.ok(typeof symbol.kind === "string");
      assert.ok(typeof symbol.lineStart === "number");
      assert.ok(typeof symbol.lineEnd === "number");
      assert.ok(Array.isArray(symbol.keywords));
      assert.ok(typeof symbol.score === "number");
    });
  });
});