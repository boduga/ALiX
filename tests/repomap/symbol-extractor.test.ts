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

  it("extracts methods from class bodies", () => {
    const symbols = extractTopLevelSymbols("src/auth.ts", [
      "export class AuthService {",
      "  login(user: string) { return user; }",
      "  logout() { return true; }",
      "}",
    ].join("\n"));

    const methods = symbols.filter((s) => s.kind === "method");
    assert.deepEqual(methods.map((m) => [m.name, m.kind, m.line]), [
      ["login", "method", 2],
      ["logout", "method", 3],
    ]);
  });

  it("captures startByte and endByte for all symbol kinds", () => {
    const content = "export function foo() {}";
    const [symbol] = extractTopLevelSymbols("src/test.ts", content);
    assert.ok(typeof symbol.startByte === "number", "startByte should be a number");
    assert.ok(typeof symbol.endByte === "number", "endByte should be a number");
    assert.ok(symbol.endByte > symbol.startByte, "endByte should be greater than startByte");
  });
});