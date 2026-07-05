/**
 * P12.2 — Autonomous governance risk scoring.
 *
 * Pure scoring module — classifies an autonomous run as low | medium | high | critical
 * with numeric score and explainable factors.
 *
 * Core invariant: score, don't gate. P12.2 is a "risk thermometer", not a decision maker.
 * No approval workflow coupling (P12.3), no persistence (P12.4).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskFactor {
  name: string;
  score: number;        // 0–100 numeric contribution
  level: RiskLevel;     // derived from score range
  description: string;  // explainable prose
}

export interface RiskScore {
  level: RiskLevel;
  score: number;         // 0–100 overall
  factors: RiskFactor[];
}

export type ActionType =
  | "read"
  | "edit"
  | "create"
  | "delete"
  | "destructive"
  | "release"
  | "proposal";

export type VerificationStatus =
  | "passed"
  | "typecheck"
  | "none"
  | "failed";

export interface ScoringInput {
  files: string[];
  actionType: ActionType;
  verificationStatus: VerificationStatus;
  labels: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreToLevel(score: number): RiskLevel {
  if (score <= 25) return "low";
  if (score <= 50) return "medium";
  if (score <= 75) return "high";
  return "critical";
}

// ---------------------------------------------------------------------------
// File scope scoring
// ---------------------------------------------------------------------------

const SECRETS_PATTERNS = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)infra\//,
  /(^|\/)deploy\//,
  /(^|\/)secrets\//,
  /(^|\/)credentials\//,
];

const SECURITY_PATTERNS = [
  /src\/security\//,
  /src\/auth\//,
];

const SOURCE_PATTERNS = [
  /src\//,
];

export function scoreFileScope(files: string[]): RiskFactor {
  if (files.length === 0) {
    return { name: "File scope", score: 0, level: "low", description: "No files changed" };
  }

  let maxLevel: RiskLevel = "low";
  let maxScore = 0;

  for (const f of files) {
    if (SECRETS_PATTERNS.some((p) => p.test(f))) {
      maxScore = 90;
      maxLevel = "critical";
    } else if (SECURITY_PATTERNS.some((p) => p.test(f)) && maxLevel !== "critical") {
      maxScore = 70;
      maxLevel = "high";
    } else if (SOURCE_PATTERNS.some((p) => p.test(f)) && maxLevel === "low") {
      maxScore = 40;
      maxLevel = "medium";
    }
  }

  // If only docs/tests matched (never escalated), set the docs score explicitly
  if (maxLevel === "low" && maxScore === 0 && files.length > 0) {
    maxScore = 10;
  }

  const domain =
    maxLevel === "critical"
      ? "secrets/infra/deploy files"
      : maxLevel === "high"
        ? "security/auth files"
        : maxLevel === "medium"
          ? "source files"
          : "docs/tests files";

  const example = files.length > 0 ? ` (e.g. ${files[0]})` : "";

  return {
    name: "File scope",
    score: maxScore,
    level: maxLevel,
    description: `${domain}${example}`,
  };
}

// ---------------------------------------------------------------------------
// File count scoring
// ---------------------------------------------------------------------------

export function scoreFileCount(count: number): RiskFactor {
  let score: number;
  let level: RiskLevel;

  if (count <= 0) {
    score = 0;
    level = "low";
  } else if (count <= 3) {
    score = 10;
    level = "low";
  } else if (count <= 6) {
    score = 35;
    level = "medium";
  } else if (count <= 10) {
    score = 65;
    level = "high";
  } else {
    score = 85;
    level = "critical";
  }

  return {
    name: "File count",
    score,
    level,
    description: `${count} file${count !== 1 ? "s" : ""} changed`,
  };
}

// ---------------------------------------------------------------------------
// Action type scoring
// ---------------------------------------------------------------------------

const ACTION_SCORES: Record<ActionType, { score: number; level: RiskLevel }> = {
  read: { score: 5, level: "low" },
  proposal: { score: 5, level: "low" },
  edit: { score: 40, level: "medium" },
  create: { score: 65, level: "high" },
  delete: { score: 65, level: "high" },
  destructive: { score: 90, level: "critical" },
  release: { score: 90, level: "critical" },
};

export function scoreActionType(actionType: ActionType): RiskFactor {
  const { score, level } = ACTION_SCORES[actionType];
  return {
    name: "Action type",
    score,
    level,
    description: `${actionType} action`,
  };
}

// ---------------------------------------------------------------------------
// Verification scoring
// ---------------------------------------------------------------------------

const VERIFICATION_SCORES: Record<VerificationStatus, { score: number; level: RiskLevel }> = {
  passed: { score: 5, level: "low" },
  typecheck: { score: 35, level: "medium" },
  none: { score: 65, level: "high" },
  failed: { score: 90, level: "critical" },
};

export function scoreVerification(verificationStatus: VerificationStatus): RiskFactor {
  const { score, level } = VERIFICATION_SCORES[verificationStatus];
  return {
    name: "Verification",
    score,
    level,
    description: `Verification: ${verificationStatus}`,
  };
}

// ---------------------------------------------------------------------------
// Labels scoring
// ---------------------------------------------------------------------------

const LABEL_SCORES: Record<string, { score: number; level: RiskLevel }> = {
  docs: { score: 10, level: "low" },
  test: { score: 10, level: "low" },
  bug: { score: 35, level: "medium" },
  chore: { score: 35, level: "medium" },
  feature: { score: 65, level: "high" },
  enhancement: { score: 65, level: "high" },
  security: { score: 85, level: "critical" },
  infra: { score: 85, level: "critical" },
};

export function scoreLabels(labels: string[]): RiskFactor {
  if (labels.length === 0) {
    return { name: "Labels", score: 0, level: "low", description: "No labels" };
  }

  let maxScore = 0;
  let maxLevel: RiskLevel = "low";

  for (const label of labels) {
    const mapped = LABEL_SCORES[label];
    if (mapped && mapped.score > maxScore) {
      maxScore = mapped.score;
      maxLevel = mapped.level;
    }
  }

  // No recognised labels
  if (maxScore === 0) {
    return {
      name: "Labels",
      score: 5,
      level: "low",
      description: `Labels: ${labels.join(", ")}`,
    };
  }

  return {
    name: "Labels",
    score: maxScore,
    level: maxLevel,
    description: `${maxLevel} risk label(s): ${labels.filter((l) => LABEL_SCORES[l]).join(", ")}`,
  };
}

// ---------------------------------------------------------------------------
// Overall scoring
// ---------------------------------------------------------------------------

/**
 * Compute overall risk score for an autonomous run.
 *
 * Overall score = max(factorScores) — one critical factor dominates.
 * No averaging: secrets, failed verification, or security labels make the whole run critical.
 *
 * Deterministic: identical input always produces identical output.
 * No side effects, no DB, no approval coupling.
 */
