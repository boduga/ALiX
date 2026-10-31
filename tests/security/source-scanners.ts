/**
 * source-scanners.ts — the source-text scanners `pre-r032-non-bypass` asserts on.
 *
 * WHY THIS IS A MODULE
 *
 * The first version of those tests asserted a clean result while being unable to
 * produce a dirty one: `offenders` was declared and never populated, and the
 * "would this catch a bad input?" cases re-implemented the regex inline next to
 * the real one. That is the worst shape for a guard test — the copy passes while
 * the scanner drifts, so the test proves the copy works, not the guard.
 *
 * Keeping the scan here means the test calls the SAME function the assertions
 * use, so exercising the failure path is exercising the real path.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Files under `root` whose content reads an eligibility/promotion record AND decides. */
export function scanEligibilityWidening(root: string): string[] {
  const offenders: string[] = [];
  for (const file of walkTypeScript(root)) {
    const body = readFileSync(file, "utf-8");
    if (eligibilityWideningPattern(body)) offenders.push(file);
  }
  return offenders;
}

/**
 * The pattern itself, exported so a test can prove it matches.
 *
 * Requires BOTH an eligibility reference and decision logic: a file that merely
 * mentions eligibility is not the bypass this guard exists for.
 */
export function eligibilityWideningPattern(body: string): boolean {
  return /eligibility/i.test(body) && /decision/i.test(body);
}

/** Count `status = "consumed"` assignments — the single-writer invariant. */
export function countConsumedWriters(source: string): number {
  return (source.match(/\.status\s*=\s*"consumed"/g) ?? []).length;
}

/**
 * Guards that must each be present, independently, in the approval store.
 *
 * Removing any one would let a stale or foreign approval authorize an
 * invocation, so the check is per-guard and not a single combined test.
 */
export const REQUIRED_APPROVAL_GUARDS: readonly RegExp[] = [
  /status !== "approved"/,
  /approvalExpiryState\(r\.expiresAt, now\)/,
  /expiryState === "invalid"/,
  /expiryState === "expired"/,
  /bindingKey !== expectedBindingKey/,
  /invocationMatches/,
];

/** Which required guards are absent from `source`. Empty = all present. */
export function missingApprovalGuards(source: string): string[] {
  return REQUIRED_APPROVAL_GUARDS.filter((guard) => !guard.test(source)).map(String);
}

function walkTypeScript(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTypeScript(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}
