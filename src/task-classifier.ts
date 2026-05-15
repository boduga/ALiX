export type TaskType = "bugfix" | "feature" | "refactor" | "docs" | "unknown";

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

export function classifyTask(prompt: string): TaskType {
  if (BUGFIX_PATTERNS.some((p) => p.test(prompt))) return "bugfix";
  if (FEATURE_PATTERNS.some((p) => p.test(prompt))) return "feature";
  if (REFACTOR_PATTERNS.some((p) => p.test(prompt))) return "refactor";
  if (DOCS_PATTERNS.some((p) => p.test(prompt))) return "docs";
  return "unknown";
}