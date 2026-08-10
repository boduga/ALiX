import type { AlixConfig, ConfigValidationResult, ValidationIssue } from "./schema.js";

/** Returns true when host resolves to a loopback address. */
export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
}

export function validateConfig(config: AlixConfig): ConfigValidationResult {
  const issues: ValidationIssue[] = [];

  // models.default is the canonical persisted source; `model` is a loader-derived
  // projection that may be absent (e.g. an invalid-but-present default). Validate
  // the canonical entry so requireModel:false loads (models doctor/fit/list) can
  // surface diagnostics without crashing on an absent projection. A config with
  // NO `models` key at all (pre-migration) is left to the loader's requireModel
  // check rather than flagged here — only an explicitly-present-but-invalid
  // models.default is a validation error.
  const defaultModel = config.models?.default;
  if (config.models && (!defaultModel?.name || typeof defaultModel.name !== "string")) {
    issues.push({ path: "models.default.name", level: "error", message: "models.default.name must be a non-empty string" });
  }

  // Sections below may be ABSENT in a config fragment — the raw on-disk file
  // that ConfigMutationService validates is a partial overlay, not the
  // defaults-merged config loadConfig() validates. A missing section is
  // incomplete, not invalid (defaults fill it at load), so each section is
  // only checked when present.
  if (config.ui) {
    // ui.port must be 1024-65535
    if (config.ui.port < 1024 || config.ui.port > 65535) {
      issues.push({ path: "ui.port", level: "warning", message: `Port ${config.ui.port} is outside typical range (1024-65535)` });
    }

    // Warn when ui.host is explicitly set to 0.0.0.0 — should use loopback
    if (config.ui.host === "0.0.0.0") {
      issues.push({ path: "ui.host", level: "warning", message: "Binding to 0.0.0.0 exposes Inspector on all interfaces. Set ui.host to 127.0.0.1 for loopback-only." });
    }

    // ui.security validation
    const sec = config.ui.security;
    if (sec) {
      // Reject authentication-disabled mode on non-loopback hosts
      if (sec.authentication === "disabled-loopback-development" && !isLoopbackHost(config.ui.host)) {
        issues.push({ path: "ui.security.authentication", level: "error", message: "Authentication cannot be disabled on a non-loopback host. Set ui.host to 127.0.0.1, ::1, or localhost." });
      }

      // Warn when authentication is disabled
      if (sec.authentication === "disabled-loopback-development") {
        issues.push({ path: "ui.security.authentication", level: "warning", message: "Authentication is disabled. This is only acceptable for local development on loopback." });
      }

      // Reject remoteAccess: true with a non-loopback host — not yet approved without auth
      if (sec.remoteAccess && !isLoopbackHost(config.ui.host)) {
        issues.push({ path: "ui.security.remoteAccess", level: "error", message: "Remote access is not yet approved until authentication lands. Set remoteAccess to false or bind to a loopback address." });
      }

      // Validate allowedHosts entries
      if (!Array.isArray(sec.allowedHosts)) {
        issues.push({ path: "ui.security.allowedHosts", level: "error", message: "allowedHosts must be an array of strings" });
      }

      // Validate allowedOrigins entries
      if (!Array.isArray(sec.allowedOrigins)) {
        issues.push({ path: "ui.security.allowedOrigins", level: "error", message: "allowedOrigins must be an array of strings" });
      }

      // Validate trustedProxyCidrs entries
      if (!Array.isArray(sec.trustedProxyCidrs)) {
        issues.push({ path: "ui.security.trustedProxyCidrs", level: "error", message: "trustedProxyCidrs must be an array of strings" });
      }
    }
  }

  if (config.context) {
    // context.maxRepoMapTokens must be positive integer (when present — a
    // fragment omitting it is fine; the loader defaults it)
    if (config.context.maxRepoMapTokens !== undefined &&
        (!Number.isInteger(config.context.maxRepoMapTokens) || config.context.maxRepoMapTokens <= 0)) {
      issues.push({ path: "context.maxRepoMapTokens", level: "error", message: "maxRepoMapTokens must be a positive integer" });
    }
  }

  // context.budget output-reservation knobs (C0/C1) — budget may be a partial
  // object even when context is present.
  const budget = config.context?.budget;
  if (budget) {
    // Each knob is optional and defaults in createContextBudget; only a
    // DEFINED-and-invalid knob is an error (undefined → default later →
    // valid). This matters because mergeConfig shallow-merges `context`, so a
    // partial `budget: { outputFloor: 8192 }` legitimately leaves outputRatio
    // undefined and must not be flagged.
    if (budget.outputRatio !== undefined && (typeof budget.outputRatio !== "number" || !(budget.outputRatio > 0 && budget.outputRatio < 1))) {
      issues.push({ path: "context.budget.outputRatio", level: "error", message: "outputRatio must be a number strictly between 0 and 1" });
    }
    if (budget.outputFloor !== undefined && (!Number.isInteger(budget.outputFloor) || budget.outputFloor <= 0)) {
      issues.push({ path: "context.budget.outputFloor", level: "error", message: "outputFloor must be a positive integer" });
    }
    if (budget.outputCap !== undefined && (!Number.isInteger(budget.outputCap) || budget.outputCap <= 0)) {
      issues.push({ path: "context.budget.outputCap", level: "error", message: "outputCap must be a positive integer" });
    }
    if (budget.outputFloor !== undefined && budget.outputCap !== undefined && budget.outputFloor > budget.outputCap) {
      issues.push({ path: "context.budget.outputFloor", level: "error", message: "outputFloor cannot exceed outputCap" });
    }
    // §5: maxOutputTokens must be a positive integer. Values above outputCap
    // are allowed (clamped to budgetReservation ≤ policyReservation ≤ outputCap
    // at construction), so no cross-check is needed — the invariant holds
    // structurally in the factory.
    if (budget.maxOutputTokens !== undefined && (!Number.isInteger(budget.maxOutputTokens) || budget.maxOutputTokens <= 0)) {
      issues.push({ path: "context.budget.maxOutputTokens", level: "error", message: "maxOutputTokens must be positive integer" });
    }
  }

  if (config.runtime) {
    // runtime.commandTimeoutMs must be positive (when present — a fragment
    // omitting it is fine; the loader defaults it)
    if (config.runtime.commandTimeoutMs !== undefined && config.runtime.commandTimeoutMs <= 0) {
      issues.push({ path: "runtime.commandTimeoutMs", level: "error", message: "commandTimeoutMs must be positive" });
    }

    // runtime.provider must be "process" | "docker" | "remote" (when present —
    // a fragment omitting it is fine; the loader defaults it)
    if (config.runtime.provider !== undefined && !["process","docker","remote"].includes(config.runtime.provider)) {
      issues.push({ path: "runtime.provider", level: "error", message: "runtime.provider must be process, docker, or remote" });
    }
  }

  if (config.permissions) {
    // permissions.protectedPaths must be strings
    for (const p of config.permissions.protectedPaths ?? []) {
      if (typeof p !== "string") issues.push({ path: "permissions.protectedPaths", level: "error", message: "protectedPaths must contain only strings" });
    }

    // permissions.denyCommands must be strings
    for (const cmd of config.permissions.denyCommands ?? []) {
      if (typeof cmd !== "string") issues.push({ path: "permissions.denyCommands", level: "error", message: "denyCommands must contain only strings" });
    }

    // permissions.default must be "ask" | "allow" | "deny" (when present — a
    // fragment omitting it is fine; the loader defaults it to "ask")
    if (config.permissions.default !== undefined && !["ask","allow","deny"].includes(config.permissions.default)) {
      issues.push({ path: "permissions.default", level: "error", message: "permissions.default must be ask, allow, or deny" });
    }
  }

  // context.repoMapMode must be "lite" | "full" (when present — a fragment
  // omitting it is fine; the loader defaults it to "lite")
  if (config.context?.repoMapMode !== undefined && !["lite","full"].includes(config.context.repoMapMode)) {
    issues.push({ path: "context.repoMapMode", level: "error", message: "context.repoMapMode must be lite or full" });
  }

  return { valid: issues.filter(i => i.level === "error").length === 0, issues };
}