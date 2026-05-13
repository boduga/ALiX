export type EditFormat = "structured_patch" | "unified_diff" | "search_replace" | "full_file";

export type EditFormatPolicy = {
  provider: string;
  preferred: EditFormat;
  allowed: EditFormat[];
  fullFileRewrite: "deny" | "ask" | "allow_for_new_or_generated";
};

export function defaultEditFormatForProvider(provider: string): EditFormat {
  if (["google", "local", "ollama", "minimax", "zhipuai", "grokai"].includes(provider)) {
    return "search_replace";
  }
  return "structured_patch";
}
