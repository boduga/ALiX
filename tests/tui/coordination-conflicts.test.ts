import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatCoordinationPanel } from "../../src/tui/coordination-panel.js";
import type { CoordinationPanelData, CoordinationPanelViewMode } from "../../src/tui/coordination-panel.js";
import type { CoordinationRunView, CoordinationConflictView } from "../../src/kernel/coordination-view.js";

function makeView(): CoordinationRunView {
  return {
    run: {
      id: "coord_1", goal: "test", status: "running", outcome: undefined,
      workerCount: 0, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    workers: [],
    approvals: [],
    ownershipLeases: [],
    failureChains: [],
    freshness: "fresh",
    events: [],
    conflictCount: 2,
    conflicts: [
      {
        id: "conflict_aaa",
        topicKey: "topic_alpha",
        type: "contradiction",
        status: "detected",
        criticality: "warning",
        findingCount: 2,
        evidenceRecommendation: "human_review",
        evidenceConfidence: "low",
        scoreMargin: 0.15,
        detectedBy: ["deterministic"],
        updatedAt: new Date().toISOString(),
      },
      {
        id: "conflict_bbb",
        topicKey: "topic_beta",
        type: "competing_decision",
        status: "under_review",
        criticality: "critical",
        findingCount: 3,
        evidenceRecommendation: "prefer_stronger_evidence",
        evidenceConfidence: "high",
        scoreMargin: 0.5,
        detectedBy: ["model_assisted"],
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function makeData(mode: CoordinationPanelViewMode, view: CoordinationRunView): CoordinationPanelData {
  return {
    view,
    selectedWorkerIndex: 0,
    viewMode: mode,
    selectedConflictIndex: 0,
  };
}

describe("coordination conflict panel", () => {
  it("renders conflict count and detail lines", () => {
    const data = makeData("conflicts", makeView());
    const lines = formatCoordinationPanel(data);
    const text = lines.join("\n");
    assert.ok(text.includes("Conflicts"));
    assert.ok(text.includes("conflict_aaa"));
    assert.ok(text.includes("contradiction"));
    assert.ok(text.includes("detected"));
    assert.ok(text.includes("topic_alpha"));
    // Selected conflict detail (selectedConflictIndex=0)
    assert.ok(text.includes("Detected by:"));
    assert.ok(text.includes("deterministic"));
  });

  it("handles empty conflicts with a 'no unresolved' message", () => {
    const view = makeView();
    view.conflicts = [];
    view.conflictCount = 0;
    const data = makeData("conflicts", view);
    const lines = formatCoordinationPanel(data);
    const text = lines.join("\n");
    assert.ok(text.includes("no unresolved"));
  });

  it("does NOT import ConflictRepository or CollaborationStore", () => {
    const source = readFileSync("src/tui/coordination-panel.ts", "utf-8");
    assert.ok(!source.includes("ConflictRepository"));
    assert.ok(!source.includes("CollaborationStore"));
  });
});
