import { describe, it, test } from "node:test";
import assert from "node:assert/strict";
import type { SubagentResult } from "../../src/config/schema.js";
import { appendSubagentResponseText, buildResult, buildSubagentFindings, computeSubagentStatus, extractSuccessfulPaths, formatSubagentResult, isObjectiveComplete, recordWriteOutcome, subagentToolError, SubagentCLI, inferSingleOwnedPatchPath, shouldInferPatchPath, type WriteProgress } from "../../src/agents/subagent-cli.js";

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

const CWD = "/project";
const P = (paths: string[] = [], failures: string[] = []): WriteProgress =>
  ({ successfulPaths: new Set(paths), fatalWriteFailures: failures });

test("computeSubagentStatus: success when nothing written and no failure", () => {
  assert.equal(computeSubagentStatus(P(), ["foo.ts"], CWD), "success");
});

test("computeSubagentStatus: failed when a write failed with no durable progress", () => {
  assert.equal(computeSubagentStatus(P([], ["patch.apply"]), ["foo.ts"], CWD), "failed");
});

test("computeSubagentStatus: failed when a write was denied with no durable progress", () => {
  assert.equal(computeSubagentStatus(P([], ["file.create"]), ["foo.ts"], CWD), "failed");
});

// Spec 32.1 Test A — v3 regression: complete objective stays success despite later write noise
test("matrix: complete objective stays success despite later write noise (v3)", () => {
  assert.equal(
    computeSubagentStatus(P(["/project/verify-scratch.ts"], ["patch.apply", "patch.apply"]), ["verify-scratch.ts"], CWD),
    "success",
  );
});

// Spec 32.1 Test B
test("matrix: complete with no failures", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts", "/project/bar.ts"], []), ["foo.ts", "bar.ts"], CWD), "success");
});

// Spec 32.1 Test C
test("matrix: complete despite failed later write", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts", "/project/bar.ts"], ["patch.apply"]), ["foo.ts", "bar.ts"], CWD), "success");
});

// Spec 32.1 Test D — partial does not require a write failure
test("matrix: partial without failures", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts"], []), ["foo.ts", "bar.ts"], CWD), "partial");
});

// Spec 32.1 Test E
test("matrix: partial with write failure", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts"], ["patch.apply"]), ["foo.ts", "bar.ts"], CWD), "partial");
});

// Spec 32.1 Test F
test("matrix: no progress + failed write", () => {
  assert.equal(computeSubagentStatus(P([], ["patch.apply"]), ["foo.ts"], CWD), "failed");
});

// Spec 32.1 Test G
test("matrix: clean no-progress", () => {
  assert.equal(computeSubagentStatus(P(), ["foo.ts"], CWD), "success");
});

// Spec 32.1 Test H
test("matrix: empty owned paths, no writes", () => {
  assert.equal(computeSubagentStatus(P(), [], CWD), "success");
});

// Spec 32.1 Test I
test("matrix: empty owned paths with write failure is still success", () => {
  assert.equal(computeSubagentStatus(P(["/project/foo.ts"], ["patch.apply"]), [], CWD), "success");
});

// Spec 33 — normalization
test("isObjectiveComplete: relative owned vs absolute successful match", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/foo.ts"]), ["src/foo.ts"], "/project"), true);
});
test("isObjectiveComplete: absolute owned vs relative successful match", () => {
  assert.equal(isObjectiveComplete(new Set(["src/foo.ts"]), ["/project/src/foo.ts"], "/project"), true);
});

// Spec 34 — directory coverage
test("isObjectiveComplete: owned directory covers children", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/foo.ts"]), ["src"], "/project"), true);
});
test("isObjectiveComplete: prefix without separator does not match", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/foo.ts.bak"]), ["/project/src/foo.ts"], "/project"), false);
});
test("isObjectiveComplete: unrelated path does not cover", () => {
  assert.equal(isObjectiveComplete(new Set(["/project/src/bar.ts"]), ["/project/src/foo.ts"], "/project"), false);
});
test("isObjectiveComplete: empty owned paths is always complete", () => {
  assert.equal(isObjectiveComplete(new Set(), [], "/project"), true);
});

