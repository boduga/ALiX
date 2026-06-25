/**
 * P9.6 — InvestigationStore tests.
 *
 * @module
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvestigationStore } from "../../src/governance/investigation-store.js";
import type { InvestigationRecommendation } from "../../src/governance/investigation-types.js";

function makeInv(overrides: Partial<InvestigationRecommendation> = {}): InvestigationRecommendation {
  const base: InvestigationRecommendation = {
    id: overrides.id ?? "test-inv-001",
    kind: "chain_restoration",
    status: "open",
    severity: "high",
    source: "drift",
    sourceArtifactId: "drift-report-001",
    evidenceRefs: ["ev-001"],
    title: "Chain coverage drop detected",
    description: "Evidence chain usage dropped below threshold",
    operatorGuidance: "Investigate why proposals bypass provenance",
    createdAt: new Date().toISOString(),
  };
  return { ...base, ...overrides };
}

let storeDir: string;
let store: InvestigationStore;

beforeEach(() => {
  storeDir = mkdtempSync(join(tmpdir(), "investigation-store-"));
  store = new InvestigationStore(storeDir);
});

afterEach(() => {
  rmSync(storeDir, { recursive: true, force: true });
});

describe("InvestigationStore", () => {
  it("save writes a JSONL entry", async () => {
    const inv = makeInv({ id: "inv-001" });
    await store.save(inv);
    const filePath = join(storeDir, "investigations.jsonl");
    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.id).toBe("inv-001");
  });

  it("get returns null for missing id", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeNull();
  });

  it("get returns saved investigation", async () => {
    const inv = makeInv({ id: "inv-002" });
    await store.save(inv);
    const result = await store.get("inv-002");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("inv-002");
    expect(result!.kind).toBe("chain_restoration");
  });

  it("list returns all saved investigations", async () => {
    await store.save(makeInv({ id: "inv-a" }));
    await store.save(makeInv({ id: "inv-b" }));
    const results = await store.list();
    expect(results.length).toBe(2);
  });

  it("list filters by kind", async () => {
    await store.save(makeInv({ id: "inv-c", kind: "chain_restoration" }));
    await store.save(makeInv({ id: "inv-d", kind: "governance_integrity" }));
    const filtered = await store.list({ kind: "chain_restoration" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("inv-c");
  });

  it("list filters by status", async () => {
    await store.save(makeInv({ id: "inv-e", status: "open" }));
    await store.save(makeInv({ id: "inv-f", status: "resolved" }));
    const filtered = await store.list({ status: "open" });
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe("inv-e");
  });

  it("list returns empty array when file missing", async () => {
    rmSync(storeDir, { recursive: true, force: true });
    mkdtempSync(join(tmpdir(), "investigation-store-")); // placeholder for re-init
    // Note: InvestigationStore doesn't create the file until first save;
    // if storeDir doesn't exist, list returns empty
    const empty = await new InvestigationStore(join(tmpdir(), "nowhere-store")).list();
    expect(empty).toEqual([]);
  });

  it("updateStatus appends a new version (does not rewrite in place)", async () => {
    await store.save(makeInv({ id: "inv-g", status: "open" }));
    await store.updateStatus("inv-g", "in_progress");
    const result = await store.get("inv-g");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("in_progress");
    expect(result!.updatedAt).toBeDefined();

    // Verify the file has 2 entries (append-only)
    const filePath = join(storeDir, "investigations.jsonl");
    const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
  });

  it("updateStatus with resolved sets resolvedAt and resolution", async () => {
    await store.save(makeInv({ id: "inv-h", status: "open" }));
    await store.updateStatus("inv-h", "resolved", { resolution: "Fixed in PR #200" });
    const result = await store.get("inv-h");
    expect(result).not.toBeNull();
    expect(result!.status).toBe("resolved");
    expect(result!.resolvedAt).toBeDefined();
    expect(result!.resolution).toBe("Fixed in PR #200");
  });

  it("updateStatus on missing id is a silent no-op", async () => {
    await expect(store.updateStatus("nonexistent", "resolved")).resolves.not.toThrow();
    const all = await store.list();
    expect(all.length).toBe(0);
  });

  it("list resolves latest version per id", async () => {
    await store.save(makeInv({ id: "inv-i", status: "open", title: "v1" }));
    await store.updateStatus("inv-i", "in_progress");
    await store.updateStatus("inv-i", "resolved", { resolution: "Done" });
    const all = await store.list();
    const inv = all.find((i) => i.id === "inv-i");
    expect(inv).toBeDefined();
    expect(inv!.status).toBe("resolved");
    expect(inv!.resolution).toBe("Done");
  });
});
