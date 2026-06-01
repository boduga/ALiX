import type { ModelAdapter, ToolDef } from "../providers/types.js";
import { buildEditFormatPolicy } from "../patch/edit-format-policy.js";
import { BASE_TOOLS, patchFormatDescription, patchTextDescription } from "../run/helpers.js";
import type { ContextBundle } from "../repomap/context-compiler.js";

export function buildErrorMessage(err: { kind: "error"; message: string; retryable?: boolean; hint?: string }): string {
  const parts: string[] = [`Error: ${err.message}`];
  if (err.hint) parts.push(`Hint: ${err.hint}`);
  if (err.retryable === false) parts.push("This error is fatal — do not retry this tool.");
  else if (err.retryable === true) parts.push("This error may be transient — retrying may help.");
  return parts.join(" ");
}

export function buildToolsForProvider(provider: Pick<ModelAdapter, "editFormatPreference">): ToolDef[] {
  const policy = buildEditFormatPolicy({ provider: "runtime", preferred: provider.editFormatPreference });
  return BASE_TOOLS.map((tool) => {
    if (tool.name !== "alix_patch_apply") return tool;
    return {
      ...tool,
      input_schema: {
        ...tool.input_schema,
        properties: {
          ...tool.input_schema.properties,
          format: {
            type: "string",
            enum: policy.allowed,
            description: patchFormatDescription(policy)
          },
          patchText: {
            type: "string",
            description: patchTextDescription(policy.preferred)
          }
        }
      }
    };
  });
}

export function buildContextBundleEventPayload(contextBundle: ContextBundle) {
  return {
    taskType: contextBundle.taskType,
    budget: contextBundle.budget,
    primaryFiles: contextBundle.primaryFiles,
    tests: contextBundle.tests,
    supportingFiles: contextBundle.supportingFiles,
    pinned: contextBundle.pinned,
  };
}

export function buildModelUsageEventPayload(provider: string, model: string, usage: { inputTokens: number; outputTokens: number }) {
  return { provider, model, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
}

export function renderContextBundleForPrompt(contextBundle: ContextBundle): string {
  const lines: string[] = ["## Context Files"];
  if (contextBundle.primaryFiles.length > 0) {
    const files = contextBundle.primaryFiles.filter(f => f.kind === "file");
    const symbols = contextBundle.primaryFiles.filter(f => f.kind === "symbol");
    if (files.length > 0) {
      lines.push(`Primary files: ${files.map(f => `${f.path} (${f.reason})`).join(", ")}`);
    }
    if (symbols.length > 0) {
      lines.push(`Symbols: ${symbols.map(f => `${f.symbolName}@${f.path}:${f.lineStart} (${f.reason})`).join(", ")}`);
    }
  }
  if (contextBundle.tests.length > 0) {
    lines.push(`Related tests: ${contextBundle.tests.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  if (contextBundle.supportingFiles.length > 0) {
    lines.push(`Supporting files: ${contextBundle.supportingFiles.map(f => `${f.path} (${f.reason})`).join(", ")}`);
  }
  return lines.join("\n");
}