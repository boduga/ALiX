import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { evaluateEvalGuards, prepareEvalGuards } from "../../src/operations/evals/eval-guards.js";
import type { EvalGuards } from "../../src/operations/evals/evals-types.js";

function fixture(run: (cwd: string, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "eval-guards-"));
  const cwd = join(root, "workspace");
  mkdirSync(cwd);
  try { run(cwd, root); } finally { rmSync(root, { recursive: true, force: true }); }
}

function logs(cwd: string, events: unknown[], session = "one"): void {
  const directory = join(cwd, ".alix", "sessions", session);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "events.jsonl"), events.map(event => JSON.stringify(event)).join("\n") + "\n");
}

const request = (id: string, toolName: string, argsPreview: Record<string, unknown>) =>
  ({ type: "tool.requested", payload: { toolCallId: id, toolName, argsPreview } });
const success = (id: string, toolName: string) =>
  ({ type: "tool.completed", payload: { toolCallId: id, toolName, status: "success" } });
const failed = (id: string, toolName: string, error = "File not found") =>
  ({ type: "tool.failed", payload: { toolCallId: id, toolName, error } });
const sequence: EvalGuards = { toolSequence: [
  { toolName: "file.delete", args: { path: "absent.md" }, outcome: "failed", errorIncludes: "not found" },
  { toolName: "file.create", args: { path: "recover.md" }, outcome: "success" },
] };
const deleteRequest = request("a", "file.delete", { path: "absent.md" });
const createRequest = request("b", "file.create", { path: "recover.md" });
const deletionFailed = failed("a", "file.delete");
const creationSucceeded = success("b", "file.create");

