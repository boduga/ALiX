/**
 * P4.7 — Capability routing evidence tests.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../src/workflow/evidence-writer.js";

function tmpDir(): string {
  const dir = join("/tmp", "ev-test-" + randomUUID().slice(0, 8));
  mkdirSync(dir, { recursive: true, mode: 0o755 });
  return dir;
}

describe("capability routing evidence", () => {
  let dir: string;
  let store: EvidenceStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    dir = tmpDir();
    store = new EvidenceStore({ storeDir: dir });
    writer = new EvidenceEventWriter((t, p) => store.append(t, p));
  });

  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("records agent_resolved", async () => {
    const r = await writer.recordAgentResolved(61, {
      capability: "workflow.planning",
      agentId: "workflow.planning",
      step: "plan",
    });
    expect(r).not.toBeNull();
    expect(r!.type).toBe("agent_resolved");
    expect(r!.payload.agentId).toBe("workflow.planning");
  });

  it("records capability_routed with candidate IDs", async () => {
    const r = await writer.recordCapabilityRouted(61, {
      capability: "workflow.review",
      resolvedAgent: "workflow.review",
      candidates: 3,
      candidateAgentIds: ["workflow.review", "workflow.review.v2"],
    });
    expect(r).not.toBeNull();
    expect(r!.type).toBe("capability_routed");
    expect(r!.payload.candidates).toBe(3);
    expect(r!.payload.candidateAgentIds).toEqual(["workflow.review", "workflow.review.v2"]);
  });

  it("both types are queryable", async () => {
    await writer.recordAgentResolved(61, { capability: "a", agentId: "x", step: "s" });
    await writer.recordCapabilityRouted(61, { capability: "b", resolvedAgent: "y", candidates: 1 });
    const query = await store.query({ limit: 10 });
    expect(query.records.length).toBe(2);
  });
});
