export type RunArgs = {
  task: string;
  noStream: boolean;
  noPlan: boolean;
  sessionMode?: "auto" | "ask" | "bypass";
  resumeSessionId?: string;
  planFilePath?: string;
  intent: boolean;
  propose: boolean;
  chat?: boolean;
  readOnly: boolean;
};

const BOOLEAN_FLAGS = new Set(["--no-stream", "--no-plan", "--intent", "--propose", "--chat", "--read-only"]);
const VALUE_FLAGS = new Set(["--mode", "--session-mode", "--resume", "--plan-file"]);
const VALID_MODES = new Set(["auto", "ask", "bypass"]);

/**
 * Parses CLI arguments for the `alix run` command.
 *
 * Scans the entire arg list for known flags. Flags and their values are
 * consumed regardless of position relative to the task text. Remaining
 * unparsed tokens become the task string.
 *
 * @param rawArgs - The arguments array (everything after `alix run`)
 * @returns A `RunArgs` object with parsed flags and the remaining task text
 */
export function parseRunArgs(rawArgs: string[]): RunArgs {
  const result: RunArgs = { task: "", noStream: false, noPlan: false, sessionMode: undefined, resumeSessionId: undefined, planFilePath: undefined, intent: false, propose: false, chat: false, readOnly: false };
  const taskParts: string[] = [];
  const consumed = new Array<boolean>(rawArgs.length).fill(false);

  for (let i = 0; i < rawArgs.length; i++) {
    if (consumed[i]) continue;

    const arg = rawArgs[i];
    const eqIndex = arg.indexOf("=");
    const flagName = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const eqValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : undefined;

    if (BOOLEAN_FLAGS.has(flagName)) {
      result.noStream = result.noStream || flagName === "--no-stream";
      result.noPlan = result.noPlan || flagName === "--no-plan";
      result.intent = result.intent || flagName === "--intent";
      result.propose = result.propose || flagName === "--propose";
      result.chat = result.chat || flagName === "--chat";
      result.readOnly = result.readOnly || flagName === "--read-only";
      consumed[i] = true;
      continue;
    }

    if (VALUE_FLAGS.has(flagName)) {
      const value = eqValue !== undefined ? eqValue : rawArgs[i + 1];
      const nextConsumed = !eqValue && value !== undefined && i + 1 < rawArgs.length && !consumed[i + 1];
      let matched = false;

      switch (flagName) {
        case "--mode":
        case "--session-mode": {
          if (value !== undefined && VALID_MODES.has(value)) {
            result.sessionMode = value as "auto" | "ask" | "bypass";
            matched = true;
          }
          break;
        }
        case "--resume": {
          if (value !== undefined && value.length > 0) {
            result.resumeSessionId = value;
            matched = true;
          }
          break;
        }
        case "--plan-file": {
          if (value !== undefined && value.length > 0) {
            result.planFilePath = value;
            matched = true;
          }
          break;
        }
      }

      if (matched) {
        consumed[i] = true;
        if (nextConsumed) consumed[i + 1] = true;
        continue;
      }
    }

    // Not a known flag — add to task text
    taskParts.push(arg);
  }

  result.task = taskParts.join(" ").trim();
  return result;
}
