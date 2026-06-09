/**
 * policy-loader.ts — Load PolicyRules from disk or fall back to defaults.
 *
 * Reads .alix/policies/*.json and validates each rule.
 * Falls back to built-in defaults when no policy files exist.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { PolicyRule } from "./policy-rule.js";
import { validatePolicyRule } from "./policy-rule.js";
import { RuleEvaluator } from "./rule-evaluator.js";
import { defaultPolicyRules } from "./default-policies.js";

/** Load PolicyRule[] from disk or return defaults. */
export async function loadPolicyRules(cwd: string): Promise<PolicyRule[]> {
  const policiesDir = join(cwd, ".alix", "policies");
  if (!existsSync(policiesDir)) {
    return defaultPolicyRules();
  }

  const files = await readdir(policiesDir);
  const jsonFiles = files.filter(f => f.endsWith(".json"));
  if (jsonFiles.length === 0) {
    return defaultPolicyRules();
  }

  const rules: PolicyRule[] = [];
  const seenIds = new Set<string>();

  for (const f of jsonFiles) {
    try {
      const raw = await readFile(join(policiesDir, f), "utf-8");
      const parsed = JSON.parse(raw);

      // Single rule or array
      const items: unknown[] = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of items) {
        const rule = item as PolicyRule;
        const validation = validatePolicyRule(rule);
        if (!validation.valid) {
          console.warn(`Skipping invalid policy rule in ${f}: ${validation.errors.join("; ")}`);
          continue;
        }
        if (seenIds.has(rule.id)) {
          console.warn(`Skipping duplicate policy rule ID: ${rule.id} in ${f}`);
          continue;
        }
        seenIds.add(rule.id);
        rules.push(rule);
      }
    } catch (err) {
      console.warn(`Skipping invalid policy file ${f}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return rules.length > 0 ? rules : defaultPolicyRules();
}

/** Convenience: load rules and wrap in a RuleEvaluator. */
export async function loadRuleEvaluator(cwd: string): Promise<RuleEvaluator> {
  const rules = await loadPolicyRules(cwd);
  return new RuleEvaluator(rules);
}
