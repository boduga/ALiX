// src/verifier/test-planner.ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { mapFilesToTests } from "./test-mapper.js";
import type { VerificationCheck } from "./verifier.js";

// Cost weights (relative execution time)
const COST_WEIGHTS: Record<string, number> = {
  typecheck: 1,
  build: 3,
  test: 10,
};

type CheckKind = "typecheck" | "build" | "test";

function classifyCheckKind(command: string): CheckKind {
  const cmd = command.toLowerCase();
  if (cmd.includes("typecheck") || cmd.includes("type-check") || cmd.includes("lint") || cmd.includes("check")) {
    return "typecheck";
  }
  if (cmd.includes("build") || cmd.includes("compile") || cmd.includes("tsc")) {
    return "build";
  }
  return "test";
}

export interface TestPlan {
  checks: VerificationCheck[];
  verifiedFiles: string[];
  unverifiedFiles: string[];
  totalCost: number;
  costBreakdown: Record<CheckKind, number>;
  strategy: "full" | "targeted" | "minimal";
}

// Default cost when check kind is unknown
const DEFAULT_COST = COST_WEIGHTS["test"];

export class TestPlanner {
  /**
   * Order checks by cost (cheapest first)
   */
  orderByCost(checks: VerificationCheck[]): VerificationCheck[] {
    return [...checks].sort((a, b) => {
      const costA = COST_WEIGHTS[classifyCheckKind(a.command)] ?? DEFAULT_COST;
      const costB = COST_WEIGHTS[classifyCheckKind(b.command)] ?? DEFAULT_COST;
      return costA - costB;
    });
  }

  /**
   * Create a verification plan for given changed files
   */
  async plan(
    root: string,
    changedFiles: string[],
    options: {
      baseCommands?: VerificationCheck[];
      maxCost?: number;
      strategy?: "full" | "targeted" | "minimal";
    } = {}
  ): Promise<TestPlan> {
    const { baseCommands = [], maxCost = Infinity, strategy = "targeted" } = options;

    const checks: VerificationCheck[] = [];
    const verifiedFiles = new Set<string>();
    const unverifiedFiles = new Set<string>(changedFiles);

    // Add base commands (typecheck, build) first (cheapest)
    const sortedBase = this.orderByCost(baseCommands);
    for (const cmd of sortedBase) {
      checks.push(cmd);
    }

    // Track files that have specific tests mapped
    const mappedTestFiles = new Set<string>();

    if (strategy === "minimal") {
      // Only run typecheck, skip specific tests
    } else if (strategy === "targeted" && changedFiles.length > 0) {
      // Use simple path-based mapping
      const mapped = mapFilesToTests(root, changedFiles);
      for (const m of mapped) {
        const existing = checks.find(c => c.command === m.command);
        if (!existing) checks.push(m);
      }
      // Track which files have tests from mapFilesToTests
      for (const file of changedFiles) {
        if (mapped.some(m => m.reason.includes(file))) {
          mappedTestFiles.add(file);
        }
      }
    } else if (strategy === "full") {
      // Add full test suite
      checks.push({ command: "npm test", reason: "full test suite" });
    }

    // Calculate cost breakdown
    const costBreakdown: Record<CheckKind, number> = {
      typecheck: 0,
      build: 0,
      test: 0,
    };

    let totalCost = 0;
    for (const check of checks) {
      const kind = classifyCheckKind(check.command);
      costBreakdown[kind]++;
      totalCost += COST_WEIGHTS[kind] ?? DEFAULT_COST;
    }

    // Mark files as verified/unverified based on whether we have tests for them
    for (const file of changedFiles) {
      if (mappedTestFiles.has(file)) {
        verifiedFiles.add(file);
        unverifiedFiles.delete(file);
      }
    }

    return {
      checks,
      verifiedFiles: [...verifiedFiles],
      unverifiedFiles: [...unverifiedFiles],
      totalCost,
      costBreakdown,
      strategy,
    };
  }
}

/**
 * Convenience function to create a test plan from changed files
 */
export async function createTestPlan(
  root: string,
  changedFiles: string[]
): Promise<TestPlan> {
  const planner = new TestPlanner();

  // Get base commands from package.json
  const baseCommands: VerificationCheck[] = [];
  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      const scripts = pkg.scripts ?? {};

      if (scripts.typecheck || scripts["type-check"] || scripts.lint) {
        const cmd = scripts.typecheck || scripts["type-check"] || scripts.lint;
        const scriptName = scripts.typecheck ? "typecheck" : scripts["type-check"] ? "type-check" : "lint";
        baseCommands.push({ command: `npm run ${cmd}`, reason: scriptName });
      }
      if (scripts.build) {
        baseCommands.push({ command: "npm run build", reason: "build" });
      }
    } catch (err) {
      console.warn("Failed to read package.json for verification planning:", err);
    }
  }

  return planner.plan(root, changedFiles, {
    baseCommands,
    strategy: changedFiles.length > 0 ? "targeted" : "minimal",
  });
}