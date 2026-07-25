/**
 * Source marker preserved from Markdown list syntax.
 */
export type ListMarker =
  | "-"
  | "*"
  | "+"
  | "ordered";


/**
 * Structured representation of an agent response.
 *
 * Markdown remains the canonical persisted artifact.
 * ResponseBlock is only a presentation model.
 *
 * Phase 1 supports:
 * - text paragraphs
 * - fenced code blocks
 * - bullet and ordered lists
 */
export type ResponseBlock =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "code";
      language?: string;
      code: string;
      fenced: true;
    }
  | {
      type: "list";
      marker: ListMarker;
      items: string[];
    };

/**
 * Parse an agent response into a flat list of `ResponseBlock`s.
 *
 * Markdown remains the canonical persisted artifact; this function
 * only produces a presentation model for the TUI agent view.
 *
 * Phase 1 (Task 2) supports only plain-text mode:
 *   - empty / whitespace-only input returns `[]`
 *   - all other prose collapses to a single text block
 *   - internal newlines and blank lines are preserved verbatim
 *   - CRLF line endings are normalized to LF
 *
 * Future tasks add code-block and list parsing; this function is
 * the single entry point for all of them.
 */
export function parseResponseBlocks(
  md: string
): readonly ResponseBlock[] {
  if (!md || !md.trim()) {
    return [];
  }

  const blocks: ResponseBlock[] = [];

  const lines = md.split(/\r?\n/);

  const text = lines.join("\n");

  if (text.trim()) {
    blocks.push({
      type: "text",
      text,
    });
  }

  return blocks;
}
