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