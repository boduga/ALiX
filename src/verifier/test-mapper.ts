import { existsSync } from "node:fs";
import { join } from "node:path";
import type { VerificationCheck } from "./verifier.js";

function findTestForSource(root: string, sourceFile: string): string | null {
  const rel = sourceFile.replace(/^src\//, "");
  const base = rel.replace(/\.ts$/, "");

  const candidates = [
    join(root, "tests", `${base}.test.ts`),
    join(root, "tests", `${base}.spec.ts`),
    join(root, "tests", `${base}.ts`),
    join(root, "test", `${base}.test.ts`),
    join(root, "test", `${base}.spec.ts`),
    join(root, "src", `${base}.test.ts`),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Try subdirectory pattern: src/auth/user.ts → tests/auth/user.test.ts
  const parts = rel.split("/");
  if (parts.length >= 2) {
    const testRel = parts.slice(0, -1).join("/") + "/" + parts[parts.length - 1].replace(/\.ts$/, ".test.ts");
    const candidate = join(root, "tests", testRel);
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

export function mapFilesToTests(root: string, changedFiles: string[]): VerificationCheck[] {
  const specificChecks: VerificationCheck[] = [];

  for (const file of changedFiles) {
    const testPath = findTestForSource(root, file);
    if (testPath) {
      specificChecks.push({
        command: `npx vitest run "${testPath}"`,
        reason: `test for changed file: ${file}`
      });
    }
  }

  if (specificChecks.length > 0) return specificChecks;

  // Fallback: full test suite if no specific matches
  return [{ command: "npm test", reason: "fallback: no specific test mapping found" }];
}