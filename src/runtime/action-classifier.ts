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
 *   - generation → answer directly via model generation
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
 * The six mutually-exclusive intents this classifier can return.
 *
 * `arithmetic` and `generation` route to direct answers;
 * `workspace_action` (state) and `workspace_mutation` (mutation) both
 *   route to a workspace-capable agent — the split is surfaced at
 *   Layer 1 for auditability per `docs/intent-contracts/canonical-taxonomy.md`
 *   (T8 on wayfinder map #376);
 * `external_retrieval` routes to a grounded chat;
 * `ambiguous` is the safe fallback when no signal dominates.
 */
export type ActionIntent =
  | "arithmetic"
  | "generation"
  | "workspace_action"
  | "workspace_mutation"
  | "external_retrieval"
  | "shell_execution"
  | "read_only_analysis"
  | "planning"
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
  // Shell-state probes — these prompts semantically require local shell
  // tool access (`which X`, `pgrep X`, `lsof -i :PORT`). Left as ambiguous,
  // the model fallback could label them `generation`, sending
  // them through the `direct` executor — a one-line system prompt with no
  // tool manifest — and the model answered "I don't have direct access to
  // your system" instead of calling `alix_shell_run`. Anchoring them here
  // guarantees the agent loop (full prompt + tool access) handles them.
  /\b(?:is|are)\s+\S+(?:\s+\S+){0,4}?\s+(?:installed|available|running)\b/i,
  /\bdo\s+i\s+have\s+\w[\w.-]*/i,
  /\bcheck\s+(?:if|whether)\b/i,
  /\bwhat(?:'s|\s+is)\s+running\b/i,
];

/**
 * Workspace-mutation recognizers (T8 on wayfinder map #376).
 * A prompt matches `workspace_mutation` when it asks the runtime to
 * change the local filesystem — create, edit, delete, rename, install,
 * etc. — distinct from `workspace_action` (state, read-only) and
 * `shell_execution` (run a command, observe output).
 *
 * Trigger precedence: `workspace_action` (state) fires BEFORE
 * `workspace_mutation` so that probes with conditional mutation
 * ("is curl installed or do I need to install it") classify as
 * state — preserves T1's documented ambiguous-corpus policy.
 *
 * Superset of the legacy `hasWorkspaceWriteIntent` carve-out at
 * `task-router.ts:475-477` (now deleted as a no-op). The carve-out
 * required a preposition after the verb; the MUTATION_ANCHORS family
 * accepts several shapes:
 *
 *   - imperative verb + object: "create a file", "install curl", "delete foo.txt"
 *   - verb + object + preposition: "write X to Y", "save X to Y"
 *   - rename/move: "rename X to Y", "move X to Y"
 *   - file-system verbs: "mkdir foo", "touch foo"
 *
 * Per `docs/intent-contracts/workspace-mutation.md`:
 *   - Positive corpus: "create foo.ts", "rename X to Y", "delete Y",
 *     "write file", "edit Z", "save changes", "install curl", "remove the cache from npm"
 *   - Negative corpus: workspace-state probes, generation, planning,
 *     read-only-analysis, shell-execution (no shell prompts)
 *   - Trigger precedence: state first, mutation second
 *   - Confidence: 0.95 for direct matches
 *   - Test corpus: `tests/runtime/action-classifier.test.ts →
 *     describe("workspace-mutation recognition contract")`
 */
const MUTATION_ANCHORS: readonly RegExp[] = [
  // Superset of hasWorkspaceWriteIntent (task-router.ts:475-477).
  // The legacy carve-out required a preposition after the verb; this
  // pattern captures the same shape but is now a Layer-1 recognizer.
  /\b(?:write|put|save|create|make|append|delete|remove|rm)\s+\S+\s+(?:to|into|in|as|from|on)\b/i,
  // Imperative mutation verbs at the START of the prompt.
  // Required to be at the start so that "explain the install process"
  // does NOT match (the noun "install" is part of an explanation, not
  // an imperative). Captures "install curl", "create foo.ts",
  // "delete foo.txt", "remove the cache from npm", "edit config.ts",
  // "update README.md", "rename foo.ts", "touch bar", "mkdir foo".
  /^(?:install|uninstall|create|delete|remove|rm|rename|edit|update|touch|mkdir|chmod|chown)\s+\S+/i,
  // Create-new mutation object forms (noun after the verb).
  /\bcreate\s+(?:a\s+|an\s+|the\s+)?(?:file|directory|folder|script|module|component|class|function|endpoint|note|document|test|spec|backup)\b/i,
  // Rename / move forms.
  /\b(?:rename|move|mv)\s+\S+\s+(?:to|into)\b/i,
  // "make a X" creation.
  /\bmake\s+(?:a\s+|an\s+|the\s+)?(?:file|directory|note|script|module|change|list|plan|copy|backup)\b/i,
  // "save changes" / "save X" — explicit save verb.
  /\bsave\s+(?:changes|the\s+\S+|\S+\s+to)\b/i,
  // "save changes" / "save the file" forms.
  /\b(?:write|save)\s+(?:a\s+|an\s+|the\s+)?(?:file|changes|notes|document|backup)\b/i,
];

/**
 * Read-only-analysis recognizers (T10 on wayfinder map #376).
 * A prompt matches `read_only_analysis` when it asks the runtime to
 * explain, summarize, describe, review, analyze, or compare existing
 * content without executing anything — distinct from `workspace_state`
 * (inspect local repo), `generation` (produce new text), and `planning`
 * (decide/propose).
 *
 * Per `docs/intent-contracts/read-only-analysis.md`:
 *   - Positive corpus: `explain the install process`, `summarize README.md`,
 *     `describe how X works`, `review this PR`, `compare X to Y`,
 *     `walk me through the auth flow`, `analyze the codebase`
 *   - Negative corpus: workspace-state probes, generation, planning,
 *     workspace-mutation, shell-execution
 *   - Trigger precedence: read_only_analysis fires AFTER workspace
 *     (state and mutation win) and BEFORE generation/external_retrieval
 *   - Confidence: 0.85 for direct verb matches, 0.75 for question forms
 *   - Test corpus: `tests/runtime/action-classifier.test.ts →
 *     describe("read-only-analysis recognition contract")`
 */
const READ_ONLY_ANALYSIS_ANCHORS: readonly RegExp[] = [
  // Direct verb forms
  /\b(?:explain|summarize|describe|review|analyze|examine|inspect)\s+(?:the\s+|a\s+|an\s+|my\s+|our\s+)?\S+/i,
  // "compare X to/with/against Y"
  /\bcompare\s+\S+\s+(?:to|with|against)\s+\S+/i,
  // "what does X do" / "what is X"
  /\bwhat\s+(?:does|is|are)\s+\S+/i,
  // "how does X work"
  /\bhow\s+(?:does|do|is|are)\s+\S+/i,
  // "walk me through"
  /\bwalk\s+(?:me\s+)?through\b/i,
  // "tell me about X"
  /\btell\s+me\s+about\b/i,
  // "give me an overview of X"
  /\b(?:give\s+me\s+(?:an?\s+)?)?overview\s+of\b/i,
  // "what's the difference between X and Y"
  /\b(?:what(?:'s|\s+is)\s+)?(?:the\s+)?difference\s+between\b/i,
  // "pros and cons"
  /\bpros\s+(?:and|&)\s+cons\b/i,
];

/**
 * Decision-question recognizers (T11 on wayfinder map #376).
 * A prompt matches `planning` when it asks the runtime to make a choice,
 * propose an approach, recommend a library, or compare alternatives —
 * NOT to inspect current state, execute a command, mutate a file, or
 * read-only explain existing text.
 *
 * Trigger precedence: planning fires AFTER `generation` (so
 * "write a plan for X" routes to generation via the write-noun pattern)
 * and BEFORE ambiguous. Planning dominates `read_only_analysis`.
 *
 * Per `docs/intent-contracts/planning.md`:
 *   - Confidence: 0.85
 *   - Test corpus: `tests/runtime/action-classifier.test.ts →
 *     describe("classifyAction — planning recognition contract")`
 */
const PLANNING_ANCHORS: readonly RegExp[] = [
  // "should I use X", "should I adopt Y" — first-person decision question.
  /\bshould\s+I\s+/i,
  // "should we adopt Z" — first-person-plural decision question.
  /\bshould\s+we\s+/i,
  // "decide between A and B" — explicit decision verb.
  /\bdecide\s+/i,
  // "choose between X and Y" — explicit decision verb.
  /\bchoose\s+between\b/i,
  // "plan the migration", "plan a refactor" — imperative planning verb.
  /\bplan\s+/i,
  // "design a cache layer", "design an API" — imperative design verb.
  /\bdesign\s+a?\s+/i,
  // "propose an architecture" — imperative propose verb.
  /\bpropose\s+/i,
  // "recommend a library" — imperative recommend verb.
  /\brecommend\s+/i,
  // "what's the best way to X" — decision question disguised as question.
  /\bwhat's\s+the\s+best\s+/i,
  // "compare options", "compare alternatives", "compare approaches".
  /\bcompare\s+(?:options|alternatives|approaches)\b/i,
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
 * Patterns that anchor a prompt as a **shell-execution** request —
 * "run this command, show me the output". Side-effect-agnostic: the
 * command itself is the request (read/observe, or dev-tool subcommands).
 *
 * T9 (#385) graduates this family from `isShellTask` at
 * `src/task-classifier.ts:142` (a Layer-2 planning lens used inside
 * the agent loop) up to Layer 1 — `classifyAction`. Layer 2 stays
 * alive as the agent loop's planning lens; Layer 1 surfaces the
 * intent deterministically so the closed-world invariant test pins
 * the (shell_execution, tool) chain at Layer 1 → Layer 3.
 *
 * Anchored to start of prompt so natural-language phrasings
 * ("list of bugs", "what's in package.json") do not match.
 * workspace_action dominates this family — "run ls on my repo" still
 * classifies as workspace_action (see trigger-precedence test).
 */
const SHELL_EXECUTION_ANCHORS: readonly RegExp[] = [
  // Bare shell commands (read/observe). Anchored with `^` so "list of
  // bugs in the repo" does not match (it would only match if we
  // accepted "list" as an alias for ls, which we don't). Negative
  // lookahead rejects prompts with a natural-language tail like "run
  // tests and fix failures" (multi-action task, must stay on agent).
  /^\s*(?:ls|pwd|cat|head|tail|grep|find|wc|sort|uniq|stat|du|df|whoami|env|echo|printf|type|curl|ping|tr|awk|sed|tee|basename|dirname|file|less|more|md5sum|sha256sum|date|uptime|hostname|uname|id|groups|which|whereis|man|history|jobs|ps|top|netstat|ss|lsof|ifconfig|ip|traceroute|nslookup|dig|host|wget|tar|zip|unzip|gzip|gunzip|cd|mkdir|touch|rmdir)\b(?!\s+(?:and|or|then|but|fix|failures?|errors?|so)\s+\S+)/i,
  // Dev-tool subcommands (read/observe only). Mutating subcommands
  // (install, add, remove, rm, create) are intentionally excluded —
  // T9 is narrower than `isShellTask` and `npm install curl` belongs
  // to workspace_mutation per the canonical taxonomy.
  /^\s*(?:npm|pnpm|yarn|bun)\s+(?:test|run|ls|list|view|info|search|docs|outdated|audit|version|v|init|config|help|h|scripts?|publish|ci|why|funding|login|logout|whoami|prune|dedupe|rebuild|pack|exec|start|stop|restart)\b(?!\s+(?:and|or|then|but|fix|failures?|errors?|so)\s+\S+)/i,
  // Common dev-tool prefixes with a subcommand. Includes git, docker,
  // kubectl, helm, terraform, ssh, scp, rsync, brew, apt, systemctl,
  // service, crontab. Word boundary `\b` after the subcommand token
  // prevents `\S+` from backtracking through English-connective tails.
  /^\s*(?:git|docker|kubectl|helm|terraform|aws|gcloud|az|ssh|scp|rsync|brew|apt|apt-get|yum|dnf|pacman|snap|systemctl|service|crontab)\s+\S+\b(?!\s+(?:and|or|then|but|fix|failures?|errors?|so)\s+\S+)/i,
  // Prefixed-command forms — natural-language wrappers around a command.
  // "run npm test", "execute the build", "exec ls -la", "use bash to …".
  // Word boundary `\b` after the command token prevents `\S+` from
  // backtracking through English-connective tails like "and fix failures".
  /^\s*(?:run|execute|exec|invoke|fire|trigger|spawn)\s+(?:a|an|the|my|some)?\s*\S+\b(?!\s+(?:and|or|then|but|fix|failures?|errors?|so)\s+\S+)/i,
  /^\s*(?:use|run|execute|exec)\s+(?:bash|shell|sh|zsh)\s+to\b(?!\s+(?:and|or|then|but|fix|failures?|errors?|so)\s+\S+)/i,
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
  /\bwrite\s+(?:a|an|the|me|some)\s+(?:poem|story|essay|function|script|snippet|example|joke|email|letter|song|haiku|limerick|paragraph|biography|summary|plan)\b/i,
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

  // 3. Workspace mutation — file change / install / delete / rename.
  //    Fires AFTER state (step 2) so probes with conditional mutation
  //    ("is curl installed or do I need to install it") classify as
  //    state — preserves T1's documented ambiguous-corpus policy.
  //    See `docs/intent-contracts/workspace-mutation.md` (T8).
  if (hasAny(trimmed, MUTATION_ANCHORS)) {
    return {
      intent: "workspace_mutation",
      reason: "prompt asks to change the local workspace",
    };
  }

  // 4. External retrieval — current information from outside the repo.
  if (hasAny(trimmed, RETRIEVAL_SIGNALS)) {
    return {
      intent: "external_retrieval",
      reason: "prompt asks for current or external information",
    };
  }

  // 5. Standalone generation — answer directly via the model.
  if (hasAny(trimmed, GENERATION_SIGNALS)) {
    return {
      intent: "generation",
      reason: "prompt asks for direct model generation",
    };
  }

  // 5. Shell execution — run a command, observe its output. Anchored
  //    regex family (SHELL_EXECUTION_ANCHORS). Surfaces the intent
  //    deterministically so the closed-world invariant test can pin
  //    the (shell_execution, tool) chain at Layer 1 → Layer 3 without
  //    relying on the Layer-2 isShellTask lens inside the agent loop.
  if (hasAny(trimmed, SHELL_EXECUTION_ANCHORS)) {
    return {
      intent: "shell_execution",
      reason: "prompt is a shell command or dev-tool subcommand request",
    };
  }

  // 6. Read-only analysis — explain / summarize / describe / review.
  //    (T10 on wayfinder map #376). Distinct from generation
  //    ("write a tutorial") and planning ("should I use X").
  //    See `docs/intent-contracts/read-only-analysis.md`.
  if (hasAny(trimmed, READ_ONLY_ANALYSIS_ANCHORS)) {
    return {
      intent: "read_only_analysis",
      reason: "prompt asks for analysis of existing content",
    };
  }

  // 7. Planning — decide / propose / recommend / should-I-use-X.
  //    (T11 on wayfinder map #376). Dominates read_only_analysis.
  //    See `docs/intent-contracts/planning.md`.
  if (hasAny(trimmed, PLANNING_ANCHORS)) {
    return {
      intent: "planning",
      reason: "prompt asks for a decision or proposal",
    };
  }

  // 8. Fall back to ambiguous — caller decides the default route.
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
    case "workspace_mutation": return 0.95;
    case "shell_execution": return 0.9;
    case "generation": return 0.85;
    case "read_only_analysis": return 0.85;
    case "planning": return 0.85;
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
/**
 * The 9 labels `modelClassifyAction` accepts. Shared between the system
 * prompt and the parse — single source of truth.
 */
const MODEL_VALID_INTENTS: ActionIntent[] = [
  "arithmetic", "workspace_action", "workspace_mutation",
  "generation", "external_retrieval", "shell_execution",
  "read_only_analysis", "planning", "ambiguous",
];

/**
 * Conservative confidence assigned when the model omits or mangles the
 * confidence field (T23 #401). Below the Layer-2 floor (0.7, T24 #402) so a
 * missing confidence signal fails toward safety: the label is never trusted
 * for high-risk routing.
 */
const MODEL_CONFIDENCE_DEFAULT = 0;

/**
 * Extract the first balanced JSON object `{...}` from arbitrary text.
 *
 * T23 #401: models may wrap output in code fences (```json ... ```) or add
 * surrounding prose. This scans for the first `{` and matches braces until the
 * object closes, ignoring braces inside string literals. Returns null when no
 * JSON object is recoverable.
 */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth++;
      continue;
    }
    if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse the model's classification output into a canonical-intent + confidence
 * pair (T23 #401).
 *
 * JSON-first: expects `{"intent": "<label>", "confidence": <0-1>}`, robust
 * against code fences, surrounding prose, and malformed JSON. Falls back to
 * the legacy plain-label reply when no JSON object is recoverable (models that
 * ignore the JSON instruction).
 *
 * Returns `confidence` always — a validated number in [0,1], or
 * `MODEL_CONFIDENCE_DEFAULT` when absent/invalid.
 */
function parseModelClassification(
  raw: string,
): { intent: ActionIntent; reason: string; confidence: number } {
  const trimmed = (raw ?? "").trim();

  // 1. Recover the first balanced JSON object, if any.
  const jsonText = extractFirstJsonObject(trimmed);
  if (jsonText !== null) {
    try {
      const parsed = JSON.parse(jsonText) as {
        intent?: unknown;
        confidence?: unknown;
      };
      const intent = MODEL_VALID_INTENTS.find((v) => v === parsed.intent);
      if (intent) {
        const confidence =
          typeof parsed.confidence === "number" &&
          Number.isFinite(parsed.confidence) &&
          parsed.confidence >= 0 &&
          parsed.confidence <= 1
            ? parsed.confidence
            : MODEL_CONFIDENCE_DEFAULT;
        return {
          intent,
          reason: `model classified: ${intent} (confidence ${confidence})`,
          confidence,
        };
      }
      const rawIntent =
        typeof parsed.intent === "string"
          ? parsed.intent
          : String(parsed.intent ?? "?");
      return {
        intent: "ambiguous",
        reason: `model returned unrecognized intent: ${rawIntent}`,
        confidence: MODEL_CONFIDENCE_DEFAULT,
      };
    } catch {
      // Malformed JSON — fall through to the legacy plain-label path.
    }
  }

  // 2. Legacy fallback — plain-label reply (models that ignore the JSON prompt).
  const label = trimmed.toLowerCase();
  const intent = MODEL_VALID_INTENTS.find((v) => label === v);
  if (intent) {
    return {
      intent,
      reason: `model classified: ${label}`,
      confidence: MODEL_CONFIDENCE_DEFAULT,
    };
  }
  return {
    intent: "ambiguous",
    reason: `model returned unrecognized label: ${label}`,
    confidence: MODEL_CONFIDENCE_DEFAULT,
  };
}

export async function modelClassifyAction(
  input: string,
  provider: ModelAdapter,
): Promise<ActionClassification> {
  try {
    const response = await provider.complete({
      systemPrompt:
        "You are a prompt router. Given a user request, classify it as exactly " +
        "one of these labels:\n\n" +
        MODEL_VALID_INTENTS.join("\n") +
        "\n\n" +
        'Reply with ONLY a JSON object: {"intent": "<label>", "confidence": <0-1>}. ' +
        "No explanation. No markdown. No prose.",
      messages: [{ role: "user", content: input }],
      maxOutputTokens: 128,
      // T22 (#400): deterministic classification — the same prompt must
      // classify identically across calls. temperature:0 removes sampling
      // variance so Layer-1-uncertain prompts near a decision boundary are
      // stable. Provider defaults (non-deterministic) previously made the
      // model fallback vary run-to-run.
      temperature: 0,
    });
    const parsed = parseModelClassification(response.text ?? "");
    return {
      intent: parsed.intent,
      reason: parsed.reason,
      confidence: parsed.confidence,
    };
  } catch {
    return { intent: "ambiguous", reason: "model classifier unavailable" };
  }
}
