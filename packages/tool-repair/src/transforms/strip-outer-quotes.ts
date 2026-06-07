/**
 * Transform: strip_outer_quotes
 * Strips outer double-quote characters from a string value.
 * Used when a model double-encodes a string as JSON (e.g. '"ls -la"').
 */
export function stripOuterQuotes(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const val = args[paramName];
  if (typeof val !== "string") return { args, changed: false };

  const trimmed = val.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const unquoted = trimmed.slice(1, -1);
    return { args: { ...args, [paramName]: unquoted }, changed: true };
  }

  return { args, changed: false };
}
