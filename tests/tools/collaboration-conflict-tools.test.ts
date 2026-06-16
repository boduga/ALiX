import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createCollaborationTools } from "../../src/tools/collaboration-tools.js";
import type { WorkerCollaborationAPI } from "../../src/kernel/worker-collaboration-api.js";
import type { FindingConflict } from "../../src/kernel/collaboration-conflict-types.js";

function makeFakeApi(opts: {
  reportConflictResult?: string;
  listConflictsResult?: FindingConflict[];
}): WorkerCollaborationAPI {
  let lastReportArgs: any = null;
  let lastListArgs: any = null;
  return {
    publishFinding: async () => "f1",
    publishArtifact: async () => "a1",
    queryFindings: async () => [],
    getDependencyResults: async () => [],
    reportConflict: async (input: any) => {
      lastReportArgs = input;
      return opts.reportConflictResult ?? "conflict_test_1";
    },
    listConflicts: async (filter?: { statuses?: any; relatedFindingIds?: string[]; limit?: number }) => {
      lastListArgs = filter;
      const arr = opts.listConflictsResult ?? [];
      const limit = filter?.limit ?? arr.length;
      return arr.slice(0, limit);
    },
    __lastReportArgs: () => lastReportArgs,
    __lastListArgs: () => lastListArgs,
  } as any;
}

describe("collaboration conflict tools", () => {
  it("report_conflict tool cannot set run/worker identity", async () => {
    const api = makeFakeApi({});
    const tools = createCollaborationTools(api);
    const report = tools.find(t => t.definition.name === "collaboration.report_conflict")!;
    // Schema must NOT include runId/workerId/attempt properties.
    const props = (report.definition.inputSchema as any).properties;
    assert.equal(typeof props.runId, "undefined");
    assert.equal(typeof props.workerId, "undefined");
    assert.equal(typeof props.attempt, "undefined");

    // Handler ignores any runId/workerId in args.
    const result = await report.handler({
      findingIds: ["fA", "fB"],
      reason: "test",
      runId: "evil",
      workerId: "evil",
    });
    const parsed = JSON.parse(result);
    assert.ok(parsed.conflictId);
  });

  it("list_conflicts bounded output: default limit, cap at 50", async () => {
    const conflicts: FindingConflict[] = Array.from({ length: 60 }, (_, i) => ({
      id: `c_${i}`,
      schemaVersion: "1.0" as const,
      runId: "r1",
      conflictFingerprint: `fp_${i}`,
      topicKey: `t_${i}`,
      type: "contradiction",
      status: "detected",
      findingIds: [`fA_${i}`, `fB_${i}`],
      claimComparisons: [],
      evidenceComparison: {
        ranking: [], confidence: "low", scoreMargin: 0,
        recommendation: "human_review", unresolvedReasons: [],
      },
      detectedBy: ["deterministic"],
      criticality: "warning",
      blocksDownstreamByPolicy: false,
      history: [{ action: "created", at: new Date().toISOString() }],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const api = makeFakeApi({ listConflictsResult: conflicts });
    const tools = createCollaborationTools(api);
    const list = tools.find(t => t.definition.name === "collaboration.list_conflicts")!;

    // Custom limit is respected.
    const result5 = await list.handler({ limit: 5 });
    const parsed5 = JSON.parse(result5);
    assert.equal(parsed5.length, 5);

    // Cap is 50.
    const resultMax = await list.handler({ limit: 1000 });
    const parsedMax = JSON.parse(resultMax);
    assert.equal(parsedMax.length, 50);
  });
});
