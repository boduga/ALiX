import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { SymbolExtractor } from "../../src/repomap/symbol-extractor.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile, mkdir } from "node:fs/promises";
import { rm } from "node:fs/promises";

describe("SymbolExtractor", () => {
  const testDir = join(tmpdir(), "symbol-test");

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("extracts function and class definitions", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(join(testDir, "test.ts"), `
      export function calculateTotal(items: Item[]): number {
        return items.reduce((sum, item) => sum + item.price, 0);
      }

      export class Cart {
        private items: Item[] = [];
        add(item: Item): void { this.items.push(item); }
      }

      interface Item { price: number; }
    `);

    const extractor = new SymbolExtractor();
    const symbols = await extractor.extractFromDir(testDir);

    assert.ok(symbols.find(s => s.name === "calculateTotal" && s.kind === "function"));
    assert.ok(symbols.find(s => s.name === "Cart" && s.kind === "class"));
    assert.ok(symbols.find(s => s.name === "Item" && s.kind === "interface"));
  });

  it("extracts symbols from code string with AST", async () => {
    const extractor = new SymbolExtractor();
    const code = `
      const foo = 42;
      type UserId = string;
      enum Status { Active, Inactive }
      function test() { return foo; }
    `;
    const symbols = await extractor.extractFromCode(code, "test.ts");

    assert.ok(symbols.find(s => s.name === "foo" && s.kind === "const"));
    assert.ok(symbols.find(s => s.name === "UserId" && s.kind === "type"));
    assert.ok(symbols.find(s => s.name === "Status" && s.kind === "enum"));
    assert.ok(symbols.find(s => s.name === "test" && s.kind === "function"));
  });
});
