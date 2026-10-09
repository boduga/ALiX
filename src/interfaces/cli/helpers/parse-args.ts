/**
 * parse-args.ts — shared `--key value` / `--flag` parser for CLI subcommands.
 *
 * Single home so evals/skills (and future) subcommands don't each re-split
 * the arg list. Valued keys consume the next token unless it looks like a
 * flag; bare `--flag`s in the flags list become `true`.
 */

export function parseKeyValueArgs(
  args: string[],
  keys: string[],
  flags: string[],
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) continue;
    const key = args[i].slice(2);
    const next = args[i + 1];
    if (keys.includes(key) && next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else if (flags.includes(key)) {
      out[key] = true;
    }
  }
  return out;
}
