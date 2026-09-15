import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GOVERNANCE_BARREL = join(process.cwd(), "src/cli/commands/governance.ts");
const GOVERNANCE_DIR = join(process.cwd(), "src/cli/commands/governance");

/**
 * #717 — the former `src/cli/commands/governance.ts` megafile is now a barrel
 * over `src/cli/commands/governance/*.ts`. Source-scan sentinels that used to
 * read the single file should cover the barrel and every module.
 */
export function governanceSourcePaths(): string[] {
  const modules = readdirSync(GOVERNANCE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => join(GOVERNANCE_DIR, f));
  return [GOVERNANCE_BARREL, ...modules];
}

/** Concatenation of the barrel and every module (for whole-source scans). */
export function readGovernanceSource(): string {
  return governanceSourcePaths()
    .map((f) => readFileSync(f, "utf-8"))
    .join("\n");
}
