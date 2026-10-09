export type EditFormat = "structured_patch" | "unified_diff" | "search_replace" | "full_file";

export type ExecutableFormat = Extract<EditFormat, "structured_patch" | "search_replace" | "unified_diff">;

export type EditFormatPolicy = {
  provider: string;
  preferred: EditFormat;
  allowed: EditFormat[];
  fullFileRewrite: "deny" | "ask" | "allow_for_new_or_generated";
};

export type EditFormatPolicyInput = {
  provider: string;
  preferred?: EditFormat;
};

const EXECUTABLE_PATCH_FORMATS: ExecutableFormat[] = [
  "structured_patch",
  "search_replace",
  "unified_diff",
];

export function defaultEditFormatForProvider(provider: string): EditFormat {
  if (["google", "local", "ollama", "minimax", "zhipuai", "grokai"].includes(provider)) {
    return "search_replace";
  }
  return "structured_patch";
}

export function buildEditFormatPolicy(input: EditFormatPolicyInput): EditFormatPolicy {
  const defaultFormat = defaultEditFormatForProvider(input.provider);
  const requested = input.preferred ?? defaultFormat;
  const preferred = normalizePreferredFormat(input.provider, requested);
  const alternate = preferred === "search_replace" ? "structured_patch" : "search_replace";

  return {
    provider: input.provider,
    preferred,
    allowed: Array.from(new Set([preferred, alternate, ...EXECUTABLE_PATCH_FORMATS])),
    fullFileRewrite: "deny",
  };
}

function normalizePreferredFormat(provider: string, preferred: EditFormat): ExecutableFormat {
  if (provider === "google") return "search_replace";
  if (preferred === "full_file") return "search_replace";
  if (EXECUTABLE_PATCH_FORMATS.includes(preferred as ExecutableFormat)) {
    return preferred as ExecutableFormat;
  }
  const fallback = defaultEditFormatForProvider(provider);
  return fallback === "search_replace" ? "search_replace" : "structured_patch";
}
