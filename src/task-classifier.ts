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

const READ_ONLY_PATTERNS = [
  /\b(?:read|view|show|display|list|get|fetch)\b/i,
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
  /^who(?:\s|$)/i,
  /^type(?:\s|$)/i,
  /^curl(?:\s|$)/i,
  /^ping(?:\s|$)/i,
  // Note: 'which' intentionally omitted — too common as natural language
  // ("which model are you using?"). Users can prefix with "run" for shell.
];

const WRITE_PATTERNS = [
  /\b(?:create|add|implement|build|write|edit|update|modify|change|delete|remove|fix|refactor|rewrite|extract)\b/i,
  /\bnew\s+(?:feature|option|setting|button|tab|page|component|module)\b/i,
  /\bclean up\b/i,
  /\brestructure\b/i,
  /\bsplit\b/i,
  /\bdecouple\b/i,
  /\bmove\b/i,
  /\breorganize\b/i,
  /\bbug\b/i,
  /\bcrash\b/i,
  /\berror\b/i,
  /\bexception\b/i,
  /\bnull\b/i,
  /\bundefined\b/i,
  /\bfails?\b/i,
  /\bbroken\b/i,
  /\bnot working\b/i,
];

/**
 * Returns true if the task prompt describes a read-only operation
 * (research, question, docs review) that doesn't need a plan prompt.
 */
export function isReadOnlyTask(prompt: string): boolean {
  // Strip surrounding quotes so 'ls' and "ls" match shell command patterns
  const stripped = prompt.replace(/^['"]|['"]$/g, "");
  const hasReadSignal = READ_ONLY_PATTERNS.some((p) => p.test(stripped));
  const hasWriteSignal = WRITE_PATTERNS.some((p) => p.test(prompt));

  if (hasReadSignal && !hasWriteSignal) return true;
  if (hasWriteSignal && !hasReadSignal) return false;

  // Ambiguous — fall back to classifier-based heuristic
  const type = classifyTask(prompt);
  return type === "research" || type === "docs";
}
