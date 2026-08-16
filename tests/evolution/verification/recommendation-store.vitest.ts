/**
 * A2.5 — RecommendationStore persistence tests (Q-A8-REC).
 *
 * Pins the honest A2.5-owned recommendation surface consumed by the A8
 * RecommendationsAdapter:
 *   - Storage is `.alix/verification/recommendations.jsonl` — a DEDICATED
 *     A2.5 path, NOT the P9.x `.alix/governance/recommendations.jsonl`
 *     (namespace/path collision resolved explicitly per the ruling).
 *   - append-only (shared JsonlStore): identical-content duplicate append is
 *     a deterministic no-op; different-content-same-id is a FATAL identity
 *     collision (surfaced, never merged).
 *   - records are verbatim A2.5 GovernanceRecommendation (vocabulary
 *     unchanged); A8 reads ONLY through the read-only adapter.
 *
 * Mirrors the A9 forecast persistence suite (tests/evolution/a9-persistence
 * .vitest.ts), which exercises the same shared JsonlStore.
 */

import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { RecommendationStore } from "../../../src/evolution/verification/recommendation/recommendation-store.js";
import type { GovernanceRecommendation } from "../../../src/evolution/verification/contracts/recommendation-contract.js";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

function makeRecommendation(
  overrides: Partial<GovernanceRecommendation> = {},
): GovernanceRecommendation {
  return {
    recommendationId: overrides.recommendationId ?? "rec-1",
    evidenceId: overrides.evidenceId ?? "ev-1",
    proposalId: overrides.proposalId ?? "prop-1",
    kind: overrides.kind ?? "APPROVE",
    confidence: overrides.confidence ?? 0.9,
    reasoning: overrides.reasoning ?? "all checks passed",
    supportingEvidence: overrides.supportingEvidence ?? ["ev-1"],
    risks: overrides.risks ?? [],
    createdAt: overrides.createdAt ?? "2026-08-01T00:00:00.000Z",
  };
}

// ---------------------------------------------------------------------------
// Harness — temp store dir per test (never touches real .alix/verification/)
// ---------------------------------------------------------------------------

describe("RecommendationStore (A2.5-owned, Q-A8-REC)", () => {
  it("defaults to .alix/verification/recommendations.jsonl relative to cwd — NOT the P9.x governance path", async () => {
    const store = new RecommendationStore();
    const filePath = (store as unknown as { filePath: string }).filePath;
    // Dedicated A2.5 namespace: the namespace/path collision with P9.x
    // `.alix/governance/recommendations.jsonl` is resolved explicitly.
    expect(filePath).toBe(
      join(process.cwd(), ".alix", "verification", "recommendations.jsonl"),
    );
    expect(filePath).not.toContain(join(".alix", "governance"));
  });

  it("append → list round-trips the recommendation with recommendationId intact", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    const rec = makeRecommendation();
    expect(await store.append(rec)).toBe(true);

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(rec);
    // Id preserved verbatim (never recomputed or altered by the store).
    expect(all[0]!.recommendationId).toBe("rec-1");
  });

  it("getById returns the stored recommendation; missing id → null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    const rec = makeRecommendation();
    await store.append(rec);
    expect(await store.getById("rec-1")).toEqual(rec);
    expect(await store.getById("not-stored")).toBeNull();
  });

  it("stores distinct recommendations (different recommendationId → both stored)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    await store.append(makeRecommendation({ recommendationId: "rec-1" }));
    await store.append(makeRecommendation({ recommendationId: "rec-2", proposalId: "prop-2" }));
    const all = await store.list();
    expect(all).toHaveLength(2);
    expect(new Set(all.map((r) => r.recommendationId)).size).toBe(2);
  });

  it("empty store → list() is [] and getById returns null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    expect(await store.list()).toEqual([]);
    expect(await store.getById("any")).toBeNull();
  });

  it("appending an identical recommendation twice is a deterministic no-op", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    const rec = makeRecommendation();
    expect(await store.append(rec)).toBe(true);
    // Same id + same canonical content → dedupe no-op (never rewritten).
    expect(await store.append(rec)).toBe(false);
    expect(await store.list()).toHaveLength(1);
  });

  it("a different-content same-id append is a FATAL identity collision — throws, no overwrite", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    const rec = makeRecommendation();
    await store.append(rec);

    // Same recommendationId but DIFFERENT content (confidence changes) →
    // deterministic identity collision: surfaced, never silently merged.
    const tampered = makeRecommendation({ confidence: 0.5 });
    await expect(store.append(tampered)).rejects.toThrow(/identity collision/i);
    // The original artifact is untouched.
    expect(await store.list()).toEqual([rec]);
  });

  it("skips corrupt lines on read; a later append still works (raw bytes preserved)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    const rec = makeRecommendation();
    await store.append(rec);
    await writeFile(join(dir, "recommendations.jsonl"), "not-json\n", { flag: "a" });

    // Corrupt line skipped; valid record intact.
    expect(await store.list()).toEqual([rec]);
    expect(await store.getById("rec-1")).toEqual(rec);

    // Appending after a corrupt line works; corrupt line never rewritten away.
    const second = makeRecommendation({ recommendationId: "rec-2", proposalId: "prop-2" });
    expect(await store.append(second)).toBe(true);
    expect(await store.list()).toHaveLength(2);
  });

  it("tmp-then-rename atomic append leaves a valid file and no .tmp leftover", async () => {
    const dir = await mkdtemp(join(tmpdir(), "a25-recs-"));
    const store = new RecommendationStore(dir);
    await store.append(makeRecommendation());
    await store.append(makeRecommendation({ recommendationId: "rec-2", proposalId: "prop-2" }));

    const entries = await readdir(dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
    expect(entries).toContain("recommendations.jsonl");

    // Re-open through a fresh store instance to prove the file is stable JSONL.
    const fresh = new RecommendationStore(dir);
    expect(await fresh.list()).toEqual(await store.list());
  });

  it("exposes only append/list/getById — no update/delete/remove mutation surface", async () => {
    const methodNames = (() => {
      const names = new Set<string>();
      let proto = RecommendationStore.prototype;
      while (proto && proto !== Object.prototype) {
        for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
        proto = Object.getPrototypeOf(proto);
      }
      return [...names];
    })();
    expect(methodNames).toContain("append");
    expect(methodNames).toContain("list");
    expect(methodNames).toContain("getById");
    for (const mutation of ["update", "delete", "remove", "upsert", "replace"]) {
      expect(methodNames).not.toContain(mutation);
    }
  });
});
