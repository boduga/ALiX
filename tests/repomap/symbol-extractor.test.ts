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

    // Verify exports field
    assert.strictEqual(symbols.find(s => s.name === "calculateTotal")?.exports, true, "exported function");
    assert.strictEqual(symbols.find(s => s.name === "Cart")?.exports, true, "exported class");
    assert.strictEqual(symbols.find(s => s.name === "Item")?.exports, false, "non-exported interface");

    // Verify line numbers
    const lines = symbols.map(s => s.line);
    assert.ok(lines.every(l => l > 0), "all line numbers should be positive");
  });

  it("extracts symbols from code string", async () => {
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

    // Verify exports field
    const exportedSymbol = symbols.find(s => s.name === "foo");
    assert.strictEqual(exportedSymbol?.exports, false, "non-exported const should have exports=false");

    // Verify line numbers
    const fooSymbol = symbols.find(s => s.name === "foo");
    assert.ok(fooSymbol?.line, "symbol should have a line number");
    assert.strictEqual(fooSymbol?.line, 2, "foo should be on line 2");
  });
});
