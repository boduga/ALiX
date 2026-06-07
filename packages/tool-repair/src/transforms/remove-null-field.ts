/**
 * Transform: remove
 * Deletes a param from the args object entirely.
 */
export function removeNullField(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const changed = paramName in args;
  if (!changed) return { args, changed: false };
  const copy = { ...args };
  delete copy[paramName];
  return { args: copy, changed: true };
}
