import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeReportArtifacts } from "../../src/sop/artifact-writer.js";
import type { WriteReportOpts } from "../../src/sop/artifact-writer.js";

describe("Report manifest", () => {
  let tmpDir = "";

  before(() => { tmpDir = mkdtempSync(join(tmpdir(), "report-test-")); });
  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  const baseOpts: WriteReportOpts = {
    cwd: tmpDir,
    reportId: "report_test_1",
    artifacts: {
      finalReport: "# Test Report\n\nContent.",
      sources: [{ url: "https://example.com", title: "Example", credibility: "high" }],
      claims: [{ claim: "Test claim", sourceUrl: "https://example.com" }],
      criticReview: "No issues found.",
    },
    graphId: "graph_test_abc",
    sopId: "research.deep_report",
    topic: "test topic",
  };

  it("writes manifest with graphId and sopId", async () => {
    const dir = await writeReportArtifacts(baseOpts);
    const manifest = JSON.parse(readFileSync(join(dir, "run_manifest.json"), "utf-8"));
    assert.equal(manifest.graphId, "graph_test_abc");
    assert.equal(manifest.sopId, "research.deep_report");
    assert.equal(manifest.topic, "test topic");
  });

  it("writes manifest with nodeResults", async () => {
    const opts = { ...baseOpts, reportId: "report_test_2", nodeResults: [{ nodeId: "n1", title: "Search", status: "done" }] };
    const dir = await writeReportArtifacts(opts);
    const manifest = JSON.parse(readFileSync(join(dir, "run_manifest.json"), "utf-8"));
    assert.equal(manifest.nodeResults.length, 1);
    assert.equal(manifest.nodeResults[0].title, "Search");
  });

  it("writes all artifact files", async () => {
    const dir = await writeReportArtifacts({ ...baseOpts, reportId: "report_test_3" });
    assert.ok(existsSync(join(dir, "final_report.md")));
    assert.ok(existsSync(join(dir, "sources.json")));
    assert.ok(existsSync(join(dir, "claims.json")));
    assert.ok(existsSync(join(dir, "critic_review.md")));
    assert.ok(existsSync(join(dir, "run_manifest.json")));
  });

  it("report ID is returned in directory path", async () => {
    const dir = await writeReportArtifacts({ ...baseOpts, reportId: "report_test_4" });
    assert.ok(dir.includes("report_test_4"));
  });
});
