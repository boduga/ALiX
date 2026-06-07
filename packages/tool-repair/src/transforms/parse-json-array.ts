/**
 * Transform: parse_json_string_to_array
 * If a string looks like a JSON array, parse it into an actual array.
 */
export function parseJsonArray(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const val = args[paramName];
  if (typeof val !== "string") return { args, changed: false };

  const trimmed = val.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return { args, changed: false };

  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { args, changed: false };
    return { args: { ...args, [paramName]: parsed }, changed: true };
  } catch {
    return { args, changed: false };
  }
}
