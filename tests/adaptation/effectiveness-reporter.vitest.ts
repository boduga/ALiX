import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EvidenceStore } from "../../src/security/evidence/evidence-store.js";
import { EffectivenessReporter } from "../../src/adaptation/effectiveness-reporter.js";
import type { AdaptationProposal } from "../../src/adaptation/adaptation-types.js";

let n = 0;
function line(type: string, ts: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ version: 1, id: `${type}-${n++}`, type, timestamp: ts, fingerprint: `fp-${n}`, payload });
}
const T = "2026-06-12T00:00:00.000Z"; // appliedAt boundary
function proposal(sourceRecommendationType: string): AdaptationProposal {
  return { id: "prop-1", createdAt: "2026-06-11T00:00:00.000Z", status: "applied", action: "create_agent_card", target: { kind: "agent_card", id: "x" }, payload: {}, sourceRecommendationType, sourceConfidence: 0.9, evidenceFingerprints: [], reason: "r", appliedAt: T };
}

describe("EffectivenessReporter", () => {
  let dir: string; let store: EvidenceStore;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "eff-")); store = new EvidenceStore({ storeDir: dir }); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("recommends keep when unresolvedCapabilities drops", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), [
      ...Array.from({ length: 5 }, () => line("capability_routed", "2026-06-10T00:00:00Z", { candidates: 0 })), // before: 5 unresolved
      ...Array.from({ length: 5 }, () => line("capability_routed", "2026-06-15T00:00:00Z", { candidates: 2 })),   // after: 0 unresolved
    ].join("\n") + "\n");
    const r = await new EffectivenessReporter(store).assess(proposal("capability_gap"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.primary?.metric).toBe("unresolvedCapabilities");
    expect(r.recommendation).toBe("keep");
  });

  it("recommends revert on >10% regression", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), [
      ...Array.from({ length: 2 }, () => line("capability_routed", "2026-06-10T00:00:00Z", { candidates: 2 })),  // before: 0 unresolved
      ...Array.from({ length: 5 }, () => line("capability_routed", "2026-06-15T00:00:00Z", { candidates: 0 })),   // after: 5 unresolved (regression)
    ].join("\n") + "\n");
    const r = await new EffectivenessReporter(store).assess(proposal("capability_gap"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.recommendation).toBe("revert");
  });

  it("recommends investigate with insufficient data", async () => {
    const r = await new EffectivenessReporter(store).assess(proposal("capability_gap"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.recommendation).toBe("investigate");
  });

  it("recommends investigate for manual-action process_change", async () => {
    writeFileSync(join(dir, "evidence.jsonl"), line("merge_completed", "2026-06-10T00:00:00Z") + "\n" + line("merge_completed", "2026-06-15T00:00:00Z") + "\n");
    const r = await new EffectivenessReporter(store).assess(proposal("process_change"), { now: "2026-06-19T00:00:00.000Z" });
    expect(r.recommendation).toBe("investigate");
    expect(r.primary).toBeNull();
  });

  it("throws on a non-applied proposal", async () => {
    const p = proposal("capability_gap"); p.status = "pending"; delete p.appliedAt;
    await expect(new EffectivenessReporter(store).assess(p)).rejects.toThrow(/expected "applied"/);
  });
});
