import type { NormalizedMessage } from "./types.js";

export type CompileOptions = {
  systemInstruction?: string;
  memory?: string;
  policySummary?: string;
  tools?: string;
  chatHistory: NormalizedMessage[];
  format?: "openai" | "gemini";
};

export type CompiledPrompt = {
  systemInstruction?: string;
  topLevelSystemInstruction?: string;
  chatHistory: NormalizedMessage[];
  warnings?: string[];
};

const SUSPICIOUS_PATTERNS = [
  /ignore (previous|all) (instructions|context)/i,
  /disregard (previous|all)/i,
  /forget (everything|previous)/i,
  /^you are now /i,
  /^system: /i,
];

export class PromptCompiler {
  constructor(private options: { format?: "openai" | "gemini" } = {}) {}

  compile(input: CompileOptions): CompiledPrompt {
    const warnings: string[] = [];

    // Check chat history for suspicious content
    for (const msg of input.chatHistory) {
      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(content)) {
          warnings.push(`Suspicious content detected in ${msg.role} message`);
        }
      }
    }

    const systemParts: string[] = [];
    if (input.systemInstruction) {
      systemParts.push(input.systemInstruction);
    }
    if (input.memory) {
      systemParts.push(`## Context\n${input.memory}`);
    }
    if (input.policySummary) {
      systemParts.push(`## Policy\n${input.policySummary}`);
    }
    if (input.tools) {
      systemParts.push(`## Tools\n${input.tools}`);
    }

    const systemInstruction = systemParts.join("\n\n");

    if (this.options.format === "gemini") {
      return {
        topLevelSystemInstruction: systemInstruction,
        chatHistory: input.chatHistory,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    return {
      systemInstruction: systemInstruction || undefined,
      chatHistory: input.chatHistory,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }
}