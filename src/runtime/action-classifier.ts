// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

/**
 * action-classifier.ts — Deterministic, side-effect-free prompt router.
 *
 * Decides what kind of action an incoming user prompt represents so the
 * runtime can pick an execution route:
 *
 *   - arithmetic            → answer directly from the parsed expression
 *   - workspace_action      → run a workspace agent (read / write the repo)
 *   - external_retrieval    → run a grounded chat (web / docs search)
 *   - standalone_generation → answer directly via model generation
 *   - ambiguous             → no decisive signal; caller picks the default
 *
 * The classifier is pure:
 *
 *   - no eval / Function constructor / dynamic import
 *   - no provider, filesystem, network, or tool access
 *   - same input always produces the same output
 *
 * Precedence (most specific wins, evaluated top-down):
 *
 *   arithmetic
 *     ↓
 *   workspace / action  (always dominates retrieval + generation)
 *     ↓
 *   external retrieval
 *     ↓
 *   standalone generation
 *     ↓
 *   ambiguous
 */

/**
 * The five mutually-exclusive intents this classifier can return.
 *
 * `arithmetic` and `standalone_generation` route to direct answers;
 * `workspace_action` routes to a workspace-capable agent;
 * `external_retrieval` routes to a grounded chat;
 * `ambiguous` is the safe fallback when no signal dominates.
 */
export type ActionIntent =
  | "arithmetic"
  | "standalone_generation"
  | "workspace_action"
  | "external_retrieval"
  | "ambiguous";

/**
 * Result of classifying a single prompt.
 *
 * `arithmeticAnswer` is set only when `intent === "arithmetic"`; it is the
 * deterministic string form of the parsed expression's value.
 */
export interface ActionClassification {
  intent: ActionIntent;
  reason: string;
  confidence?: number;
  arithmeticAnswer?: string;
}

import type { ModelAdapter } from "../providers/types.js";

// ─────────────────────────────────────────────────────────────────────
// Arithmetic parser
// ─────────────────────────────────────────────────────────────────────

/**
 * Safe recursive-descent arithmetic evaluator.
 *
 * Grammar (right-associative `^`):
 *
 *   expression := term (('+' | '-') term)*
 *   term       := factor (('*' | '/' | '%') factor)*
 *   factor     := exponent ('^' factor)?       // right-associative
 *   exponent   := ('+' | '-')? exponent | primary
 *   primary    := NUMBER | '(' expression ')'
 *
 * Allowed tokens: numbers, `+ - * / % ^`, parentheses, unary `+`/`-`.
 *
 * Rejects (returns `null`) on:
 *   - empty or non-string input
 *   - identifiers or unknown characters
 *   - malformed syntax (unbalanced parens, trailing operators, …)
 *   - divide-by-zero or modulo-by-zero
 *   - non-finite results (overflow → Infinity, NaN)
 *
 * No `eval`, no `Function`, no provider / filesystem / tool access.
 *
 * @returns The parsed value on success, or `null` on any failure.
 */
export function evaluateArithmetic(input: string): number | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const tokens = tokenize(trimmed);
  if (tokens === null) return null;
  // Pure-arithmetic inputs must consist *only* of numbers and operators,
  // so the parsed expression must consume every token.
  if (tokens.length === 0) return null;

  const state: ParseState = { tokens, index: 0 };
  const value = parseExpression(state);
  if (value === null) return null;
  if (state.index !== state.tokens.length) return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

interface ParseState {
  tokens: Token[];
  index: number;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "op"; op: "+" | "-" | "*" | "/" | "%" | "^" }
  | { kind: "lparen" }
  | { kind: "rparen" };

/**
 * Lex the input into a flat token stream. Returns `null` on the first
 * character that is not whitespace, a digit, `.`, an operator, or a
 * parenthesis — which is how identifiers and unknown symbols are rejected.
 */
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }
    if (
      ch === "+" || ch === "-" || ch === "*" ||
      ch === "/" || ch === "%" || ch === "^"
    ) {
      tokens.push({ kind: "op", op: ch });
      i++;
      continue;
    }
    if ((ch >= "0" && ch <= "9") || ch === ".") {
      const start = i;
      let sawDot = false;
      while (i < input.length) {
        const c = input[i];
        if (c >= "0" && c <= "9") {
          i++;
        } else if (c === ".") {
          if (sawDot) return null; // malformed number
          sawDot = true;
          i++;
        } else {
          break;
        }
      }
      const literal = input.slice(start, i);
      // Require at least one digit — "." alone is not a valid number.
      if (literal === ".") return null;
      const value = Number(literal);
      if (!Number.isFinite(value)) return null;
      tokens.push({ kind: "number", value });
      continue;
    }
    // Any other character (letter, symbol, …) → identifier / unknown.
    return null;
  }
  return tokens;
}

function peek(state: ParseState): Token | undefined {
  return state.tokens[state.index];
}

function consume(state: ParseState): Token | undefined {
  return state.tokens[state.index++];
}

