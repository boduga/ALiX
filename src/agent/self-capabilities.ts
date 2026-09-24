/**
 * self-capabilities.ts — What ALiX knows about its own surface.
 *
 * The model sees its tools (via the tool manifest) and injected skills, but
 * it has no idea about the CLI subcommands or the TUI's client-side slash
 * commands — so it guesses (e.g. web-searching for local coordination state).
 * This renders a bounded `## Your Capabilities` section into the system
 * prompt so the model can route to its own surface instead of guessing.
 *
 * `TUI_SLASH_COMMANDS` is the canonical list; `parseWorkbenchBuiltinCommand`
 * handles them client-side and a test pins the two together. `CLI_COMMANDS`
 * is the top-level `alix` surface.
 */

export type CapabilityEntry = { readonly name: string; readonly description: string };

/** TUI builtin slash commands — client-side, handled before the model. */
export const TUI_SLASH_COMMANDS: readonly CapabilityEntry[] = [
  { name: "/agents", description: "open the agent roster drawer" },
  { name: "/tasks", description: "open the delegated-task drawer" },
  { name: "/artifacts", description: "inspect correlated artifacts and worker results" },
  { name: "/diff", description: "open the diff overlay" },
  { name: "/review", description: "open the review overlay" },
  { name: "/help", description: "open the help overlay" },
];

/** Top-level `alix` CLI command groups. */
export const CLI_COMMANDS: readonly CapabilityEntry[] = [
  { name: 'alix run "<task>"', description: "run a task through the agent loop" },
  { name: "alix coordination run|status|results|cancel|list|workers|tick|resume", description: "parallel multi-worker runs (planner -> scheduler -> workers)" },
  { name: "alix audit list|verify [--all]|activate|checkpoint|checkpoint-verify", description: "audit trail (runtime + governance)" },
  { name: "alix daemon start|stop|status|tasks|cancel", description: "background task daemon" },
  { name: "alix models set-default|set-tier|resolve|doctor|routing|free", description: "model and tier configuration" },
  { name: "alix skills list|install|run|distill-from-traces", description: "skill lifecycle" },
  { name: "alix graph plan|run|rerun|list|inspect", description: "task graphs" },
  { name: "alix doctor", description: "system and config diagnostics" },
];

export type SelfCapabilityOptions = {
  /** Skill slash names available this turn (e.g. "/tdd"). */
  skills?: readonly string[];
};

/**
 * Render the `## Your Capabilities` system-prompt section. Pure and bounded.
 */
export function renderSelfCapabilitySection(opts: SelfCapabilityOptions = {}): string {
  const lines: string[] = [
    "## Your Capabilities",
    "You run inside ALiX. Beyond the tools listed above, the following are yours — use them instead of guessing.",
    "",
    "### CLI (invoke via the shell tool)",
    ...CLI_COMMANDS.map((c) => `- \`${c.name}\` — ${c.description}`),
    "",
    "### TUI slash commands (the operator types these; you cannot invoke them)",
    ...TUI_SLASH_COMMANDS.map((c) => `- \`${c.name}\` — ${c.description}`),
  ];
  if (opts.skills && opts.skills.length > 0) {
    lines.push("", "### Skill slash commands", opts.skills.map((s) => `\`${s}\``).join(", "));
  }
  lines.push(
    "",
    "When asked about your own state or runs, use the `state.query` tool (kinds: sessions, audit, approvals, daemon, schedule, graphs) or inspect `.alix/...`, or run the matching `alix` command — never web-search for local state.",
    "When asked whether evidence supports a claim, call `alix_verify_claim` with the claim and pasted excerpts — do not web-search or web-fetch to answer it (it fetches nothing; excerpts max 8 × 1200 chars). Answer with ONE line — verdict plus at most one sentence; do not echo the payload's decision id, engine, or authority.",
  );
  return lines.join("\n");
}
