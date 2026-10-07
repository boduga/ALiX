/**
 * Bare continuation cues carry no objective of their own. Contentful requests
 * and stop signals remain independent turns. Keep this module dependency-free
 * so session input routing does not load the task-loop execution graph.
 */
export const CONTINUATION_RE = /^(?:continue|next(?:\s+step)?|proceed|go\s+on|keep\s+going|carry\s+on|finalize)\.?$/i;

/** True when the turn text is a bare continuation cue with no objective. */
export function isContinuationMessage(text: string): boolean {
  return CONTINUATION_RE.test(text.trim());
}
