/**
 * response-blocks-parser.vitest.ts — Task 2
 *
 * Tests `parseResponseBlocks` for the empty-input / plain-text
 * (mode: "text") surface. Code and list parsing land in Tasks 3
 * and 4 respectively.
 *
 * Invariants verified here:
 *   - empty input and whitespace-only input return []
 *   - prose collapses to a single text block (no implicit splitting)
 *   - internal newlines and blank lines are preserved verbatim
 *   - CRLF line endings are normalized to LF
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