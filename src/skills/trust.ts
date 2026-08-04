/**
 * Layer 3 of skill pre-install safety: source trust model + install gate.
 *
 * Registration of a marketplace is itself the trust decision: skills installed
 * by name from a registered marketplace inherit that marketplace's level
 * (verified-marketplace for the bundled defaults, user-registered otherwise).
 * Arbitrary URLs/paths are unsigned and require explicit confirmation.
 *
 * The gate is deterministic (decideInstall) so tests exercise the matrix; the
 * interactive prompt is injected via createInstallGate.
 */

import { createInterface } from "node:readline/promises";
import type { ManifestReport, SkillScanResult } from "./security.js";

export type TrustLevel = "core" | "verified-marketplace" | "user-registered" | "unsigned";

export interface TrustAssessment {
  level: TrustLevel;
  sourceLabel: string;
  reason: string;
}

export interface TrustSource {
  name: string;
  url: string;
}

/** Level a source URL. A source "under" a marketplace URL inherits its level. */
export function assessTrust(
  source: string,
  opts: { marketplaces: TrustSource[]; verifiedUrls?: readonly string[]; coreSources?: readonly string[] },
): TrustAssessment {
  for (const core of opts.coreSources ?? []) {
    if (source.startsWith(core)) {
      return { level: "core", sourceLabel: source, reason: "source is a bundled/core skill origin" };
    }
  }
  const normalized = source.replace(/\/+$/, "");
  const verified = opts.verifiedUrls ?? [];
  for (const mp of opts.marketplaces) {
    const mpUrl = mp.url.replace(/\/+$/, "");
    if (normalized === mpUrl || normalized.startsWith(mpUrl + "/")) {
      const level: TrustLevel = verified.some((v) => v.replace(/\/+$/, "") === mpUrl)
        ? "verified-marketplace"
        : "user-registered";
      return { level, sourceLabel: mpUrl, reason: `registered marketplace '${mp.name}'` };
    }
  }
  return { level: "unsigned", sourceLabel: source, reason: "arbitrary source not tied to a registered marketplace" };
}

// ---------------------------------------------------------------------------
// Install gate
// ---------------------------------------------------------------------------

export type InstallGateDecision =
  | { outcome: "approve"; reason: string }
  | { outcome: "deny"; reason: string }
  | { outcome: "confirm"; reason: string };

export interface InstallGateInput {
  name: string;
  source: string;
  trust: TrustAssessment;
  manifest: ManifestReport;
  scan: SkillScanResult | null;
  force: boolean;
  interactive: boolean;
  requireConfirmation: boolean;
}

/**
 * Pure decision logic. Order matters:
 * 1. Hard scan errors / spoofed-core manifest always deny (not force-able).
 * 2. Core trusts approve.
 * 3. --force bypasses confirmation.
 * 4. Confirmation disabled by config approves.
 * 5. Non-interactive non-core fails closed (no way to prompt).
 * 6. Otherwise ask.
 */
export function decideInstall(input: InstallGateInput): InstallGateDecision {
  if (input.scan && !input.scan.ok) {
    return {
      outcome: "deny",
      reason: `script scan found ${input.scan.errorCount} denied file(s) — refusing to install '${input.name}'`,
    };
  }
  if (input.manifest.deny) {
    return {
      outcome: "deny",
      reason: `manifest check failed (${input.manifest.denyCode ?? "denied"}) — refusing to install '${input.name}'`,
    };
  }
  if (input.trust.level === "core") {
    return { outcome: "approve", reason: "core skill — no confirmation required" };
  }
  if (input.force) {
    return { outcome: "approve", reason: "forced install (--force) — trust confirmation skipped" };
  }
  if (!input.requireConfirmation) {
    return { outcome: "approve", reason: "confirmation disabled by config" };
  }
  if (!input.interactive) {
    return {
      outcome: "deny",
      reason: `non-interactive install of non-core skill '${input.name}' requires --force`,
    };
  }
  return { outcome: "confirm", reason: "requires interactive confirmation" };
}

/** Human-readable pre-install report shown to the user (and echoed to evidence). */
export function renderInstallReport(input: InstallGateInput): string {
  const lines: string[] = [
    `Skill: ${input.name}`,
    `Source: ${input.source}`,
    `Trust: ${input.trust.level} (${input.trust.reason})`,
    `Requested tools: ${input.manifest.requestedTools.length > 0 ? input.manifest.requestedTools.join(", ") : "(none declared)"}`,
    input.manifest.license ? `License: ${input.manifest.license}` : "License: (none declared)",
  ];
  if (input.manifest.requires.length > 0) {
    lines.push(`Requires: ${input.manifest.requires.join(", ")}`);
  }
  if (input.scan && input.scan.findings.length > 0) {
    lines.push(`Scan findings (${input.scan.findings.length}):`);
    for (const f of input.scan.findings) lines.push(`  [${f.severity}] ${f.message}`);
  } else {
    lines.push("Scan: clean");
  }
  return lines.join("\n");
}

type PromptFn = (report: string) => Promise<boolean>;

async function defaultPrompt(report: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(report);
    const answer = await rl.question("Install this skill? [y/N]: ");
    return answer.trim().toLowerCase() === "y";
  } finally {
    rl.close();
  }
}

export interface GateResult {
  outcome: "approve" | "deny";
  /** The decision reason — recorded verbatim to the evidence store. */
  reason: string;
}

/** Gate runner with injectable prompt (tests stub the prompt; CLI uses stdin). */
export function createInstallGate(promptFn?: PromptFn): (input: InstallGateInput) => Promise<GateResult> {
  return async (input) => {
    const decision = decideInstall(input);
    if (decision.outcome === "approve") return { outcome: "approve", reason: decision.reason };
    if (decision.outcome === "deny") return { outcome: "deny", reason: decision.reason };
    const ask = promptFn ?? defaultPrompt;
    const ok = await ask(renderInstallReport(input));
    return ok
      ? { outcome: "approve", reason: "user confirmed interactive prompt" }
      : { outcome: "deny", reason: "user declined interactive prompt" };
  };
}
