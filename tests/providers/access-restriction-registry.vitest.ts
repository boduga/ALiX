/**
 * access-restriction-registry.vitest.ts — Unit tests for the bounded-lifetime
 * OpenRouter access-restriction registry.
 *
 * Verifies: a model recorded as access-restricted is excluded until its TTL
 * expires; re-assertion refreshes the deadline; expired entries are pruned and
 * the model is implicitly revalidated (reported as no longer restricted).
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  recordAccessRestricted,
  accessRestrictedModelIds,
  _resetAccessRestrictionRegistryForTesting,
  _setAccessRestrictionTtlForTesting,
} from "../../src/providers/access-restriction-registry.js";

describe("access-restriction-registry", () => {
  beforeEach(() => {
    _resetAccessRestrictionRegistryForTesting();
  });

  it("is empty initially", () => {
    expect(accessRestrictedModelIds().size).toBe(0);
  });

  it("excludes a recorded model within its window", () => {
    const now = 1_000_000;
    recordAccessRestricted("a/free", now);
    const ids = accessRestrictedModelIds(now);
    expect(ids.has("a/free")).toBe(true);
    expect(ids.size).toBe(1);
  });

  it("does not report the model after the TTL expires (revalidated)", () => {
    _setAccessRestrictionTtlForTesting(1000);
    const now = 1_000_000;
    recordAccessRestricted("a/free", now);
    // Just before expiry: still restricted.
    expect(accessRestrictedModelIds(now + 999).has("a/free")).toBe(true);
    // At/after expiry: pruned and revalidated — no longer restricted.
    expect(accessRestrictedModelIds(now + 1000).has("a/free")).toBe(false);
  });

  it("prunes expired entries so queries stay bounded", () => {
    _setAccessRestrictionTtlForTesting(1000);
    const now = 1_000_000;
    recordAccessRestricted("a/free", now);
    recordAccessRestricted("b/free", now);
    expect(accessRestrictedModelIds(now).size).toBe(2);
    // After expiry both are pruned; the map no longer holds them.
    expect(accessRestrictedModelIds(now + 1001).size).toBe(0);
  });

  it("re-assertion before expiry refreshes the deadline", () => {
    _setAccessRestrictionTtlForTesting(1000);
    const now = 1_000_000;
    recordAccessRestricted("a/free", now);
    // Refused again at now+900: deadline extends to now+1900.
    recordAccessRestricted("a/free", now + 900);
    expect(accessRestrictedModelIds(now + 1800).has("a/free")).toBe(true);
    expect(accessRestrictedModelIds(now + 1901).has("a/free")).toBe(false);
  });

  it("restrictions are isolated per model id", () => {
    const now = 1_000_000;
    recordAccessRestricted("a/free", now);
    // Unrelated model is never affected.
    expect(accessRestrictedModelIds(now).has("b/free")).toBe(false);
  });
});
