/**
 * lib/args.mjs — shared CLI arg parser for langfuse-traces scripts.
 *
 * `--key value` pairs and boolean `--flag`s. Single implementation for all
 * skill scripts (hook sandbox runs them without a repo build step, so no
 * external deps and no TS imports here).
 */
export function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/** True for `--flag` passed bare or as the string "true". */
export function isOn(value) {
  return value === true || value === "true";
}
