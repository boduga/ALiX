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
 * Match a Markdown list item.
 *
 * Recognizes:
 *   - `- foo`        → marker "-"
 *   - `* foo`        → marker "*"
 *   - `+ foo`        → marker "+"
 *   - `1. foo`       → marker "ordered" (digit literal is not preserved)
 *   - `-`, `*`, `+`, `1.` (bare markers) are also matched with empty
 *     content. The scanner drops them via the items-length guard
 *     (so a stray `-` line on its own never produces a block).
 *
 * Content after the marker is optional; when present it must be
 * preceded by whitespace (`\s+`). A line like `-x` (no whitespace)
 * is NOT a list item.
 *
 * Returns `{ marker, text }` on a match, or `null` otherwise.
 */
function matchListItem(
  line: string
): { marker: ListMarker; text: string } | null {
  const dash = /^-(?:\s+(.*))?$/.exec(line);
  if (dash) {
    return {
      marker: "-",
      text: dash[1] ?? "",
    };
  }

  const star = /^\*(?:\s+(.*))?$/.exec(line);
  if (star) {
    return {
      marker: "*",
      text: star[1] ?? "",
    };
  }

  const plus = /^\+(?:\s+(.*))?$/.exec(line);
  if (plus) {
    return {
      marker: "+",
      text: plus[1] ?? "",
    };
  }

  const ordered = /^\d+\.(?:\s+(.*))?$/.exec(line);
  if (ordered) {
    return {
      marker: "ordered",
      text: ordered[1] ?? "",
    };
  }

  return null;
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
    // Trim trailing blank lines so a blank line at a list/code
    // boundary is treated as a separator, not glued onto prose.
    while (
      textBuffer.length > 0 &&
      textBuffer[textBuffer.length - 1]!.trim() === ""
    ) {
      textBuffer.pop();
    }
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

    // LIST MODE — must run before text-mode so a `- ` line is
    // recognized as a list item rather than absorbed into prose.
    // (Code-mode already ran above, so a code line beginning with
    // `- ` was handled there and is no longer in scope.)
    const item = matchListItem(line);
    if (item !== null) {
      flushText();

      const marker = item.marker;
      const items: string[] = [];

      if (item.text.trim()) {
        items.push(item.text);
      }

      let k = i + 1;
      while (k < lines.length) {
        const next = matchListItem(lines[k]!);
        if (next === null || next.marker !== marker) {
          break;
        }

        if (next.text.trim()) {
          items.push(next.text);
        }

        k++;
      }

      if (items.length) {
        blocks.push({
          type: "list",
          marker,
          items,
        });
      }

      i = k;
      continue;
    }

    // Text-mode fallback — accumulate until blank line or EOF.
    //
    // Two rules make list/text transitions clean:
    //   1. When text mode is FRESH (textBuffer empty AND we just
    //      exited a code or list block, or are at document start),
    //      blank lines are pure separators and never enter the buffer.
    //   2. flushText trims trailing blank lines before emitting, so
    //      a blank line that ends a text run (followed by a list or
    //      code block) is not glued onto the prose.
    //
    // Within a continuous text run, blank lines stay as content
    // (preserves the existing Task 2 "preserves blank lines" invariant).
    if (textBuffer.length === 0 && line.trim() === "") {
      i++;
      continue;
    }

    textBuffer.push(line);
    i++;
  }

  flushText();

  return blocks;
}