describe("independent eval guards", () => {
  it("ignores root runtime state but rejects added files and nested .alix", () => fixture(cwd => {
    writeFileSync(join(cwd, "source.txt"), "unchanged");
    const guards = { unchangedWorkspace: true };
    const baseline = prepareEvalGuards(cwd, guards);
    logs(cwd, []);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(true);
    mkdirSync(join(cwd, "src", ".alix"), { recursive: true });
    writeFileSync(join(cwd, "src", ".alix", "extra"), "unexpected");
    const outcome = evaluateEvalGuards(cwd, guards, baseline);
    expect(outcome.satisfied).toBe(false);
    expect(outcome.workspaceChanges).toContain("src/.alix/extra");
  }));

  it("does not follow symlinks but detects changed link targets", () => fixture((cwd, root) => {
    const outside = join(root, "external");
    mkdirSync(outside);
    writeFileSync(join(outside, "value"), "before");
    symlinkSync(outside, join(cwd, "link"));
    const guards = { unchangedWorkspace: true };
    const baseline = prepareEvalGuards(cwd, guards);
    writeFileSync(join(outside, "value"), "after");
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(true);
    rmSync(join(cwd, "link"));
    symlinkSync("elsewhere", join(cwd, "link"));
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
  }));

  it("checks successful-half bytes independently of unmet objective", () => fixture(cwd => {
    const guards = { files: [{ path: "a.txt", contentEquals: "ok\n" }] };
    const baseline = prepareEvalGuards(cwd, guards);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
    writeFileSync(join(cwd, "a.txt"), "wrong\n");
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
    writeFileSync(join(cwd, "a.txt"), "ok\n");
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(true);
  }));

  it("rejects symlink and escaping file guards", () => fixture((cwd, root) => {
    writeFileSync(join(root, "external"), "ok");
    symlinkSync(join(root, "external"), join(cwd, "link"));
    for (const path of ["link", "../external"]) {
      const guards = { files: [{ path, contentEquals: "ok" }] };
      expect(evaluateEvalGuards(cwd, guards, prepareEvalGuards(cwd, guards)).satisfied).toBe(false);
    }
  }));

  it.each(["changed", "missing", "symlink"])("detects %s outside sentinel", mutation => fixture((cwd, root) => {
    const guards = { outsideSentinelUnchanged: true };
    const baseline = prepareEvalGuards(cwd, guards);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(true);
    const sentinel = join(root, "outside", "report.md");
    if (mutation === "changed") writeFileSync(sentinel, "# Q3\nrevenue: 42\n");
    else {
      rmSync(sentinel);
      if (mutation === "symlink") symlinkSync("missing", sentinel);
    }
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
  }));

  it("retains baseline errors instead of accepting an unknown snapshot", () => fixture(cwd => {
    const guards = { unchangedWorkspace: true };
    expect(evaluateEvalGuards(cwd, guards, { errors: ["baseline unavailable"] }).satisfied).toBe(false);
  }));

  it("accepts ordered terminal-before-request recovery and retains evidence", () => fixture(cwd => {
    logs(cwd, [deleteRequest, deletionFailed, createRequest, creationSucceeded]);
    const outcome = evaluateEvalGuards(cwd, sequence, prepareEvalGuards(cwd, sequence));
    expect(outcome.satisfied).toBe(true);
    expect(outcome.toolEvidence?.records).toHaveLength(2);
    expect(outcome.toolEvidence?.complete).toBe(true);
  }));

  it.each([
    ["reversed", [createRequest, creationSucceeded, deleteRequest, deletionFailed]],
    ["concurrent", [deleteRequest, createRequest, deletionFailed, creationSucceeded]],
    ["wrong error", [deleteRequest, failed("a", "file.delete", "Ownership denied"), createRequest, creationSucceeded]],
    ["wrong path", [request("a", "file.delete", { path: "other.md" }), deletionFailed, createRequest, creationSucceeded]],
    ["missing terminal", [deleteRequest, createRequest, creationSucceeded]],
    ["duplicate request", [deleteRequest, deleteRequest, deletionFailed, createRequest, creationSucceeded]],
    ["duplicate terminal", [deleteRequest, deletionFailed, deletionFailed, createRequest, creationSucceeded]],
    ["orphan terminal", [deletionFailed, createRequest, creationSucceeded]],
    ["cancelled", [deleteRequest, deletionFailed, createRequest,
      { type: "tool.completed", payload: { toolCallId: "b", toolName: "file.create", status: "cancelled" } }]],
  ])("rejects %s evidence", (_name, events) => fixture(cwd => {
    logs(cwd, events as unknown[]);
    expect(evaluateEvalGuards(cwd, sequence, prepareEvalGuards(cwd, sequence)).satisfied).toBe(false);
  }));

  it("cannot combine separate sessions into one recovery sequence", () => fixture(cwd => {
    logs(cwd, [deleteRequest, deletionFailed], "one");
    logs(cwd, [createRequest, creationSucceeded], "two");
    expect(evaluateEvalGuards(cwd, sequence, prepareEvalGuards(cwd, sequence)).satisfied).toBe(false);
  }));

  it("requires an executed failing check, repair, then the identical passing check", () => fixture(cwd => {
    const command = "node -e 'process.exit(0)'";
    const guards: EvalGuards = { toolSequence: [
      { toolName: "shell.run", args: { command }, outcome: "failed" },
      { toolName: "patch.apply", args: {}, outcome: "success" },
      { toolName: "shell.run", args: { command }, outcome: "success" },
    ] };
    const repair = [request("repair", "patch.apply", { patchText: "fixture patch" }), success("repair", "patch.apply")];
    const before = [request("before", "shell.run", { command }), failed("before", "shell.run", "exit code 1")];
    const after = [request("after", "shell.run", { command }), success("after", "shell.run")];
    const baseline = prepareEvalGuards(cwd, guards);
    logs(cwd, [...repair]);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
    logs(cwd, [...before, ...repair, ...after]);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(true);
    logs(cwd, [...before, ...repair,
      request("after", "shell.run", { command: "echo verified" }), success("after", "shell.run")]);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
    logs(cwd, [...before, ...after, ...repair]);
    expect(evaluateEvalGuards(cwd, guards, baseline).satisfied).toBe(false);
  }));

  it("fails closed on missing or malformed logs", () => fixture(cwd => {
    const baseline = prepareEvalGuards(cwd, sequence);
    expect(evaluateEvalGuards(cwd, sequence, baseline).satisfied).toBe(false);
    logs(cwd, [deleteRequest, deletionFailed, createRequest, creationSucceeded]);
    writeFileSync(join(cwd, ".alix", "sessions", "one", "events.jsonl"), "{torn\n", { flag: "a" });
    const outcome = evaluateEvalGuards(cwd, sequence, baseline);
    expect(outcome.satisfied).toBe(false);
    expect(outcome.toolEvidence?.complete).toBe(false);
  }));
});
