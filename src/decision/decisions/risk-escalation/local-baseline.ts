/**
 * local-baseline.ts — Deterministic risk-escalation baseline (J6).
 *
 * Conservative by construction: an unknown capability or an ambiguous
 * description escalates (medium), never clears (low). This baseline is the
 * comparison arm and the fallback — never the authority, which stays with
 * deterministic policy via `composeApproval`.
 */

import type { RiskTier } from "./schema.js";
import type { RiskEscalationProjection } from "./projection.js";

/** Capabilities that only observe. Everything else is at least medium. */
const READ_ONLY_CAPABILITIES = new Set([
  "file.read",
  "file.search",
  "git.diff",
  "web.search",
  "web.fetch",
]);

/** Whole-word destructive markers. */
const DESTRUCTIVE_RE =
  /\b(?:rm\s+-rf|mkfs|format|delete|drop|destroy|overwrite|--force|chmod\s+777|\|\s*(?:ba)?sh\b|sudo|passwd|crontab|dd\b)\b/;

/** Whole-word mutation markers. */
const MUTATION_RE =
  /\b(?:write|create|delete|patch|apply|push|publish|deploy|install|modify|remove|rename|move|truncate)\b/;

export type LocalRiskVerdict = {
  tier: RiskTier;
  reason: string;
};

export function classifyRiskLocally(projection: RiskEscalationProjection): LocalRiskVerdict {
  // A read-only capability cannot mutate, so destructive or mutation language
  // in its summary is descriptive by construction — never a trigger.
  if (READ_ONLY_CAPABILITIES.has(projection.capability)) {
    return { tier: "low", reason: "read-only capability cannot mutate" };
  }
  const text = `${projection.capability} ${projection.summary} ${projection.detail}`.toLowerCase();
  if (DESTRUCTIVE_RE.test(text)) {
    return { tier: "high", reason: "destructive marker present" };
  }
  if (MUTATION_RE.test(text)) {
    return { tier: "medium", reason: "mutation marker present" };
  }
  return { tier: "medium", reason: "unknown capability or effect: escalate" };
}
