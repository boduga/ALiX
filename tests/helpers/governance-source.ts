import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const GOVERNANCE_DIR = join(process.cwd(), "src/cli/commands/governance");

/**
 * #717 — the former `src/cli/commands/governance.ts` megafile is now a barrel
 * over `src/cli/commands/governance/*.ts`. Source-scan sentinels that used to
 * read the single file should read the concatenation of the barrel and every
 * module so their checks still cover the real code.
 */
export function readGovernanceSource(): string {
  const barrel = readFileSync(
    join(process.cwd(), "src/cli/commands/governance.ts"),
    "utf-8",
  );
  const modules = readdirSync(GOVERNANCE_DIR)
    .filter((f) => f.endsWith(".ts"))
    .sort()
    .map((f) => readFileSync(join(GOVERNANCE_DIR, f), "utf-8"));
  return [barrel, ...modules].join("\n");
}
