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
 * Match an opening code fence.
 *
 * Rules (per Task 3 brief):
 * - exactly three backticks at start of line
 * - the character immediately after must NOT be a backtick
 *   (this excludes 4+ backticks and longer fences)
 * - optional info string made of non-whitespace, non-backtick chars
 * - any trailing whitespace is allowed
 * - must be the entire line (anchored end)
 *
 * Returns `{ language?: string }` on a match, or `null` otherwise.
 */
function matchFenceOpen(
  line: string
): { language?: string } | null {
  const match = /^```(?!`)([^\s`]*)\s*$/.exec(line);
  if (!match) {
    return null;
  }
  return {
    language: match[1] || undefined,
  };
}

/**
 * Match a closing code fence.
 *
 * Rule (per Task 3 brief):
 * - the line is exactly three backticks, optionally followed by
 *   trailing whitespace (`trimEnd() === "```"`)
 *
 * Uses string equality — no dynamic regex construction — so the
 * close cannot accidentally accept a longer fence.
 */
function matchFenceClose(line: string): boolean {
  return line.trimEnd() === "```";
}

/**
 * Parse an agent response into a flat list of `ResponseBlock`s.
 *
 * Markdown remains the canonical persisted artifact; this function
 * only produces a presentation model for the TUI agent view.
 *
 * Phase 1 (Tasks 2–4) supports:
 *   - empty / whitespace-only input returns `[]`
 *   - text paragraphs collapse consecutive non-fence, non-list
 *     lines into a single text block
 *   - fenced code blocks with an optional info-string language
 *   - unclosed fences fall back to a single text block
 *     (opening fence + collected content), never throw
 *   - CRLF line endings are normalized to LF
 *
 * Code-block detection runs before list detection inside the
 * main loop, so a code line beginning with `- ` is not
 * mis-parsed as a list item.
 */
export function parseResponseBlocks(
  md: string
): readonly ResponseBlock[] {
  if (!md || !md.trim()) {
    return [];
  }

  const lines = md.split(/\r?\n/);
  const blocks: ResponseBlock[] = [];

  let textBuffer: string[] = [];

  const flushText = (): void => {
    if (textBuffer.length === 0) {
      return;
    }
    const joined = textBuffer.join("\n");
    textBuffer = [];
    if (joined.trim()) {
      blocks.push({
        type: "text",
        text: joined,
      });
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;

    const fence = matchFenceOpen(line);
    if (fence !== null) {
      // Flush any accumulated prose before opening a code block.
      flushText();

      const codeLines: string[] = [];
      let j = i + 1;
      let closed = false;

      while (j < lines.length) {
        if (matchFenceClose(lines[j]!)) {
          closed = true;
          break;
        }
        codeLines.push(lines[j]!);
        j++;
      }

      if (closed) {
        const codeBlock: ResponseBlock = {
          type: "code",
          code: codeLines.join("\n"),
          fenced: true,
        };
        if (fence.language !== undefined) {
          (codeBlock as { language?: string }).language =
            fence.language;
        }
        blocks.push(codeBlock);
        i = j + 1;
        continue;
      }

      // Unclosed fence: emit opening fence + collected content
      // as a single text block. Never throw.
      const fallback = [line, ...codeLines].join("\n");
      if (fallback.trim()) {
        blocks.push({
          type: "text",
          text: fallback,
        });
      }
      i = lines.length;
      continue;
    }

    textBuffer.push(line);
    i++;
  }

  flushText();

  return blocks;
}
