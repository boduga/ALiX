import { runInstall, parseSkillsArgs, printSkillsHelp, type InstallOptions } from "./install.js";
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
 * Parses via the single shared parseSkillsArgs (from-aware) so install and
 * marketplace routing don't each re-split the arg list. Legacy `--available`
 * flag is still honored for backward compatibility.
 */
export function resolveSkillsCommand(args: string[]): SkillsCommand {
  const { flags, positional, from } = parseSkillsArgs(args);
  const sub = positional[0] ?? "";
  if (sub === "available" || flags.has("--available")) {
    return { type: "available" };
  }
  if (sub === "marketplace") {
    const action = positional[1] ?? "list";
    // Validate instead of force-casting: an unknown action routes to help
    // rather than surfacing a raw "Unknown marketplace action" stack trace.
    if (action !== "list" && action !== "add" && action !== "remove") {
      return { type: "help" };
    }
    return {
      type: "marketplace",
      action,
      name: positional[2],
      url: positional[3],
    };
  }
  if (sub === "install") {
    return {
      type: "install",
      opts: {
        available: flags.has("--available"),
        list: flags.has("--list"),
        name: positional[1],
        from,
      },
    };
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
