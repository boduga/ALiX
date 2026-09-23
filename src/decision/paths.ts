/** paths.ts — decision-state paths, owned by the decision subsystem so tools
 *  never import src/cli/commands/*. Mirrors what cli/commands/jev/ops.ts
 *  called resolveJevPaths (which now delegates here). */
import { join } from "node:path";

export type DecisionPaths = {
  dir: string;
  fixtures: string;
  profiles: string;
};

export function resolveDecisionPaths(cwd: string): DecisionPaths {
  const dir = join(cwd, ".alix", "decisions");
  return { dir, fixtures: join(dir, "fixtures"), profiles: join(dir, "profiles.json") };
}
