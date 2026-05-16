import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractTopLevelSymbols } from "../../src/repomap/symbol-extractor.js";

describe("extractTopLevelSymbols", () => {
  it("extracts exported functions, classes, interfaces, types, and consts", () => {
    const symbols = extractTopLevelSymbols("src/auth.ts", [
      "export function login(user: string) { return user; }",
      "export class AuthService {}",
      "export interface User { id: string }",
      "export type Role = 'admin';",
      "export const TOKEN = 'x';",
    ].join("\n"));

    assert.deepEqual(symbols.map((symbol) => [symbol.name, symbol.kind, symbol.line]), [
      ["login", "function", 1],
      ["AuthService", "class", 2],
      ["User", "interface", 3],
      ["Role", "type", 4],
      ["TOKEN", "const", 5],
    ]);
  });

  it("keeps a compact signature", () => {
    const [symbol] = extractTopLevelSymbols("src/auth.ts", "export function login(user: string) { return user; }");
    assert.equal(symbol.signature, "export function login(user: string) { return user; }");
  });
});