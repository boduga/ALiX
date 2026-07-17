/**
 * Suite G: MCP — alix mcp list, test, discover.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { runCli, assertSuccess, assertOutputContains, needsModel } from "./run-cli.js";

describe("Suite G: MCP", () => {

  // ── G.1: List MCP servers ────────────────────────────────────
  it("G.1: mcp list shows configured servers and tools", () => {
    const r = runCli(["mcp", "list"], { timeoutMs: 15_000 });
    assertSuccess(r);
    assertOutputContains(r, "fetch", "should list fetch server");
  });

  // ── G.2: Test MCP server (fetch) ──────────────────────────────
  it("G.2: mcp test fetch verifies connectivity", () => {
    const r = runCli(["mcp", "test", "fetch"], { timeoutMs: 15_000 });
    assertSuccess(r);
    assertOutputContains(r, "fetch", "should show fetch connection test");
  });

  // ── G.3: MCP discover package ─────────────────────────────────
  it("G.3: mcp discover searches npm for MCP packages", () => {
    const r = runCli(["mcp", "discover", "mcp-server-fetch"], { timeoutMs: 30_000 });
    // MCP discovery may fail gracefully if npm isn't available
    assert.ok(r.exitCode === 0 || r.exitCode === 1, `mcp discover should not crash (exit: ${r.exitCode})`);
  });

  // ── G.4: MCP with missing server name ─────────────────────────
  it("G.4: mcp test with no name shows error", () => {
    const r = runCli(["mcp", "test"], { timeoutMs: 5_000 });
    assert.ok(r.exitCode !== 0 || r.stdout.includes("name"), "should error or prompt for name");
  });
});


/**
 * Suite H: Extensions — alix extension list, search.
 */
describe("Suite H: Extensions", () => {

  // ── H.1: List extensions ──────────────────────────────────────
  it("H.1: extension list shows installed extensions or empty state", () => {
    const r = runCli(["extension", "list"], { timeoutMs: 10_000 });
    assertSuccess(r);
  });

  // ── H.2: Search extensions ────────────────────────────────────
  it("H.2: extension search queries the registry", () => {
    const r = runCli(["extension", "search", "test"], { timeoutMs: 15_000 });
    assertSuccess(r);
  });

  // ── H.3: Extension help ──────────────────────────────────────
  it("H.3: extension subcommands appear in --help", () => {
    const r = runCli(["extension", "--help"]);
    assertSuccess(r);
    assertOutputContains(r, "extension");
    assertOutputContains(r, "list");
    assertOutputContains(r, "search");
  });
});
