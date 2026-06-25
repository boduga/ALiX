/**
 * P10.4b — adaptation-types.ts additive invariant sentinel.
 *
 * Source-text greps assert that BOTH documented P10.4b additions are present
 * in src/adaptation/adaptation-types.ts:
 *  1. ProposalAction includes "executive_remediation_request"
 *  2. ProposalTarget includes { kind: "executive_remediation", ... }
 *
 * Per ADR-0004: protected type files are structurally protected, not byte-identical.
 * Additive union members are Allowed. The sentinel asserts presence of the
 * documented additions; it does not (and cannot, via source-text grep) prove
 * no other additions were made. Snapshot-equal sentinel pattern with
 * protected-baselines.ts is a future evolution.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const ADAPTATION_TYPES_PATH = resolve(REPO_ROOT, "src/adaptation/adaptation-types.ts");

function readAdaptationTypesSource(): string {
  return readFileSync(ADAPTATION_TYPES_PATH, "utf8");
}

describe("P10.4b — adaptation-types.ts additive invariant", () => {
  it("ProposalAction includes 'executive_remediation_request'", () => {
    const src = readAdaptationTypesSource();
    expect(src).toMatch(/"executive_remediation_request"/);
  });

  it("ProposalTarget includes 'executive_remediation' kind", () => {
    const src = readAdaptationTypesSource();
    expect(src).toMatch(/kind:\s*"executive_remediation"/);
  });

  it("executive-bridge.ts is in the executive directory allowlist", () => {
    // Cross-check: the new file is registered for executive-purity scanning.
    const allowlistPath = resolve(REPO_ROOT, "tests/executive/executive-sentinels.vitest.ts");
    const allowlistSrc = readFileSync(allowlistPath, "utf8");
    expect(allowlistSrc).toMatch(/"src\/executive\/executive-bridge\.ts"/);
  });
});
