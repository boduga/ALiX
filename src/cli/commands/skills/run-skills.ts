import { runInstall, resolveInstallOptions, printSkillsHelp, type InstallOptions } from "./install.js";
import { listAvailableSkills, runMarketplaceCommand } from "./marketplace.js";

export type SkillsCommand =
  | { type: "help" }
  | { type: "available" }
  | { type: "install"; opts: InstallOptions }
  | { type: "marketplace"; action: "list" | "add" | "remove"; name?: string; url?: string };

/**
 * Map CLI args (everything after `alix skills`) to a SkillsCommand.
 *
 * Subcommand-based: the first non-flag positional selects the subcommand.
 * Legacy `--available` flag is still honored for backward compatibility.
 */
export function resolveSkillsCommand(args: string[]): SkillsCommand {
  const flags = new Set<string>();
  const positional: string[] = [];
  for (const a of args) {
    if (a.startsWith("--")) {
      flags.add(a);
    } else {
      positional.push(a);
    }
  }
  const sub = positional[0] ?? "";
  if (sub === "available" || flags.has("--available")) {
    return { type: "available" };
  }
  if (sub === "marketplace") {
    return {
      type: "marketplace",
      action: (positional[1] ?? "list") as "list" | "add" | "remove",
      name: positional[2],
      url: positional[3],
    };
  }
  if (sub === "install") {
    return { type: "install", opts: resolveInstallOptions(args) };
  }
  return { type: "help" };
}

/** Dispatch a `skills` CLI invocation to the matching handler. */
export async function runSkillsCommand(args: string[]): Promise<void> {
  const cmd = resolveSkillsCommand(args);
  switch (cmd.type) {
    case "available":
      await listAvailableSkills();
      return;
    case "install":
      await runInstall(cmd.opts);
      return;
    case "marketplace":
      await runMarketplaceCommand(cmd.action, cmd.name, cmd.url);
      return;
    case "help":
      printSkillsHelp();
      return;
  }
}
