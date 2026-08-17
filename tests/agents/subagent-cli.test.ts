import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import { appendSubagentResponseText, buildSubagentFindings, computeSubagentStatus, formatSubagentResult, subagentToolError, SubagentCLI, inferSingleOwnedPatchPath } from "../../src/agents/subagent-cli.js";

describe("SubagentCLI", () => {
  it("exposes static main method", () => {
    assert.equal(typeof SubagentCLI.main, "function");
  });

  it("preserves earlier response text when a later tool turn has no text", () => {
    const first = appendSubagentResponseText("", "Found src/auth.ts");
    const second = appendSubagentResponseText(first, "");

    assert.equal(second, "Found src/auth.ts");
  });

  it("separates multi-turn response text in findings", () => {
    const first = appendSubagentResponseText("", "First finding");
    const second = appendSubagentResponseText(first, "Second finding");

    assert.equal(second, "First finding\n\nSecond finding");
  });

  it("uses tool output as findings when the model returns no final text", () => {
    const findings = buildSubagentFindings("", ["delegate-tool.ts\nsubagent-cli.ts"]);

    assert.deepEqual(findings, [{
      type: "summary",
      content: "delegate-tool.ts\nsubagent-cli.ts",
      confidence: "high",
    }]);
  });

  it("prefers model text over raw tool output when both are available", () => {
    const findings = buildSubagentFindings("Final summary", ["raw output"]);

    assert.equal(findings[0].content, "Final summary");
  });

  it("deduplicates repeated tool outputs in fallback findings", () => {
    const findings = buildSubagentFindings("", ["same output", "same output"]);

    assert.equal(findings[0].content, "same output");
  });

  it("prefers real tool output over tool-call-shaped model text", () => {
    const findings = buildSubagentFindings(
      "{\"name\": \"alix_file_read\", \"parameters\": {\"root\": \"/home/\"}}",
      ["babasola\nlinuxbrew"]
    );

    assert.equal(findings[0].content, "babasola\nlinuxbrew");
  });

  it("formats direct CLI output as plain text", () => {
    const output = formatSubagentResult({
      id: "task-1",
      role: "explorer",
      status: "success",
      findings: [{ type: "summary", content: "babasola\nlinuxbrew", confidence: "high" }],
      events: [],
    }, "text");

    assert.equal(output, "babasola\nlinuxbrew");
  });

  it("keeps JSON output for machine consumers", () => {
    const output = formatSubagentResult({
      id: "task-1",
      role: "explorer",
      status: "success",
      findings: [{ type: "summary", content: "babasola", confidence: "high" }],
      events: [],
    }, "json");

    assert.deepEqual(JSON.parse(output).findings[0].content, "babasola");
  });
});

test("computeSubagentStatus: success when no write tool failed", () => {
  assert.equal(computeSubagentStatus([]), "success");
});

test("computeSubagentStatus: failed when a write tool failed (error)", () => {
  assert.equal(computeSubagentStatus(["patch.apply"]), "failed");
});

test("computeSubagentStatus: failed when a write tool was denied", () => {
  assert.equal(computeSubagentStatus(["file.create"]), "failed");
});

test("subagentToolError: uses reason for denied results", () => {
  assert.equal(subagentToolError({ kind: "denied", reason: "Path protected: /x" }), "Path protected: /x");
});

test("subagentToolError: uses message for error results", () => {
  assert.equal(subagentToolError({ kind: "error", message: "No patch changes found" }), "No patch changes found");
});

describe("inferSingleOwnedPatchPath", () => {
  it("rewrites a path-less single-block search_replace patch to canonical marker form", () => {
    const args: Record<string, unknown> = {
      format: "search_replace",
      patchText: "const target = 1;\nmodule.exports = { target };\n---\nconst target = 42;\nmodule.exports = { target };",
    };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["src/target.ts"] });
    assert.equal(
      args.patchText,
      "<<<<<<< SEARCH path=src/target.ts\nconst target = 1;\nmodule.exports = { target };\n=======\nconst target = 42;\nmodule.exports = { target };\n>>>>>>> REPLACE"
    );
  });

  it("leaves a patch that already carries a SEARCH path marker unchanged", () => {
    const scoped = "<<<<<<< SEARCH path=a.ts\nold\n=======\nnew\n>>>>>>> REPLACE";
    const args: Record<string, unknown> = { format: "search_replace", patchText: scoped };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["a.ts"] });
    assert.equal(args.patchText, scoped);
  });

  it("leaves multi-owned-path workers unchanged (ambiguous target)", () => {
    const patchText = "old\n---\nnew";
    const args: Record<string, unknown> = { format: "search_replace", patchText };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["a.ts", "b.ts"] });
    assert.equal(args.patchText, patchText);
  });

  it("leaves read-only mode unchanged", () => {
    const patchText = "old\n---\nnew";
    const args: Record<string, unknown> = { format: "search_replace", patchText };
    inferSingleOwnedPatchPath(args, { mode: "read_only", ownedPaths: ["a.ts"] });
    assert.equal(args.patchText, patchText);
  });

  it("leaves non-search_replace formats unchanged", () => {
    const patchText = "old\n---\nnew";
    const args: Record<string, unknown> = { format: "structured_patch", patchText };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["a.ts"] });
    assert.equal(args.patchText, patchText);
  });

  it("leaves text without a --- separator unchanged (fail closed)", () => {
    const patchText = "const target = 1;";
    const args: Record<string, unknown> = { format: "search_replace", patchText };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["a.ts"] });
    assert.equal(args.patchText, patchText);
  });

  it("rewrites a ---replace--- separator to canonical marker form", () => {
    const args: Record<string, unknown> = {
      format: "search_replace",
      patchText: "old\n---replace---\nnew",
    };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["a.ts"] });
    assert.equal(args.patchText, "<<<<<<< SEARCH path=a.ts\nold\n=======\nnew\n>>>>>>> REPLACE");
  });

  it("leaves three-part text unchanged (ambiguous)", () => {
    const patchText = "old\n---\nmiddle\n---\nnew";
    const args: Record<string, unknown> = { format: "search_replace", patchText };
    inferSingleOwnedPatchPath(args, { mode: "write", ownedPaths: ["a.ts"] });
    assert.equal(args.patchText, patchText);
  });
});
