/**
 * coordination-evidence.test.ts — C4: changed-file evidence is explicit.
 *
 * `worker.status === "completed"` is not proof the workspace changed. Before
 * this change the coordination tool derived the run's changed files from the
 * *ownership scopes* of completed workers — assigned paths presented as
 * executed evidence. These tests pin the replacement: evidence comes from
 * explicit mutation records only, paths are containment-checked, and worker
 * status is not an input at all.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { deriveCoordinationChangedFiles, deriveCoordinationEvidence } from "../../src/kernel/coordination-evidence.js";

const CWD = "/workspace";
const resolver = {
  resolve: (raw: string) => (raw.startsWith("/") ? raw : join(CWD, raw)),
  isInWorkspace: (absolute: string) => absolute === CWD || absolute.startsWith(`${CWD}/`),
  isCanonicalInWorkspace: (absolute: string) => absolute === CWD || absolute.startsWith(`${CWD}/`),
};
const options = { cwd: CWD, pathResolver: resolver };

describe("deriveCoordinationChangedFiles", () => {
  it("yields nothing for a completed worker with no mutation evidence", () => {
    // The old derivation would have answered with the worker's ownership scopes.
    const changed = deriveCoordinationChangedFiles({}, options);
    assert.deepEqual(changed, []);
  });

  it("accepts an explicit mutation event", () => {
    const changed = deriveCoordinationChangedFiles(
      { events: [{ type: "file.created", payload: { path: "a.md" } }] },
      options,
    );
    assert.deepEqual(changed, ["a.md"]);
  });

  it("accepts an explicit worker report", () => {
    const changed = deriveCoordinationChangedFiles(
      { workerReports: [{ workerId: "w1", changedFiles: ["a.md"] }] },
      options,
    );
    assert.deepEqual(changed, ["a.md"]);
  });

  it("ignores read-only work: no mutation events means no evidence", () => {
    // A read-heavy session (file.read / grep / glob) emits no mutation events.
    const changed = deriveCoordinationChangedFiles(
      {
        events: [
          { type: "tool.completed", payload: { path: "a.md" } },
          { type: "context.assembled", payload: { paths: ["a.md", "b.md"] } },
        ],
      },
      options,
    );
    assert.deepEqual(changed, []);
  });

  it("deduplicates deterministically, including across workers", () => {
    const evidence = deriveCoordinationEvidence(
      {
        events: [
          { type: "file.created", payload: { path: "b.md" } },
          { type: "file.created", payload: { path: "a.md" } },
        ],
        workerReports: [
          { workerId: "w1", changedFiles: ["a.md", "b.md"] },
          { workerId: "w2", changedFiles: ["b.md"] },
        ],
      },
      options,
    );
    assert.deepEqual(evidence.workspaceMutationEvidence, ["a.md", "b.md"]);
    assert.deepEqual(evidence.changedFiles, ["a.md", "b.md"]);
  });

  it("rejects paths outside the workspace", () => {
    const changed = deriveCoordinationChangedFiles(
      {
        events: [{ type: "file.created", payload: { path: "../../etc/passwd" } }],
        workerReports: [{ workerId: "w1", changedFiles: ["/etc/shadow", "/elsewhere/x.md"] }],
      },
      options,
    );
    assert.deepEqual(changed, []);
  });

  it("rejects glob entries, which describe intent rather than written files", () => {
    const changed = deriveCoordinationChangedFiles(
      { workerReports: [{ workerId: "w1", changedFiles: [".tmp/out/**", "src/*.ts"] }] },
      options,
    );
    assert.deepEqual(changed, []);
  });

  it("keeps mutation evidence when a worker reports it alongside other evidence", () => {
    // Worker success/failure is orthogonal to whether it wrote something: the
    // report carries the mutation regardless of how the worker ended.
    const evidence = deriveCoordinationEvidence(
      { workerReports: [{ workerId: "w-failed", changedFiles: ["written-before-failure.md"] }] },
      options,
    );
    assert.deepEqual(evidence.changedFiles, ["written-before-failure.md"]);
  });

  it("keeps artifact evidence separate from workspace mutation evidence", () => {
    const evidence = deriveCoordinationEvidence(
      {
        events: [
          { type: "artifact.created", payload: { path: ".alix/sessions/s1/artifacts/tool-output-1.json" } },
          { type: "file.created", payload: { path: "report.md" } },
        ],
      },
      options,
    );
    assert.deepEqual(evidence.artifactEvidence, [".alix/sessions/s1/artifacts/tool-output-1.json"]);
    assert.deepEqual(evidence.workspaceMutationEvidence, ["report.md"]);
    assert.deepEqual(
      evidence.changedFiles,
      ["report.md"],
      "an artifact is not proof the workspace changed",
    );
  });

  it("treats artifacts as mutation evidence only when the caller says the contract does", () => {
    const input = {
      events: [{ type: "artifact.created", payload: { path: "out/artifact.md" } }],
      artifactsAssertWorkspaceChange: true,
    };
    assert.deepEqual(deriveCoordinationChangedFiles(input, options), ["out/artifact.md"]);
  });
});

describe("changed-file evidence wiring", () => {
  it("does not use worker status as mutation proof anywhere in src", () => {
    // The exact anti-pattern this change removes: completed workers' ownership
    // scopes presented as the run's changed files.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const source = readFileSync(path, "utf8");
        if (source.includes("flatMap(worker => worker.ownershipScopes")) offenders.push(path);
      }
    };
    walk("src");
    assert.deepEqual(offenders, []);
  });

  it("routes the coordination tool through the explicit-evidence derivation", () => {
    const source = readFileSync("src/kernel/coordination-tools.ts", "utf8");
    assert.ok(
      source.includes("deriveCoordinationEvidence"),
      "the run handler must derive changed files from explicit evidence",
    );
    assert.ok(
      !/filter\(worker => worker\.status === "completed"\)\s*\.flatMap/.test(source),
      "no path may turn completed workers into changed files",
    );
  });
});
