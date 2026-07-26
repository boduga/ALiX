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
 * Rules (per the design spec):
 * - 3 or more backticks at the start of a line
 * - 4+ backticks are supported ONLY if the matching closing fence
 *   uses the same length (per spec: "Four-or-more-backtick fences
 *   — supported as fence delimiters only if the opening and closing
 *   match in length. Mismatched lengths → treated as text.")
 * - optional info string made of non-whitespace, non-backtick chars
 * - any trailing whitespace is allowed
 * - must be the entire line (anchored end)
 *
 * Returns `{ fenceLen, language? }` on a match, or `null` otherwise.
 * The caller (parseResponseBlocks) tracks the opening length and
 * uses it to match the closing fence.
 */
function matchFenceOpen(
  line: string
): { fenceLen: number; language?: string } | null {
  // Match 3+ backticks, capture length, and require exactly N backticks
  // (not more) so the line ends with optional info string and not
  // additional backticks. Anchored to start and end of line.
  const match = /^(`{3,})([^\s`]*)\s*$/.exec(line);
  if (!match) {
    return null;
  }
  const fenceLen = match[1]!.length;
  return {
    fenceLen,
    language: match[2] || undefined,
  };
}

/**
 * Match a closing code fence of exactly `fenceLen` backticks
 * (optionally followed by trailing whitespace). Uses string
 * equality — no dynamic regex construction — so the close
 * cannot accidentally accept a different-length fence.
 */
function matchFenceClose(line: string, fenceLen: number): boolean {
  // Line must be exactly fenceLen backticks, optionally with
  // trailing whitespace.
  const stripped = line.trimEnd();
  if (stripped.length !== fenceLen) return false;
  for (let i = 0; i < fenceLen; i++) {
    if (stripped[i] !== "`") return false;
  }
  return true;
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
        if (matchFenceClose(lines[j]!, fence.fenceLen)) {
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
    // A run of blank lines collapses to a SINGLE blank line per the
    // design spec: "A run of blank lines collapses to a single blank
    // line in the surrounding text block." So:
    //   - if textBuffer is empty (fresh-mode boundary), consume the
    //     run silently (the empty string would just be a leading
    //     separator that flushText would trim).
    //   - if textBuffer has content, push one empty line for the run
    //     so it appears as a single blank inside the text block.
    if (line.trim() === "") {
      let blankRun = 0;
      while (i + blankRun < lines.length && lines[i + blankRun]!.trim() === "") {
        blankRun++;
      }
      if (textBuffer.length > 0) {
        // Collapse multi-blank to one, but only if we haven't already
        // pushed an empty line for this run.
        if (textBuffer[textBuffer.length - 1] !== "") {
          textBuffer.push("");
        }
      }
      i += blankRun;
      continue;
    }

    textBuffer.push(line);
    i++;
  }

  flushText();

  return blocks;
}
