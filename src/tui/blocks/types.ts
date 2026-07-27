// src/tui/blocks/types.ts
// Pure type definitions for the rich response rendering pipeline.
// No runtime code — every interface here is transport-independent and
// has zero knowledge of ANSI, canvases, or terminals.

/** Heading levels 1-3 (we don't render H4-H6 — same as GitHub-flavored md). */
export type HeadingLevel = 1 | 2 | 3;

/**
 * Inline span kinds. A text block's content is a sequence of these.
 * `text` is plain prose; `bold`/`italic`/`code` are styled; `link`
 * carries an `href` (Phase 1: rendered as bold + underline, no OSC-8).
 */
export type InlineSpan =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'strikethrough'; text: string };

/**
 * Code token kinds. The renderer never knows what Python is — it only
 * knows which Theme method to call per kind.
 */
export type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'identifier'
  | 'operator'
  | 'punctuation'
  | 'plain';

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
}

/**
 * A single block in a parsed response. `code` blocks carry `spans:
 * undefined` because their content is not run through the inline parser.
 */
export type ResponseBlock =
  | { type: 'text'; text: string; spans?: readonly InlineSpan[] }
  | { type: 'code'; language?: string; code: string; spans?: undefined }
  | { type: 'list'; marker: 'unordered' | 'ordered'; items: readonly string[]; checked?: readonly (boolean | undefined)[] }
  | { type: 'heading'; level: HeadingLevel; text: string; spans?: readonly InlineSpan[] }
  | { type: 'quote'; text: string; spans?: readonly InlineSpan[] }
  | { type: 'rule' }
  | { type: 'table'; headers: readonly string[]; rows: readonly (readonly string[])[]; align?: readonly ('left' | 'center' | 'right')[] };

/**
 * Theme interface — every visual decision goes through one of these.
 * `codeBorder`, `quoteBar`, `rule` are raw ANSI prefixes (no text wrap)
 * because they're stamped onto per-cell styles. The rest take a string
 * and return a styled version.
 */
export interface Theme {
  heading(level: HeadingLevel, text: string): string;
  headingRule(level: HeadingLevel): string;
  bold(text: string): string;
  italic(text: string): string;
  inlineCode(text: string): string;
  strikethrough(text: string): string;
  codeBorder: string;
  codeLangLabel(text: string): string;
  codeKeyword(text: string): string;
  codeString(text: string): string;
  codeComment(text: string): string;
  codeNumber(text: string): string;
  codeFunction(text: string): string;
  codeOperator(text: string): string;
  codePunctuation(text: string): string;
  codePlain(text: string): string;
  calloutLabel(keyword: string): string;
  tableBorder: string;
  quoteBar: string;
  quote(text: string): string;
  taskChecked: string;
  taskUnchecked: string;
  rule: string;
  link(text: string, href: string): string;
}

/** Output of the renderer. `isFirst` carries the existing turn-marker convention. */
export interface StyledRow {
  text: string;
  isFirst: boolean;
}

/** A language-specific tokenizer. Each language implements this interface. */
export interface Tokenizer {
  readonly language: string;
  tokenize(code: string): Token[];
}
