// src/verifier/verifier.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runWithIsolation } from "../skills/test-isolation.js";
import type { SessionMode } from "../config/schema.js";

export type VerificationCheck = {
  command: string;
  reason: string;
};

export type VerificationResult = {
  status: "passed" | "failed" | "not_run";
  command?: string;
  output?: string;
};

const TEST_COMMANDS = ["test", "test:unit", "test:integration"];
const BUILD_COMMANDS = ["build", "compile"];
const TYPE_CHECK_COMMANDS = ["typecheck", "type-check", "lint", "check"];

type CheckKind = "typecheck" | "build" | "test";

const COST_ORDER: CheckKind[] = ["typecheck", "build", "test"];

function kindOf(name: string): CheckKind {
  if (TYPE_CHECK_COMMANDS.includes(name)) return "typecheck";
  if (BUILD_COMMANDS.includes(name)) return "build";
  if (TEST_COMMANDS.includes(name)) return "test";
  return "test";
}

export async function discoverVerification(root: string): Promise<VerificationCheck[]> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const checks: Array<{ kind: CheckKind; check: VerificationCheck }> = [];

  for (const name of Object.keys(scripts)) {
    const kind = kindOf(name);
    if (!COST_ORDER.includes(kind)) continue;
    const fullCmd = name === "test" ? "npm test" : `npm run ${name}`;
    checks.push({ kind, check: { command: fullCmd, reason: `package.json script: ${name}` } });
  }

  // Sort by COST_ORDER, stable within same kind
  checks.sort((a, b) => COST_ORDER.indexOf(a.kind) - COST_ORDER.indexOf(b.kind));
  return checks.map(c => c.check);
}

export async function runVerification(root: string, check: VerificationCheck): Promise<VerificationResult> {
  try {
    const { passed, output } = await runWithIsolation(root, check.command, 120000);
    return { status: passed ? "passed" : "failed", command: check.command, output };
  } catch (err) {
    return { status: "not_run", command: check.command, output: String(err) };
  }
}

export type VerificationPolicy = {
  skipReason?: string;
};

export function shouldRunVerification(sessionMode: SessionMode, scopeApproved: boolean): VerificationPolicy {
  if (sessionMode === "ask" && !scopeApproved) {
    return { skipReason: "ask mode: waiting for scope approval" };
  }
  return {};
}