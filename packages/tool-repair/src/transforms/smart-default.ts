/**
 * Transform: default_first_read / default_last_read
 * Smart default for missing offset/limit on file reads.
 */
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 100;

export function smartDefault(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  if (paramName !== "offset" && paramName !== "limit") return { args, changed: false };

  const current = args[paramName];
  if (current !== undefined && current !== null) return { args, changed: false };

  const copy = { ...args };
  copy[paramName] = paramName === "offset" ? DEFAULT_OFFSET : DEFAULT_LIMIT;
  return { args: copy, changed: true };
}
