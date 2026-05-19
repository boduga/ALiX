export type ModelCapabilities = {
  provider: string;
  model: string;
  inputTokenLimit: number;
  outputTokenLimit: number;
  effectiveContextBudget?: number;
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision: boolean;
};

export type NegotiatedCapabilities = {
  contextBudget: number;
  outputBudget: number;
  editFormat: "structured_patch" | "search_replace";
  toolsEnabled: boolean;
  structuredOutputEnabled: boolean;
  visionEnabled: boolean;
};