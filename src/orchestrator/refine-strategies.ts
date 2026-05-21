/**
 * Refine Strategies — Fabric-style patterns for the repair loop
 *
 * Strategies are applied when verification fails. Each strategy has:
 * - A trigger condition (what kind of failure)
 * - A refinement prompt (how to fix it)
 *
 * File format follows existing skill pattern: YAML front matter + markdown body
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { recommendStrategy } from "./strategy-learner.js";

export type RefineStrategyName = "retry" | "decompose" | "simplify" | "verify_only" | "analyze" | "escalate";

export interface RefineStrategy {
  name: RefineStrategyName;
  description: string;
  trigger: "syntax_error" | "logic_error" | "test_failure" | "scope_denied" | "any";
  template: string; // Template with {{failure}} and {{context}} placeholders
  temperature: number;
}

const STRATEGIES_DIR = join(process.cwd(), "src", "orchestrator", "refine-strategies");

/**
 * Load a refine strategy from file
 */
async function loadStrategy(name: string): Promise<RefineStrategy> {
  const strategyPath = join(STRATEGIES_DIR, `${name}.md`);
  const content = await readFile(strategyPath, "utf8");

  // Parse YAML front matter
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid strategy format: ${name}.md`);
  }

  const [, frontMatter, body] = match;
  const props = Object.fromEntries(
    frontMatter.split("\n").map((line) => {
      const [key, ...valueParts] = line.split(":");
      return [key.trim(), valueParts.join(":").trim()];
    })
  );

  return {
    name: props.name as RefineStrategyName,
    description: props.description ?? "",
    trigger: (props.trigger as RefineStrategy["trigger"]) ?? "any",
    template: body.trim(),
    temperature: parseFloat(props.temperature ?? "0.3"),
  };
}

/**
 * List available refine strategies
 */
export async function listStrategies(): Promise<string[]> {
  try {
    const files = await readdir(STRATEGIES_DIR);
    return files
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(".md", ""));
  } catch {
    return ["retry", "decompose", "simplify"];
  }
}

/**
 * Get a refine strategy by name
 */
export async function getStrategy(name: string): Promise<RefineStrategy> {
  try {
    return await loadStrategy(name);
  } catch {
    // Return default strategy
    return {
      name: "retry",
      description: "Basic retry with failure context",
      trigger: "any",
      template: `The previous attempt failed. Analyze the failure and provide a fix.

## Failure
{{failure}}

## Context
{{context}}

## Your Task
1. Identify the root cause
2. Implement the fix
3. Verify the fix works

Provide your corrected implementation.`,
      temperature: 0.3,
    };
  }
}

/**
 * Select default strategy based on failure type
 */
export function selectStrategy(failureOutput: string, taskType: string): RefineStrategyName {
  // Syntax errors - simplify
  if (/syntax|syntax error|parse error|unexpected token/i.test(failureOutput)) {
    return "simplify";
  }

  // Test failures - verify_only
  if (/test|assert/i.test(failureOutput)) {
    return "verify_only";
  }

  // Scope denied - analyze
  if (/scope|denied|permission/i.test(failureOutput)) {
    return "analyze";
  }

  // Bugfix - decompose
  if (taskType === "bugfix") {
    return "decompose";
  }

  // Default
  return "retry";
}

/**
 * Apply a strategy to generate a refinement prompt
 */
export function applyStrategy(
  strategy: RefineStrategy,
  failure: string,
  context: string
): string {
  return strategy.template
    .replace(/\{\{failure\}\}/g, failure)
    .replace(/\{\{context\}\}/g, context);
}

/**
 * Build a refine prompt for the repair loop
 *
 * This is the main entry point - call this instead of the hardcoded repair prompt
 */
export async function buildRefinePrompt(
  failureOutput: string,
  taskType: string,
  repairCount: number = 1
): Promise<{ prompt: string; strategy: string; temperature: number }> {
  // If multiple repairs, use escalate
  if (repairCount >= 3) {
    const strategy = await getStrategy("escalate");
    const prompt = applyStrategy(strategy, failureOutput, "[Previous context is in the conversation above]");
    return {
      prompt,
      strategy: "escalate",
      temperature: strategy.temperature,
    };
  }

  // Use learned strategy if available (falls back to heuristic)
  const name = await recommendStrategy(failureOutput, taskType);
  const strategy = await getStrategy(name);

  const prompt = applyStrategy(strategy, failureOutput, "[Previous context is in the conversation above]");

  return {
    prompt,
    strategy: strategy.name,
    temperature: strategy.temperature,
  };
}