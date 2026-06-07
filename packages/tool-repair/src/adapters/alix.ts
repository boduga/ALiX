/**
 * ALiX adapter -- wraps ToolRepair for use in ALiX's ToolExecutor.
 * Determines model from config, applies repairs pre-execution,
 * and returns both repaired args and a hint string.
 */
import { ToolRepair } from "../index.js";
import type { RepairOutcome } from "../types.js";

export class AlixToolRepair {
  private repair: ToolRepair;

  constructor(
    private provider: string,
    private modelName: string
  ) {
    const modelKey = normalizeModelKey(provider, modelName);
    this.repair = new ToolRepair(modelKey);
  }

  process(toolName: string, args: Record<string, unknown>): RepairOutcome {
    return this.repair.process(toolName, args);
  }
}

function normalizeModelKey(provider: string, model: string): string {
  const lower = model.toLowerCase();
  const prov = provider.toLowerCase();

  if (prov === "deepseek") {
    if (lower.includes("v4-flash") || lower.includes("flash")) return "deepseek-v4-flash";
    if (lower.includes("v4") || lower.includes("chat")) return "deepseek-v4-pro";
    return lower.replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  if (prov === "anthropic") {
    if (lower.includes("opus")) return "claude-opus-4.8";
    return "claude-opus-4.8";
  }

  if (prov === "google") {
    if (lower.includes("gemini")) return "gemini-2.5-pro";
    return lower.replace(/[^a-zA-Z0-9_.-]/g, "_");
  }

  return lower.replace(/[^a-zA-Z0-9_.-]/g, "_");
}
