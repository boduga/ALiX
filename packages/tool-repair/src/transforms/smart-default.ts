/**
 * Transform: default_first_read / default_last_read
 * Smart default for missing offset/limit on file reads.
 */
const DEFAULT_OFFSET = 0;
const DEFAULT_LIMIT = 100;

export function smartDefault(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const current = args[paramName];
  if (current !== undefined && current !== null) return { args, changed: false };

  const copy = { ...args };
  let changed = false;

  if (paramName === "offset" && (copy[paramName] === undefined || copy[paramName] === null)) {
    copy[paramName] = DEFAULT_OFFSET;
    changed = true;
  } else if (paramName === "limit" && (copy[paramName] === undefined || copy[paramName] === null)) {
    copy[paramName] = DEFAULT_LIMIT;
    changed = true;
  }

  return { args: copy, changed };
}
