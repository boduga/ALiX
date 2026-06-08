export type RunArgs = {
  task: string;
  noStream: boolean;
  noPlan: boolean;
  sessionMode?: "auto" | "ask" | "bypass";
  resumeSessionId?: string;
  planFilePath?: string;
};

const BOOLEAN_FLAGS = new Set(["--no-stream", "--no-plan"]);
const VALUE_FLAGS = new Set(["--mode", "--session-mode", "--resume", "--plan-file"]);
const VALID_MODES = new Set(["auto", "ask", "bypass"]);

/**
 * Parses CLI arguments for the `alix run` command.
 *
 * Only known flags at the start of the argument list are consumed as flags.
 * Everything after the first non-flag token (or after a value flag's value)
 * is treated as task text. This avoids the bug where flag-like strings inside
 * the task text were being stripped by the previous regex-based approach.
 *
 * @param rawArgs - The arguments array (everything after `alix run`)
 * @returns A `RunArgs` object with parsed flags and the remaining task text
 */
export function parseRunArgs(rawArgs: string[]): RunArgs {
  const result: RunArgs = { task: "", noStream: false, noPlan: false, sessionMode: undefined, resumeSessionId: undefined, planFilePath: undefined };
  const taskParts: string[] = [];
  let i = 0;

  // Phase 1: consume known flags while we see them at the start
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    const eqIndex = arg.indexOf("=");
    const flagName = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const eqValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;

    if (BOOLEAN_FLAGS.has(flagName)) {
      result.noStream = result.noStream || flagName === "--no-stream";
      result.noPlan = result.noPlan || flagName === "--no-plan";
      i++;
      continue;
    }

    if (VALUE_FLAGS.has(flagName)) {
      const value = eqValue !== undefined ? eqValue : rawArgs[i + 1];
      let consumed = 0;

      switch (flagName) {
        case "--mode":
        case "--session-mode": {
          if (value !== undefined && VALID_MODES.has(value)) {
            result.sessionMode = value as "auto" | "ask" | "bypass";
            consumed = eqValue !== undefined ? 1 : 2;
          }
          break;
        }
        case "--resume": {
          if (value !== undefined && value.length > 0) {
            result.resumeSessionId = value;
            consumed = eqValue !== undefined ? 1 : 2;
          }
          break;
        }
        case "--plan-file": {
          if (value !== undefined && value.length > 0) {
            result.planFilePath = value;
            consumed = eqValue !== undefined ? 1 : 2;
          }
          break;
        }
      }

      if (consumed > 0) {
        i += consumed;
        continue;
      }
      // Invalid or missing value — fall through to treat as task text
    }

    // Not a known flag (or known flag with an invalid value) —
    // everything from here is task text
    while (i < rawArgs.length) {
      taskParts.push(rawArgs[i]);
      i++;
    }
    break;
  }

  result.task = taskParts.join(" ").trim();
  return result;
}
