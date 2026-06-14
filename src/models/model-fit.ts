/**
 * model-fit.ts — Rank profiles by hardware fit, use case, and mode preference.
 *
 * When --mode is provided, it acts as a filter (only profiles of that mode).
 */

import type { ProfileData } from "../config/profile-types.js";
import { matchHardware, type SystemInfo, type HardwareMatchResult } from "../config/profile-registry.js";

export type FitRanking = { profile: ProfileData; rank: number; status: "best fit" | "alternative" | "not recommended"; reasons: string[]; compatibility: "compatible" | "partial" | "incompatible" };
export type FitOptions = { role?: string; mode?: string };

const ROLE_BIAS: Record<string, { local: number; cloud: number }> = {
  coder: { local: 8, cloud: 7 },
  researcher: { local: 4, cloud: 9 },
  planner: { local: 5, cloud: 7 },
  critic: { local: 5, cloud: 8 },
  general: { local: 6, cloud: 6 },
};

export function rankProfiles(system: SystemInfo, profiles: ProfileData[], options: FitOptions = {}): FitRanking[] {
  const scores: FitRanking[] = [];
  for (const profile of profiles) {
    if (options.mode && profile.mode !== options.mode) continue;
    const result = matchHardware(profile, system);
    const reasons = [...result.reasons];
    let score = 0;
    if (result.status === "incompatible") {
      scores.push({ profile, rank: 0, status: "not recommended", reasons, compatibility: "incompatible" });
      continue;
    }
    if (result.status === "compatible") { score += 10; reasons.push("Fits available hardware"); }
    else { score += 5; reasons.push("Partially fits hardware"); }
    const role = options.role || "general";
    const bias = ROLE_BIAS[role] || ROLE_BIAS.general!;
    score += profile.mode.startsWith("local") ? bias.local : bias.cloud;
    if (profile.models.embeddings) score += 1;
    if (profile.fallbacks?.enabled) score += 1;
    if (profile.mode === "local-first") {
      reasons.push("Uses local models for default/planner/coder");
      if (profile.fallbacks?.enabled) reasons.push("Keeps cloud fallback for research");
    } else if (profile.mode === "cloud-first") {
      reasons.push("Best quality with API models");
      if (profile.fallbacks?.enabled) reasons.push("Has local fallback option");
    }
    if (profile.id === "minimal-local") { /* already covered by reasons */ }
    if (profile.id === "balanced-local") reasons.push("Good latency/quality balance");
    if (profile.id === "power-local" && result.status === "partial") reasons.push("Coder tier likely too large for this machine");
    if (profile.id === "cloud-balanced" || profile.id === "all-cloud") {
      if (result.status === "compatible") reasons.push("Higher cost");
    }
    const status: FitRanking["status"] = result.status === "compatible" ? "best fit" : result.status === "partial" ? "alternative" : "not recommended";
    if (result.status === "partial" && score >= 15) { /* still alternative, not best fit */ }
    scores.push({ profile, rank: score, status, reasons, compatibility: result.status });
  }
  return scores.sort((a, b) => b.rank - a.rank);
}
