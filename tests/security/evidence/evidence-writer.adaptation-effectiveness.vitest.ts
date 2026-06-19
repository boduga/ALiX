import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../../src/security/evidence/evidence-store.js";
import { EvidenceEventWriter } from "../../../src/workflow/evidence-writer.js";

describe("EvidenceEventWriter — adaptation_effectiveness", () => {
  let dir: string;
  let store: EvidenceStore;
  let writer: EvidenceEventWriter;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "adapt-eff-"));
    store = new EvidenceStore({ storeDir: dir });
    writer = new EvidenceEventWriter((type, payload) => store.append(type, payload));
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("records an adaptation_effectiveness event with proposalId and full payload", async () => {
    const rec = await writer.recordAdaptationEffectiveness("prop-1", {
      recommendation: "keep",
      primaryMetric: "unresolvedCapabilities",
      assessedAt: "2026-06-19T00:00:00.000Z",
    });
    expect(rec).not.toBeNull();
    expect(rec!.type).toBe("adaptation_effectiveness");
    expect(rec!.payload.proposalId).toBe("prop-1");
    expect(rec!.payload.recommendation).toBe("keep");
    expect(rec!.payload.primaryMetric).toBe("unresolvedCapabilities");
    expect(rec!.payload.assessedAt).toBe("2026-06-19T00:00:00.000Z");

    const result = await store.query({ type: "adaptation_effectiveness" });
    expect(result.total).toBe(1);
    expect(result.records[0].payload.proposalId).toBe("prop-1");
  });

  it("records null primaryMetric for manual-action proposals", async () => {
    const rec = await writer.recordAdaptationEffectiveness("prop-2", {
      recommendation: "investigate",
      primaryMetric: null,
      assessedAt: "2026-06-19T00:00:00.000Z",
    });
    expect(rec).not.toBeNull();
    expect(rec!.payload.primaryMetric).toBeNull();
  });
});