// Spec 35 — path extraction
test("extractSuccessfulPaths: patch.apply uses changedFiles", () => {
  assert.deepEqual(extractSuccessfulPaths("patch.apply", { kind: "success", changedFiles: ["a.ts"] }), ["a.ts"]);
});
test("extractSuccessfulPaths: file.create prefers createdPath", () => {
  assert.deepEqual(extractSuccessfulPaths("file.create", { kind: "success", createdPath: "a.ts", changedFiles: ["a.ts"] }), ["a.ts"]);
});
test("extractSuccessfulPaths: file.create falls back to changedFiles", () => {
  assert.deepEqual(extractSuccessfulPaths("file.create", { kind: "success", changedFiles: ["a.ts"] }), ["a.ts"]);
});
test("extractSuccessfulPaths: file.delete prefers deletedPath", () => {
  assert.deepEqual(extractSuccessfulPaths("file.delete", { kind: "success", deletedPath: "a.ts" }), ["a.ts"]);
});
test("extractSuccessfulPaths: failed write gets no credit", () => {
  assert.deepEqual(extractSuccessfulPaths("patch.apply", { kind: "error", message: "Search block not found" }), []);
});
test("extractSuccessfulPaths: success with no recognized path contributes nothing", () => {
  assert.deepEqual(extractSuccessfulPaths("patch.apply", { kind: "success", output: "ok" }), []);
});
test("extractSuccessfulPaths: non-write tools contribute nothing", () => {
  assert.deepEqual(extractSuccessfulPaths("file.read", { kind: "success", output: "x" }), []);
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

describe("shouldInferPatchPath (call-site tool-name guard)", () => {
  it("returns false for a non-patch.apply tool whose args carry format + patchText (never rewritten)", () => {
    const args: Record<string, unknown> = { format: "search_replace", patchText: "old\n---\nnew" };
    assert.equal(shouldInferPatchPath("mcp_custom_write", args, { mode: "write", ownedPaths: ["a.ts"] }), false);
    assert.equal(args.patchText, "old\n---\nnew");
  });

  it("returns false for a base non-patch tool with patch-shaped args", () => {
    const args: Record<string, unknown> = { format: "search_replace", patchText: "old\n---\nnew" };
    assert.equal(shouldInferPatchPath("alix_file_create", args, { mode: "write", ownedPaths: ["a.ts"] }), false);
  });

  it("returns true for patch.apply with a path-less search_replace patch", () => {
    const args: Record<string, unknown> = { format: "search_replace", patchText: "old\n---\nnew" };
    assert.equal(shouldInferPatchPath("patch.apply", args, { mode: "write", ownedPaths: ["a.ts"] }), true);
  });

  it("returns false for patch.apply with an already-scoped patch", () => {
    const args: Record<string, unknown> = {
      format: "search_replace",
      patchText: "<<<<<<< SEARCH path=a.ts\nold\n=======\nnew\n>>>>>>> REPLACE",
    };
    assert.equal(shouldInferPatchPath("patch.apply", args, { mode: "write", ownedPaths: ["a.ts"] }), false);
  });

  it("returns false for patch.apply in read-only mode", () => {
    const args: Record<string, unknown> = { format: "search_replace", patchText: "old\n---\nnew" };
    assert.equal(shouldInferPatchPath("patch.apply", args, { mode: "read_only", ownedPaths: ["a.ts"] }), false);
  });

  it("returns false for patch.apply on a multi-owned-path worker", () => {
    const args: Record<string, unknown> = { format: "search_replace", patchText: "old\n---\nnew" };
    assert.equal(shouldInferPatchPath("patch.apply", args, { mode: "write", ownedPaths: ["a.ts", "b.ts"] }), false);
  });
});

test("recordWriteOutcome: failed write records a failure", () => {
  const p = P();
  recordWriteOutcome(p, "patch.apply", { kind: "error", message: "Search block not found" });
  assert.deepEqual(p.fatalWriteFailures, ["patch.apply"]);
});

test("recordWriteOutcome: successful write records affected paths", () => {
  const p = P();
  recordWriteOutcome(p, "patch.apply", { kind: "success", changedFiles: ["a.ts"] });
  assert.deepEqual([...p.successfulPaths], ["a.ts"]);
});

test("recordWriteOutcome: non-write tools are ignored", () => {
  const p = P();
  recordWriteOutcome(p, "file.read", { kind: "success", output: "x" });
  assert.equal(p.successfulPaths.size, 0);
  assert.equal(p.fatalWriteFailures.length, 0);
});

test("recordWriteOutcome: repeated failures of the same tool deduplicate in the ledger", () => {
  const p = P();
  recordWriteOutcome(p, "patch.apply", { kind: "error", message: "Search block not found" });
  recordWriteOutcome(p, "patch.apply", { kind: "error", message: "No patch changes found" });
  assert.deepEqual(p.fatalWriteFailures, ["patch.apply"]);
});

test("formatSubagentResult: partial renders [partial] note with detail", () => {
  const result: SubagentResult = {
    id: "t", role: "worker",
    status: "partial",
    findings: [{ type: "summary", content: "edited foo", confidence: "high" }],
    events: [],
    error: "delegated objective incomplete\nChanged: foo.ts\nUntouched: bar.ts\nWrite failures: none",
  };
  const out = formatSubagentResult(result, "text");
  assert.ok(out.includes("[partial]"));
  assert.ok(out.includes("Untouched: bar.ts"));
});

test("extractSuccessfulPaths: file.delete falls back to changedFiles", () => {
  assert.deepEqual(
    extractSuccessfulPaths("file.delete", { kind: "success", changedFiles: ["a.ts"] }),
    ["a.ts"],
  );
});

test("matrix: completed objective is monotonic despite arbitrary later failures", () => {
  const progress = P(
    ["/project/foo.ts"],
    ["patch.apply", "patch.apply", "file.create"],
  );
  assert.equal(
    computeSubagentStatus(progress, ["foo.ts"], "/project"),
    "success",
  );
});

test("buildResult: progress + incomplete objective yields partial with untouched detail", () => {
  // buildResult canonicalizes against process.cwd(), so use cwd-consistent paths.
  const cwd = process.cwd();
  const progress = P([`${cwd}/foo.ts`], []);
  const result = buildResult("t", "worker", "write", "done", [], progress, ["foo.ts", "bar.ts"]);
  assert.equal(result.status, "partial");
  assert.ok(result.error?.includes("Untouched: bar.ts"));
});
