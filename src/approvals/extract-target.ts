/**
 * Extract a path/target from an approval reason string, if the reason embeds
 * one (e.g. "Path protected: /tmp/foo", "Command is denied: rm -rf"). Returns
 * undefined when no target is embedded; callers fall back to raw reason text.
 */
export function extractTarget(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  const colonMatch = reason.match(/:\s+(.+)$/);
  if (colonMatch?.[1]) return colonMatch[1].trim();
  return undefined;
}
