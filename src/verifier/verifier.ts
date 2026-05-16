// src/verifier/verifier.ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runWithIsolation } from "../skills/test-isolation.js";

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

export async function discoverVerification(root: string): Promise<VerificationCheck[]> {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) return [];
  const pkg = JSON.parse(await readFile(packagePath, "utf8")) as { scripts?: Record<string, string> };
  const scripts = pkg.scripts ?? {};
  const checks: VerificationCheck[] = [];

  for (const [name, cmd] of Object.entries(scripts)) {
    if (TEST_COMMANDS.includes(name)) {
      const fullCmd = name === "test" ? "npm test" : `npm run ${name}`;
      checks.push({ command: fullCmd, reason: `package.json script: ${name}` });
    }
    if (BUILD_COMMANDS.includes(name)) {
      checks.push({ command: `npm run ${name}`, reason: `package.json script: ${name}` });
    }
    if (TYPE_CHECK_COMMANDS.includes(name)) {
      checks.push({ command: `npm run ${name}`, reason: `package.json script: ${name}` });
    }
  }

  return checks;
}

export async function runVerification(root: string, check: VerificationCheck): Promise<VerificationResult> {
  try {
    const { passed, output } = await runWithIsolation(root, check.command, 120000);
    return { status: passed ? "passed" : "failed", command: check.command, output };
  } catch (err) {
    return { status: "not_run", command: check.command, output: String(err) };
  }
}