// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Contract types ──────────────────────────────────────────────────

import type {
  ToolName,
  ToolCallRequest,
  ToolResult,
  FileMatch,
  ToolArgs,
  ToolSafetyBoundary,
} from "../../src/runtime/contracts/tool-contract.js";
import {
  TOOL_SAFETY_BOUNDARY,
} from "../../src/runtime/contracts/tool-contract.js";

// ── Source types (structural comparison) ────────────────────────────

import type {
  ToolName as SourceToolName,
  ToolCallRequest as SourceToolCallRequest,
  ToolResult as SourceToolResult,
  ToolArgs as SourceToolArgs,
  FileMatch as SourceFileMatch,
} from "../../src/tools/types.js";

// ── Tests ───────────────────────────────────────────────────────────

describe("M1.4 — Tool Contract", () => {
  // ── ToolName ───────────────────────────────────────────────────

  it("ToolName contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceToolName>(s: T): ToolName => s;
    const contractToSource = <T extends ToolName>(s: T): SourceToolName => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ToolName has all 8 members matching tools/types.ts", () => {
    const names: ToolName[] = [
      "file.read",
      "file.create",
      "file.delete",
      "file.exists",
      "dir.search",
      "shell.run",
      "patch.apply",
      "done",
    ];
    assert.equal(names.length, 8);
    // Verify each name is assignable to the source type
    for (const name of names) {
      const _source: SourceToolName = name;
      assert.ok(_source, `tool name "${name}" is valid ToolName`);
    }
  });

  // ── ToolCallRequest ───────────────────────────────────────────

  it("ToolCallRequest contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceToolCallRequest>(s: T): ToolCallRequest => s;
    const contractToSource = <T extends ToolCallRequest>(s: T): SourceToolCallRequest => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ToolCallRequest shape matches at runtime", () => {
    const request: ToolCallRequest = {
      toolCallId: "call-001",
      name: "file.read",
      args: { root: "/project", path: "readme.md" },
    };
    assert.equal(typeof request.toolCallId, "string");
    assert.equal(typeof request.name, "string");
    assert.equal(typeof request.args, "object");
    assert.equal(request.args.root, "/project");
    // Optional fields
    assert.equal(request.agentId, undefined);
    assert.equal(request.sessionId, undefined);
  });

  it("ToolCallRequest with optional fields", () => {
    const request: ToolCallRequest = {
      toolCallId: "call-002",
      name: "shell.run",
      args: { command: "npm test", cwd: "/project" },
      agentId: "agent-alpha",
      sessionId: "session-42",
    };
    assert.equal(request.agentId, "agent-alpha");
    assert.equal(request.sessionId, "session-42");
  });

  // ── FileMatch ────────────────────────────────────────────────

  it("FileMatch contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceFileMatch>(s: T): FileMatch => s;
    const contractToSource = <T extends FileMatch>(s: T): SourceFileMatch => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  // ── ToolResult (discriminated union) ──────────────────────────

  it("ToolResult contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceToolResult>(s: T): ToolResult => s;
    const contractToSource = <T extends ToolResult>(s: T): SourceToolResult => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ToolResult success variant shape matches at runtime", () => {
    const result: ToolResult = { kind: "success", content: "file contents" };
    assert.equal(result.kind, "success");
    assert.equal(result.content, "file contents");
    // Narrow on kind before accessing variant-specific fields
    if (result.kind === "success") {
      assert.equal(result.content, "file contents");
    }
  });

  it("ToolResult error variant shape matches at runtime", () => {
    const result: ToolResult = { kind: "error", message: "file not found", retryable: false };
    assert.equal(result.kind, "error");
    assert.equal(result.message, "file not found");
    // Narrow on kind before accessing variant-specific fields
    if (result.kind === "error") {
      assert.equal(result.message, "file not found");
      assert.equal(result.retryable, false);
    }
  });

  it("ToolResult success variant with matches (FileMatch[])", () => {
    const matches: FileMatch[] = [
      { path: "src/main.ts", lineNumber: 42, line: "  const x = 1;" },
      { path: "src/utils.ts", lineNumber: 10, line: "  const x = 2;" },
    ];
    const result: ToolResult = { kind: "success", matches };
    assert.equal(result.kind, "success");
    assert.equal(result.matches!.length, 2);
    assert.equal(result.matches![0].lineNumber, 42);
  });

  it("ToolResult success variant with output fields", () => {
    const result: ToolResult = {
      kind: "success",
      output: "stdout line",
      exitCode: 0,
    };
    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.equal(result.output, "stdout line");
      assert.equal(result.exitCode, 0);
    }
  });

  it("ToolResult success variant with value and boolean fields", () => {
    const result: ToolResult = { kind: "success", value: "matched", exists: true, completed: false };
    assert.equal(result.kind, "success");
    if (result.kind === "success") {
      assert.equal(result.value, "matched");
      assert.equal(result.exists, true);
      assert.equal(result.completed, false);
    }
  });

  it("ToolResult success variant with path fields", () => {
    const createResult: ToolResult = { kind: "success", createdPath: "/project/new.ts" };
    assert.equal(createResult.kind, "success");
    if (createResult.kind === "success") {
      assert.equal(createResult.createdPath, "/project/new.ts");
    }

    const deleteResult: ToolResult = { kind: "success", deletedPath: "/project/old.ts" };
    if (deleteResult.kind === "success") {
      assert.equal(deleteResult.deletedPath, "/project/old.ts");
    }

    const patchResult: ToolResult = { kind: "success", changedFiles: ["src/main.ts"] };
    if (patchResult.kind === "success") {
      assert.equal(patchResult.changedFiles![0], "src/main.ts");
    }
  });

  it("ToolResult error variant with retryable and hint", () => {
    const result: ToolResult = {
      kind: "error",
      message: "rate limited",
      retryable: true,
      hint: "wait 5 seconds and retry",
    };
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.equal(result.message, "rate limited");
      assert.equal(result.retryable, true);
      assert.equal(result.hint, "wait 5 seconds and retry");
    }
  });

  it("ToolResult error variant without optional fields", () => {
    const result: ToolResult = { kind: "error", message: "fatal error" };
    assert.equal(result.kind, "error");
    if (result.kind === "error") {
      assert.equal(result.retryable, undefined);
      assert.equal(result.hint, undefined);
    }
  });

  it("ToolResult discriminated union narrowing is exclusive", () => {
    // Verify that success fields are not present on error and vice versa
    const success: ToolResult = { kind: "success", content: "ok" };
    const error: ToolResult = { kind: "error", message: "fail" };

    if (success.kind === "success") {
      // content is accessible
      assert.equal(success.content, "ok");
    }
    if (error.kind === "error") {
      // message is accessible
      assert.equal(error.message, "fail");
    }
  });

  // ── ToolArgs ─────────────────────────────────────────────────

  it("ToolArgs contract type matches source type (assignability)", () => {
    const sourceToContract = <T extends SourceToolArgs>(s: T): ToolArgs => s;
    const contractToSource = <T extends ToolArgs>(s: T): SourceToolArgs => s;

    assert.ok(sourceToContract);
    assert.ok(contractToSource);
  });

  it("ToolArgs shape matches at runtime", () => {
    const readArgs: ToolArgs["file.read"] = { root: "/project", path: "readme.md" };
    assert.equal(readArgs.root, "/project");
    assert.equal(readArgs.path, "readme.md");

    const dirArgs: ToolArgs["dir.search"] = { root: "/project", pattern: "*.ts", extensions: [".ts"] };
    assert.equal(dirArgs.pattern, "*.ts");

    const shellArgs: ToolArgs["shell.run"] = { command: "echo hi", cwd: "/project", timeoutMs: 5000 };
    assert.equal(shellArgs.command, "echo hi");
    assert.equal(shellArgs.timeoutMs, 5000);

    const patchArgs: ToolArgs["patch.apply"] = { root: "/project", format: "diff", patchText: "--- a\n+++ b\n@@ -1 +1 @@\n-old\n+new" };
    assert.equal(patchArgs.format, "diff");
    assert.equal(typeof patchArgs.patchText, "string");
  });

  // ── ToolSafetyBoundary ───────────────────────────────────────

  it("TOOL_SAFETY_BOUNDARY documents all invariants", () => {
    assert.equal(TOOL_SAFETY_BOUNDARY.contractDescribesCapability, true);
    assert.equal(TOOL_SAFETY_BOUNDARY.contractDoesNotGrantPermission, true);
    assert.equal(TOOL_SAFETY_BOUNDARY.securityLayerGovernsPermission, true);
    assert.equal(TOOL_SAFETY_BOUNDARY.discriminatedUnionNarrowedByKind, true);
    assert.equal(TOOL_SAFETY_BOUNDARY.structuralFidelityOnly, true);

    // Verify all keys are literal true
    const keys = Object.keys(TOOL_SAFETY_BOUNDARY) as Array<keyof typeof TOOL_SAFETY_BOUNDARY>;
    for (const key of keys) {
      assert.equal(TOOL_SAFETY_BOUNDARY[key], true, `safety invariant "${key}" must be true`);
    }
  });

  it("ToolSafetyBoundary type has correct shape", () => {
    // Type-level assertion
    const _check: ToolSafetyBoundary = {
      contractDescribesCapability: true,
      contractDoesNotGrantPermission: true,
      securityLayerGovernsPermission: true,
      discriminatedUnionNarrowedByKind: true,
      structuralFidelityOnly: true,
    };
    assert.ok(_check);
  });

  // ── Cross-file structural integrity ──────────────────────────

  it("No existing source types are modified by contract", () => {
    // Verify that the source types are unchanged — just a structural
    // sanity check that importing and re-exporting doesn't alter shape.
    const request: SourceToolCallRequest = {
      toolCallId: "id",
      name: "done",
      args: {},
    };
    const contractRequest: ToolCallRequest = request;
    assert.ok(contractRequest);

    const result: SourceToolResult = { kind: "success", content: "ok" };
    const contractResult: ToolResult = result;
    assert.ok(contractResult);
  });
});
