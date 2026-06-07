/**
 * Pattern candidate generator.
 * Groups tool-call failures by error signature and suggests new repair patterns.
 */
export function generateCandidates(
  errors: Array<{
    toolName: string;
    args: Record<string, unknown>;
    errorOutput: string;
  }>,
  _modelId: string
): Array<{
  model: string;
  toolName: string;
  frequency: number;
  errorSignature: string;
  sampleArgs: Record<string, unknown>[];
  sampleErrors: string[];
}> {
  const groups = new Map<
    string,
    {
      toolName: string;
      errorSignature: string;
      args: Record<string, unknown>[];
      errors: string[];
    }
  >();

  for (const err of errors) {
    const sig = errorSignature(err.args, err.errorOutput);
    const key = `${err.toolName}:${sig}`;

    if (!groups.has(key)) {
      groups.set(key, {
        toolName: err.toolName,
        errorSignature: sig,
        args: [],
        errors: [],
      });
    }
    const group = groups.get(key)!;
    group.args.push(err.args);
    group.errors.push(err.errorOutput.slice(0, 200));
  }

  return Array.from(groups.values())
    .map((g) => ({
      model: _modelId,
      toolName: g.toolName,
      frequency: g.args.length,
      errorSignature: g.errorSignature,
      sampleArgs: g.args.slice(0, 5),
      sampleErrors: g.errors.slice(0, 3),
    }))
    .sort((a, b) => b.frequency - a.frequency);
}

function errorSignature(
  args: Record<string, unknown>,
  errorOutput: string
): string {
  const nullFields = Object.entries(args)
    .filter(([, v]) => v === null || v === undefined)
    .map(([k]) => k)
    .sort()
    .join(",");

  const errorType = errorOutput.includes("Exit code")
    ? "exit_code"
    : errorOutput.includes("Zod") || errorOutput.includes("validation")
      ? "validation"
      : errorOutput.includes("ENOENT")
        ? "missing_file"
        : errorOutput.includes("TypeError")
          ? "type_error"
          : "other";

  return `${nullFields}|${errorType}`;
}
