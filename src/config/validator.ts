import type { AlixConfig, ConfigValidationResult, ValidationIssue } from "./schema.js";

export function validateConfig(config: AlixConfig): ConfigValidationResult {
  const issues: ValidationIssue[] = [];

  // model.name must be a non-empty string
  if (!config.model.name || typeof config.model.name !== "string") {
    issues.push({ path: "model.name", level: "error", message: "model.name must be a non-empty string" });
  }

  // ui.port must be 1024-65535
  if (config.ui.port < 1024 || config.ui.port > 65535) {
    issues.push({ path: "ui.port", level: "warning", message: `Port ${config.ui.port} is outside typical range (1024-65535)` });
  }

  // Warn when ui.host is explicitly set to 0.0.0.0 — should use loopback
  if (config.ui.host === "0.0.0.0") {
    issues.push({ path: "ui.host", level: "warning", message: "Binding to 0.0.0.0 exposes Inspector on all interfaces. Set ui.host to 127.0.0.1 for loopback-only." });
  }

  // context.maxRepoMapTokens must be positive integer
  if (!Number.isInteger(config.context.maxRepoMapTokens) || config.context.maxRepoMapTokens <= 0) {
    issues.push({ path: "context.maxRepoMapTokens", level: "error", message: "maxRepoMapTokens must be a positive integer" });
  }

  // runtime.commandTimeoutMs must be positive
  if (config.runtime.commandTimeoutMs <= 0) {
    issues.push({ path: "runtime.commandTimeoutMs", level: "error", message: "commandTimeoutMs must be positive" });
  }

  // permissions.protectedPaths must be strings
  for (const p of config.permissions.protectedPaths) {
    if (typeof p !== "string") issues.push({ path: "permissions.protectedPaths", level: "error", message: "protectedPaths must contain only strings" });
  }

  // permissions.denyCommands must be strings
  for (const cmd of config.permissions.denyCommands) {
    if (typeof cmd !== "string") issues.push({ path: "permissions.denyCommands", level: "error", message: "denyCommands must contain only strings" });
  }

  // permissions.default must be "ask" | "allow" | "deny"
  if (!["ask","allow","deny"].includes(config.permissions.default)) {
    issues.push({ path: "permissions.default", level: "error", message: "permissions.default must be ask, allow, or deny" });
  }

  // context.repoMapMode must be "lite" | "full"
  if (!["lite","full"].includes(config.context.repoMapMode)) {
    issues.push({ path: "context.repoMapMode", level: "error", message: "context.repoMapMode must be lite or full" });
  }

  // runtime.provider must be "process" | "docker" | "remote"
  if (!["process","docker","remote"].includes(config.runtime.provider)) {
    issues.push({ path: "runtime.provider", level: "error", message: "runtime.provider must be process, docker, or remote" });
  }

  return { valid: issues.filter(i => i.level === "error").length === 0, issues };
}