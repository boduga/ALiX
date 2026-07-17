/**
 * Pure parser for `alix init` argv. Spec §12.
 *
 * Supported flags:
 *   --provider <id>     explicit provider id
 *   --model   <id>      explicit model id (validated later against live list)
 *   --help              print usage and exit
 *
 * Errors throw `InitArgsError` with a typed `code` for the caller to map
 * to exit codes and stderr messages. The helper does NOT call `process.exit`;
 * the CLI dispatcher (`src/cli.ts`) decides that.
 */

export type InitArgsErrorCode = "unknown-flag" | "missing-value" | "unexpected-positional";

export class InitArgsError extends Error {
  readonly code: InitArgsErrorCode;
  constructor(code: InitArgsErrorCode, message: string) {
    super(message);
    this.name = "InitArgsError";
    this.code = code;
  }
}

export interface ParsedInitArgs {
  provider?: string;
  model?: string;
  help: boolean;
}

/** Returns the value for a flag or throws `InitArgsError`. */
function takeValue(argv: string[], flag: "--provider" | "--model", index: number): string {
  const next = argv[index + 1];
  if (!next || next.startsWith("--")) {
    throw new InitArgsError("missing-value", `Missing value for ${flag}`);
  }
  return next;
}

export function parseInitArgs(argv: string[]): ParsedInitArgs {
  const out: ParsedInitArgs = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--provider": {
        const v = takeValue(argv, "--provider", i);
        out.provider = v;
        i++; // skip consumed value
        break;
      }
      case "--model": {
        const v = takeValue(argv, "--model", i);
        out.model = v;
        i++;
        break;
      }
      case "--help":
      case "-h":
        out.help = true;
        break;
      default: {
        if (a.startsWith("--") || a.startsWith("-")) {
          throw new InitArgsError("unknown-flag", `Unknown option: ${a}`);
        }
        throw new InitArgsError("unexpected-positional", `Unexpected argument: ${a}`);
      }
    }
  }
  return out;
}
