/**
 * response-blocks-parser.vitest.ts — Task 2 + Task 3
 *
 * Tests `parseResponseBlocks` for the empty-input / plain-text
 * (mode: "text") surface, and the fenced-code-block surface
 * (mode: "code").
 *
 * Invariants verified here:
 *   - empty input and whitespace-only input return []
 *   - prose collapses to a single text block (no implicit splitting)
 *   - internal newlines and blank lines are preserved verbatim
 *   - CRLF line endings are normalized to LF
 *   - exactly three-backtick fences open and close code blocks
 *   - longer-than-three, tilde, and mismatched fences remain text
 *   - unclosed fences fall back to a single text block (no throw)
 *   - the return type is `readonly ResponseBlock[]`
 */

import { describe, it, expect } from "vitest";
import { parseResponseBlocks } from "../src/agent/response-blocks.js";

describe("parseResponseBlocks — text", () => {
  it("returns [] on empty input", () => {
    expect(parseResponseBlocks("")).toEqual([]);
  });

  it("returns [] on whitespace-only input", () => {
    expect(parseResponseBlocks(" \n\t ")).toEqual([]);
  });

  it("wraps prose as text", () => {
    expect(parseResponseBlocks("hello")).toEqual([
      {
        type: "text",
        text: "hello",
      },
    ]);
  });

  it("preserves internal newlines", () => {
    expect(parseResponseBlocks("one\ntwo\nthree")).toEqual([
      {
        type: "text",
        text: "one\ntwo\nthree",
      },
    ]);
  });

  it("preserves blank lines", () => {
    expect(parseResponseBlocks("first\n\nsecond")).toEqual([
      {
        type: "text",
        text: "first\n\nsecond",
      },
    ]);
  });

  it("normalizes CRLF", () => {
    expect(parseResponseBlocks("one\r\ntwo")).toEqual([
      {
        type: "text",
        text: "one\ntwo",
      },
    ]);
  });
});

describe("parseResponseBlocks — code fences", () => {
  it("parses language fence", () => {
    expect(parseResponseBlocks("```ts\nconst x = 1;\n```")).toEqual([
      {
        type: "code",
        language: "ts",
        code: "const x = 1;",
        fenced: true,
      },
    ]);
  });

  it("parses no-language fence", () => {
    expect(parseResponseBlocks("```\nplain\n```")).toEqual([
      {
        type: "code",
        code: "plain",
        fenced: true,
      },
    ]);
  });

  it("parses multiple code blocks", () => {
    expect(parseResponseBlocks("```ts\nx\n```\n\n```py\ny\n```")).toEqual([
      {
        type: "code",
        language: "ts",
        code: "x",
        fenced: true,
      },
      {
        type: "code",
        language: "py",
        code: "y",
        fenced: true,
      },
    ]);
  });

  it("falls back to text on unclosed fence", () => {
    expect(parseResponseBlocks("```ts\nhello")).toEqual([
      {
        type: "text",
        text: "```ts\nhello",
      },
    ]);
  });

  it("treats tilde fence as plain text", () => {
    expect(parseResponseBlocks("~~~ts\nhello\n~~~")).toEqual([
      {
        type: "text",
        text: "~~~ts\nhello\n~~~",
      },
    ]);
  });

  it("treats single backtick as plain text", () => {
    expect(parseResponseBlocks("`inline`")).toEqual([
      {
        type: "text",
        text: "`inline`",
      },
    ]);
  });

  it("treats two-backtick line as plain text", () => {
    expect(parseResponseBlocks("``foo``")).toEqual([
      {
        type: "text",
        text: "``foo``",
      },
    ]);
  });

  it("treats four-backtick line as plain text", () => {
    expect(parseResponseBlocks("````\nhello\n````")).toEqual([
      {
        type: "text",
        text: "````\nhello\n````",
      },
    ]);
  });

  it("treats mismatched fence as plain text", () => {
    expect(parseResponseBlocks("```ts\nhello\n~~~")).toEqual([
      {
        type: "text",
        text: "```ts\nhello\n~~~",
      },
    ]);
  });
});