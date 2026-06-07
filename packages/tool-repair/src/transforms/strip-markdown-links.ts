/**
 * Transform: strip_markdown_links
 * Strips markdown link syntax from string values.
 * "[text](path)" → "path"
 * Also strips trailing ")" which some models append to plain paths.
 */
export function stripMarkdownLinks(args: Record<string, unknown>, paramName: string): { args: Record<string, unknown>; changed: boolean } {
  const val = args[paramName];
  if (typeof val !== "string") return { args, changed: false };

  let cleaned = val;

  // Match [text](url) → extract url
  const markdownLink = cleaned.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
  if (markdownLink) {
    cleaned = markdownLink[2];
  }

  // Strip trailing ) if it looks like a leftover from markdown
  cleaned = cleaned.replace(/\)$/, "").trim();

  if (cleaned === val) return { args, changed: false };
  return { args: { ...args, [paramName]: cleaned }, changed: true };
}