function parseExpression(state: ParseState): number | null {
  let left = parseTerm(state);
  if (left === null) return null;
  while (true) {
    const tok = peek(state);
    if (!tok || tok.kind !== "op" || (tok.op !== "+" && tok.op !== "-")) break;
    consume(state);
    const right = parseTerm(state);
    if (right === null) return null;
    left = tok.op === "+" ? left + right : left - right;
    if (!Number.isFinite(left)) return null;
  }
  return left;
}

function parseTerm(state: ParseState): number | null {
  let left = parseFactor(state);
  if (left === null) return null;
  while (true) {
    const tok = peek(state);
    if (
      !tok ||
      tok.kind !== "op" ||
      (tok.op !== "*" && tok.op !== "/" && tok.op !== "%")
    ) {
      break;
    }
    consume(state);
    const right = parseFactor(state);
    if (right === null) return null;
    if (tok.op === "*") {
      left = left * right;
    } else if (tok.op === "/") {
      if (right === 0) return null;
      left = left / right;
    } else {
      // '%'
      if (right === 0) return null;
      left = left % right;
    }
    if (!Number.isFinite(left)) return null;
  }
  return left;
}

function parseFactor(state: ParseState): number | null {
  const base = parseExponent(state);
  if (base === null) return null;
  const tok = peek(state);
  if (tok && tok.kind === "op" && tok.op === "^") {
    consume(state);
    const exp = parseFactor(state); // right-associative recursion
    if (exp === null) return null;
    const result = Math.pow(base, exp);
    if (!Number.isFinite(result)) return null;
    return result;
  }
  return base;
}

function parseExponent(state: ParseState): number | null {
  const tok = peek(state);
  if (tok && tok.kind === "op" && (tok.op === "+" || tok.op === "-")) {
    consume(state);
    const value = parseExponent(state); // allow --3, +-3, etc.
    if (value === null) return null;
    return tok.op === "-" ? -value : value;
  }
  return parsePrimary(state);
}