export function computeRiskScore(input: ScoringInput): RiskScore {
  const factors: RiskFactor[] = [
    scoreFileScope(input.files),
    scoreFileCount(input.files.length),
    scoreActionType(input.actionType),
    scoreVerification(input.verificationStatus),
    scoreLabels(input.labels),
  ];

  const maxScore = Math.max(...factors.map((f) => f.score));

  return {
    level: scoreToLevel(maxScore),
    score: maxScore,
    factors,
  };
}

// ---------------------------------------------------------------------------
// CLI parsing and validation
// ---------------------------------------------------------------------------

export interface CLIOpts {
  files: string[];
  action: string;
  verification: string;
  labels: string[];
  json: boolean;
}

export function parseRiskScoreArgs(args: string[]): CLIOpts {
  const opts: CLIOpts = {
    files: [],
    action: "read",
    verification: "none",
    labels: [],
    json: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--json") {
      opts.json = true;
      continue;
    }

    if (arg === "--action") {
      opts.action = args[++i] ?? opts.action;
      continue;
    }

    if (arg === "--verification") {
      opts.verification = args[++i] ?? opts.verification;
      continue;
    }

    if (arg === "--labels") {
      opts.labels = (args[++i] ?? "")
        .split(",")
        .map((label: string) => label.trim())
        .filter(Boolean);
      continue;
    }

    if (arg === "--files") {
      while (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        opts.files.push(args[++i]);
      }
      continue;
    }

    // Positional args treated as files
    if (!arg.startsWith("--")) {
      opts.files.push(arg);
    }
  }

  return opts;
}

const VALID_ACTIONS: string[] = ["read", "edit", "create", "delete", "destructive", "release", "proposal"];
const VALID_VERIFICATIONS: string[] = ["passed", "typecheck", "none", "failed"];

const LEVEL_COLORS: Record<RiskLevel, string> = {
  low: "\x1b[32m",
  medium: "\x1b[33m",
  high: "\x1b[38;5;208m",
  critical: "\x1b[31m",
};

const RESET = "\x1b[0m";

export function riskScoreCLI(args: string[]): void {
  const { files, action, verification, labels, json } = parseRiskScoreArgs(args);

  // Reject invalid CLI values rather than silently normalizing
  if (!VALID_ACTIONS.includes(action)) {
    console.error(`Error: Invalid action type "${action}". Valid: ${VALID_ACTIONS.join(", ")}`);
    process.exit(1);
  }
  if (!VALID_VERIFICATIONS.includes(verification)) {
    console.error(`Error: Invalid verification status "${verification}". Valid: ${VALID_VERIFICATIONS.join(", ")}`);
    process.exit(1);
  }

  const input: ScoringInput = {
    files: files.length > 0 ? files : [],
    actionType: action as ActionType,
    verificationStatus: verification as VerificationStatus,
    labels,
  };

  const result = computeRiskScore(input);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const color = LEVEL_COLORS[result.level];
  console.log(`Risk Score: ${color}${result.level.toUpperCase()}${RESET} (${result.score}/100)`);
  console.log("");
  console.log("Factors:");
  for (const f of result.factors) {
    const fc = LEVEL_COLORS[f.level];
    console.log(`  ${fc}${f.level.toUpperCase().padEnd(9)}${RESET} ${f.name.padEnd(14)} ${f.description}`);
  }
}
