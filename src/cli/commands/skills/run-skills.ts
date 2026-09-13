import { runInstall, parseSkillsArgs, printSkillsHelp, type InstallOptions } from "./install.js";
import { listAvailableSkills, runMarketplaceCommand } from "./marketplace.js";
import { runSkillCommand } from "./run-skill.js";
import { handleSkillsDistillFromTraces } from "./distill-from-traces.js";

export type SkillsCommand =
  | { type: "help" }
  | { type: "available" }
  | { type: "install"; opts: InstallOptions }
  | { type: "run"; name: string; script: string; args: string[]; project: boolean; global: boolean }
  | { type: "distill-from-traces"; args: string[] }
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
    if (flags.has("--project") && flags.has("--global")) {
      throw new Error("Usage: pass either --project or --global, not both");
    }
    return {
      type: "install",
      opts: {
        available: flags.has("--available"),
        // Both `install --list` and the bare `install list` list installed
        // skills. `list` is a subcommand keyword here, not a skill name.
        list: flags.has("--list") || positional[1] === "list",
        name: positional[1] !== "list" ? positional[1] : undefined,
        from,
        force: flags.has("--force"),
        project: flags.has("--project"),
        global: flags.has("--global"),
      },
    };
  }
  if (sub === "run") {
    // Scope flags must precede the script name: everything from the script
    // token on is passed raw to the script (a script's own --flags are
    // never consumed here). Locate the script token with a sequential scan
    // so leading scope flags don't shift the raw-arg split.
    const headFlags = args.slice(0, 3);
    const project = headFlags.includes("--project");
    const global = headFlags.includes("--global");
    if (project && global) {
      throw new Error("Usage: pass either --project or --global, not both");
    }
    const name = positional[1] ?? "";
    const script = positional[2] ?? "";
    let i = 1;
    while (i < args.length && args[i]!.startsWith("--")) i++;
    if (i < args.length && args[i] === positional[1]) i++;
    while (i < args.length && args[i]!.startsWith("--")) i++;
    if (i < args.length && args[i] === positional[2]) i++;
    return { type: "run", name, script, args: args.slice(i), project, global };
  }
  if (sub === "remove") {
    if (flags.has("--project") && flags.has("--global")) {
      throw new Error("Usage: pass either --project or --global, not both");
    }
    return {
      type: "install",
      opts: { remove: true, name: positional[1], project: flags.has("--project"), global: flags.has("--global") },
    };
  }
  if (sub === "distill-from-traces") {
    // Flags belong to the handler — pass everything after the subcommand.
    return { type: "distill-from-traces", args: args.slice(args.indexOf(sub) + 1) };
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
    case "run":
      await runSkillCommand(cmd.name, cmd.script, cmd.args, { project: cmd.project, global: cmd.global });
      return;
    case "distill-from-traces":
      await handleSkillsDistillFromTraces(cmd.args);
      return;
    case "marketplace":
      await runMarketplaceCommand(cmd.action, cmd.name, cmd.url);
      return;
    case "help":
      printSkillsHelp();
      return;
  }
}