function parsePrimary(state: ParseState): number | null {
  const tok = peek(state);
  if (!tok) return null;
  if (tok.kind === "number") {
    consume(state);
    return tok.value;
  }
  if (tok.kind === "lparen") {
    consume(state);
    const value = parseExpression(state);
    if (value === null) return null;
    const close = consume(state);
    if (!close || close.kind !== "rparen") return null;
    return value;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────────────────────────

/**
 * Phrases that anchor a prompt to the local workspace / repository.
 * Their presence dominates retrieval and generation signals.
 */
const WORKSPACE_ANCHORS: readonly RegExp[] = [
  /\bmy\s+repo\b/i,
  /\bmy\s+codebase\b/i,
  /\bmy\s+code\b/i,
  /\bmy\s+project\b/i,
  /\bmy\s+workspace\b/i,
  /\bthis\s+repo\b/i,
  /\bthis\s+codebase\b/i,
  /\bthis\s+project\b/i,
  /\bthis\s+file\b/i,
  /\bthis\s+function\b/i,
  /\bthis\s+class\b/i,
  /\bthis\s+method\b/i,
  /\bthis\s+module\b/i,
  /\bthis\s+code\b/i,
  /\bthe\s+repo\b/i,
  /\bthe\s+repository\b/i,
  /\bthe\s+codebase\b/i,
  /\bin\s+this\s+repo\b/i,
  /\bin\s+this\s+file\b/i,
  /\bin\s+this\s+project\b/i,
  /\bin\s+the\s+repo\b/i,
  /\bin\s+the\s+codebase\b/i,
  /\bin\s+the\s+repository\b/i,
  // Codebase-search idioms: "find usages of X", "find references to Y"
  // Moved here from RETRIEVAL_SIGNALS so these route to workspace_action
  // (agent / codebase search) instead of external_retrieval (web search).
  /\bfind\s+(?:all\s+)?(?:usages?|references?|occurrences?)\b/i,
];

/**
 * Tokens / patterns that imply current external information. Evaluated
 * only when no workspace anchor is present.
 */
const RETRIEVAL_SIGNALS: readonly RegExp[] = [
  /\bsearch\b/i,
  /\blook\s+up\b/i,
  /\bweb\b/i,
  /\bonline\b/i,
  /\bthe\s+internet\b/i,
  /\blatest\b/i,
  /\bcurrent\b/i,
  /\btoday\b/i,
  /\brecent\b/i,
  /\bnews\b/i,
  /\bvulnerabilit(?:y|ies)\b/i,
  /\bcve\b/i,
  /\bversion\b/i,
  /\bschedule\b/i,
  /\bprice\b/i,
  /\brelease\b/i,
  /\bcompare current\b/i,
];

/**
 * Tokens / patterns that imply a direct, model-generated answer.
 * Evaluated only when neither arithmetic nor workspace nor retrieval
 * signals are present.
 */
const GENERATION_SIGNALS: readonly RegExp[] = [
  // Programming-language context — clearly generating code, not editing repo.
  /\bin\s+(?:python|javascript|typescript|js|ts|go|rust|java|c\+\+|c#|ruby|php|kotlin|swift|haskell|scala|elixir|clojure|lua|r|matlab|sql|html|css|bash|shell|zig)\b/i,
  // "write a poem / story / function / script" — generation.
  /\bwrite\s+(?:a|an|the|me|some)\s+(?:poem|story|essay|function|script|snippet|example|joke|email|letter|song|haiku|limerick|paragraph|biography|summary)\b/i,
  // "generate / compose a …"
  /\bgenerate\s+(?:a|an|the|me|some)\b/i,
  /\bcompose\s+(?:a|an|the|me|some)\b/i,
  // "explain X to me" with no workspace anchor — generation.
  /\bexplain\s+.+\s+to\s+me\b/i,
];

function hasAny(text: string, patterns: readonly RegExp[]): boolean {
  for (const p of patterns) {
    if (p.test(text)) return true;
  }
  return false;
}

/**
 * Classify a user prompt into one of the supported action intents.
 *
 * Pure function — no eval, no I/O, no provider access. Same input always
 * returns the same output. See the file header for the full precedence
 * ordering.
 */
export function classifyAction(input: string): ActionClassification {
  if (typeof input !== "string") {
    return { intent: "ambiguous", reason: "non-string input" };
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return { intent: "ambiguous", reason: "empty prompt" };
  }

  // 1. Pure arithmetic — answer directly with the parsed expression.
  const arith = evaluateArithmetic(trimmed);
  if (arith !== null) {
    return {
      intent: "arithmetic",
      reason: "prompt is a pure arithmetic expression",
      arithmeticAnswer: formatNumber(arith),
    };
  }

  // 2. Workspace / action indicators dominate everything below.
  if (hasAny(trimmed, WORKSPACE_ANCHORS)) {
    return {
      intent: "workspace_action",
      reason: "prompt references the local workspace or repository",
    };
  }

  // 3. External retrieval — current information from outside the repo.
  if (hasAny(trimmed, RETRIEVAL_SIGNALS)) {
    return {
      intent: "external_retrieval",
      reason: "prompt asks for current or external information",
    };
  }

  // 4. Standalone generation — answer directly via the model.
  if (hasAny(trimmed, GENERATION_SIGNALS)) {
    return {
      intent: "standalone_generation",
      reason: "prompt asks for direct model generation",
    };
  }

  // 5. Fall back to ambiguous — caller decides the default route.
  return {
    intent: "ambiguous",
    reason: "no decisive signal; default route applies",
  };
}

/**
 * Format a numeric result for the `arithmeticAnswer` field.
 *
 * Integers serialize without a decimal point; non-integers are rounded
 * to 12 fractional digits and re-numbered to drop trailing zeros.
 */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  return Number(n.toFixed(12)).toString();
}

// ─────────────────────────────────────────────────────────────────────
// Hybrid confidence scoring
// ─────────────────────────────────────────────────────────────────────

/**
 * CONFIDENCE_THRESHOLD — minimum confidence score below which the
 * deterministic classifier may defer to the model-based fallback.
 * Hardcoded at 0.7; tune based on real-world false-positive rates.
 */
export const CONFIDENCE_THRESHOLD = 0.7;

/**
 * Deterministic confidence for each intent. Based on pattern precision.
 */
function confidenceForIntent(intent: ActionIntent): number {
  switch (intent) {
    case "arithmetic": return 1.0;
    case "workspace_action": return 0.95;
    case "standalone_generation": return 0.85;
    case "external_retrieval": return 0.75;
    case "ambiguous": return 0.5;
  }
}

/**
 * Like `classifyAction` but returns a confidence score alongside the
 * classification. Pure function — no I/O, no provider access.
 *
 * The confidence score lets callers decide whether to rely on the
 * deterministic result or fall back to a model-based classification.
 */
export function classifyActionWithConfidence(
  input: string,
): ActionClassification & { confidence: number } {
  const result = classifyAction(input);
  return {
    ...result,
    confidence: confidenceForIntent(result.intent),
  };
}

/**
 * Model-based classification fallback for prompts the deterministic
 * classifier is unsure about (ambiguous or low-confidence).
 *
 * Makes one small provider call (~50 in / ~5 out tokens) with a
 * terse system prompt. On provider error (timeout, connection refused)
 * returns `ambiguous` — the model call must never block routing.
 */
export async function modelClassifyAction(
  input: string,
  provider: ModelAdapter,
): Promise<ActionClassification> {
  try {
    const response = await provider.complete({
      systemPrompt:
        "You are a prompt router. Given a user request, classify it as exactly " +
        "one of these labels:\n\n" +
        "arithmetic\nworkspace_action\nstandalone_generation\nexternal_retrieval\nambiguous\n\n" +
        "Reply with ONLY the label. No explanation. No punctuation.",
      messages: [{ role: "user", content: input }],
      maxOutputTokens: 128,
    });
    const label = (response.text ?? "").trim().toLowerCase();
    const VALID: ActionIntent[] = [
      "arithmetic", "workspace_action", "standalone_generation",
      "external_retrieval", "ambiguous",
    ];
    const intent = VALID.find((v) => label === v);
    if (intent) {
      return { intent, reason: `model classified: ${label}` };
    }
    return { intent: "ambiguous", reason: `model returned unrecognized label: ${label}` };
  } catch {
    return { intent: "ambiguous", reason: "model classifier unavailable" };
  }
}
