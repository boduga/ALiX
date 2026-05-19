import type { ModelCapabilities, NegotiatedCapabilities } from "./types.js";

export type NegotiationContext = {
  taskType?: "code_edit" | "exploration" | "planning" | "ui_review" | "bugfix" | "test" | "docs";
  sessionMode?: "auto" | "ask" | "bypass";
  maxTokens?: number;
};

const PROVIDER_DEFAULTS: Record<string, {
  contextBudgetRatio: number;
  editFormat: NegotiatedCapabilities["editFormat"];
  visionEnabled: boolean;
  structuredOutputEnabled: boolean;
}> = {
  anthropic: {
    contextBudgetRatio: 0.8,
    editFormat: "structured_patch",
    visionEnabled: false,
    structuredOutputEnabled: true,
  },
  openai: {
    contextBudgetRatio: 0.7,
    editFormat: "structured_patch",
    visionEnabled: true,
    structuredOutputEnabled: true,
  },
  google: {
    contextBudgetRatio: 0.75,
    editFormat: "search_replace",
    visionEnabled: true,
    structuredOutputEnabled: true,
  },
  ollama: {
    contextBudgetRatio: 0.5,
    editFormat: "search_replace",
    visionEnabled: false,
    structuredOutputEnabled: false,
  },
};

export class CapabilityNegotiator {
  negotiate(caps: ModelCapabilities, ctx: NegotiationContext = {}): NegotiatedCapabilities {
    const providerDefaults = PROVIDER_DEFAULTS[caps.provider] ?? PROVIDER_DEFAULTS["ollama"];

    // Calculate context budget
    const effectiveBudget = caps.effectiveContextBudget ?? Math.floor(caps.inputTokenLimit * providerDefaults.contextBudgetRatio);
    const contextBudget = ctx.maxTokens ? Math.min(effectiveBudget, ctx.maxTokens) : effectiveBudget;

    // Determine edit format based on provider and task
    let editFormat = providerDefaults.editFormat;
    if (ctx.taskType === "exploration" || ctx.taskType === "planning") {
      editFormat = "search_replace";
    }

    // Vision: enable for UI tasks if supported
    const visionEnabled = caps.supportsVision && (ctx.taskType === "ui_review" || providerDefaults.visionEnabled);

    // Structured output: enable for planning if supported
    const structuredOutputEnabled = caps.supportsStructuredOutput && (ctx.taskType === "planning" || providerDefaults.structuredOutputEnabled);

    return {
      contextBudget,
      outputBudget: caps.outputTokenLimit,
      editFormat,
      toolsEnabled: caps.supportsTools,
      structuredOutputEnabled,
      visionEnabled,
    };
  }
}