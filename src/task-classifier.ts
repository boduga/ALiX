export type TaskType = "bugfix" | "feature" | "refactor" | "docs" | "research" | "unknown";

const BUGFIX_PATTERNS = [
  /\bfix\b/i, /\bbug\b/i, /\bcrash\b/i, /\berror\b/i,
  /\bexception\b/i, /\bnull\b/i, /\bundefined\b/i, /\bfails?\b/i,
  /\bbroken\b/i, /\bnot working\b/i
];

const FEATURE_PATTERNS = [
  /\badd\b/i, /\bimplement\b/i, /\bcreate\b/i, /\bnew\s+(?:feature|option|setting|button|tab|page|component|module)\b/i,
  /\bintroduce\b/i, /\benable\b/i, /\bsupport\b/i, /\bbuild\b/i
];

const REFACTOR_PATTERNS = [
  /\brefactor\b/i, /\brewrite\b/i, /\bextract\b/i,
  /\bclean up\b/i, /\brestructure\b/i, /\bsplit\b/i,
  /\bdecouple\b/i, /\bmove\b/i, /\breorganize\b/i
];

const DOCS_PATTERNS = [
  /\bdoc\b/i, /\breadme\b/i, /\bcomment\b/i, /\bupdate\b/i,
  /\bwrite\b/i, /\bdescribe\b/i, /\bexplain\b/i
];

const RESEARCH_PATTERNS = [
  /\bresearch\b/i,
  /\bstudy\b/i,
  /\binvestigate\b/i,
  /\banalyze\b/i,
  /\bfind all\b/i,
  /\bsearch for\b/i,
  /\blook up\b/i,
  /\blook into\b/i,
  /\bcompare\b/i,
  /\bevaluate\b/i,
  /\bassess\b/i,
  /\breview\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bexplain\b/i,
  /\bunderstand\b/i,
  /\bbest practices\b/i,
  /\brecommended\b/i,
  /\bguidelines\b/i,
];

const DEEP_RESEARCH_SIGNALS = [
  /\bdeep\s+research\b/i,
  /\b(analyze|compare|evaluate|assess)\b/i,
  /\b(comprehensive|thorough|detailed)\b/i,
  /\barchitecture\b/i,
  /\bstrategy\b/i,
  /\bpatterns?\b/i,
];

export function detectResearchDepth(prompt: string): "quick" | "deep" {
  return DEEP_RESEARCH_SIGNALS.some((r) => r.test(prompt)) ? "deep" : "quick";
}

export type ResearchDepth = "quick" | "deep";
export type ClassifiedTask = { type: TaskType; depth: ResearchDepth; confidence: "high" | "medium" | "low" };

export function classifyTask(prompt: string): TaskType {
  if (BUGFIX_PATTERNS.some((p) => p.test(prompt))) return "bugfix";
  if (FEATURE_PATTERNS.some((p) => p.test(prompt))) return "feature";
  if (REFACTOR_PATTERNS.some((p) => p.test(prompt))) return "refactor";
  if (DOCS_PATTERNS.some((p) => p.test(prompt))) return "docs";
  if (RESEARCH_PATTERNS.some((p) => p.test(prompt))) return "research";
  return "unknown";
}

const SHELL_PATTERNS = [
  // Read-only shell commands — both bare and with args
  /^ls(?:\s|$)/i,
  /^pwd(?:\s|$)/i,
  /^cat(?:\s|$)/i,
  /^grep(?:\s|$)/i,
  /^find(?:\s|$)/i,
  /^head(?:\s|$)/i,
  /^tail(?:\s|$)/i,
  /^wc(?:\s|$)/i,
  /^sort(?:\s|$)/i,
  /^uniq(?:\s|$)/i,
  /^stat(?:\s|$)/i,
  /^du(?:\s|$)/i,
  /^df(?:\s|$)/i,
  /^whoami(?:\s|$)/i,
  /^env(?:\s|$)/i,
  /^echo(?:\s|$)/i,
  /^printf(?:\s|$)/i,
  /^type(?:\s|$)/i,
  /^curl(?:\s|$)/i,
  /^ping(?:\s|$)/i,
];

const READ_ONLY_PATTERNS = [
  /\b(?:read|view|show|display|list|get|fetch)\b/i,
  /\bwho\b/i,
  /\b(?:research|study|investigate|analyze)\b/i,
  /\bfind all\b/i,
  /\bsearch for\b/i,
  /\blook up\b/i,
  /\blook into\b/i,
  /\bcompare\b/i,
  /\bevaluate\b/i,
  /\bassess\b/i,
  /\bwhat is\b/i,
  /\bhow does\b/i,
  /\bexplain\b/i,
  /\bunderstand\b/i,
  /\breview\b/i,
  /\bdoc\b/i,
  /\bREADME\b/i,
  /\bcomment\b/i,
  /\bdescribe\b/i,
];


/**
 * Plain-English tokens after the command word that mark the prompt as an
 * instruction rather than a command invocation. Argument tokens (flags,
 * paths, globs, numbers) never count — only bare words do.
 */
const PROSE_TOKEN_THRESHOLD = 3;

/**
 * True when a prompt that opens with a command word continues in natural
 * language instead of command arguments.
 *
 * `SHELL_PATTERNS` is anchored to bare command words, so unguarded it also
 * matches English imperatives that merely begin with one: "Find every file
 * under src/ …" matches `^find`, which forced the prompt onto `shell.run`
 * and capped it at 2 iterations instead of running as a normal task.
 *
 * Argument tokens are rejected by the plain-word shape below: flags (`-la`),
 * paths (`src/`, `package.json`), numbers, globs and quoted strings all fail
 * it, so `cat package.json`, `find . -name '*.ts'` and `grep foo src/` keep
 * their argument tails. Three or more consecutive plain words is prose.
 *
 * Deliberately shape-based, not word-list based: an English-word allow/deny
 * list would need perpetual maintenance and would reject real commands such
 * as `cat the file`.
 */
export function hasNaturalLanguageTail(prompt: string): boolean {
  const tokens = prompt.trim().split(/\s+/).slice(1);
  let plain = 0;
  for (const token of tokens) {
    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(token)) {
      plain += 1;
      if (plain >= PROSE_TOKEN_THRESHOLD) return true;
    } else {
      plain = 0;
    }
  }
  return false;
}

/**
 * Returns true if the prompt is a bare shell command (ls, cat, pwd, etc.).
 * These are executed in read-only mode — no write tools.
 */
export function isShellTask(prompt: string): boolean {
  const stripped = prompt.replace(/^['"]|['"]$/g, "");
  return (
    SHELL_PATTERNS.some((p) => p.test(stripped)) &&
    !hasNaturalLanguageTail(stripped)
  );
}

/**
 * Returns true if the task prompt describes a read-only operation
 * (research, question, docs review) that doesn't need a plan prompt.
 */
/**
 * True when the prompt is an inline claim/evidence verification ask
 * ("Claim: ... Evidence: ...", "verify the claim ...", claim + evidence:
 * section in either order) — a judgment request that never needs a
 * file-modification plan.
 *
 * Deliberately NOT folded into `isReadOnlyTask`: that predicate also gates
 * tool filtering and the read-only mode prompt (agent-loop readOnly), and
 * those must not swallow the `verify.claim` capability or forbid legitimate
 * follow-up edits. This predicate only exempts plan generation.
 */
const CLAIM_VERIFICATION_PATTERNS = [
  /^\s*\bclaim:/i,
  /\bverify (?:the |this |a |an |my |given |provided |supplied )*claim\b/i,
  /\bclaim[- ]verif(?:ication|y|ied)\b/i,
  /\bdoes (?:this|the|these|that|given) evidence\b/i,
  // Judgment asks that paste an explicit `evidence:` section TOGETHER with
  // claim language (either order; both required). A bare `evidence:` must
  // never skip plan generation — "Fix the crash. Evidence: see stack trace"
  // is a write task and keeps its plan gate. Also: no \b after `:`, which
  // cannot match before whitespace by boundary rules.
  /(?=[\s\S]*\bclaim\b)[\s\S]*\bevidenc(?:e|es)\s*:/i,
];

export function isClaimVerificationTask(prompt: string): boolean {
  const stripped = prompt.replace(/^['"]|['"]$/g, "");
  return CLAIM_VERIFICATION_PATTERNS.some((p) => p.test(stripped));
}

export function isReadOnlyTask(prompt: string): boolean {
  // Strip surrounding quotes so 'ls' and "ls" match patterns
  const stripped = prompt.replace(/^['"]|['"]$/g, "");
  const hasReadSignal = READ_ONLY_PATTERNS.some((p) => p.test(stripped));

  if (hasReadSignal) return true;

  // Docs/research tasks are always read-only regardless of write signals
  // ("write a short story" is a docs task, not a code change)
  const type = classifyTask(prompt);
  if (type === "research" || type === "docs") return true;

  return false;
}
