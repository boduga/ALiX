// Shared types for the tool-repair engine

/** A single deterministic repair pattern */
export type Pattern = {
  id: string;
  category: "null_in_optional_field" | "markdown_in_path" | "type_mismatch" | "missing_required_param" | "extra_junk_in_arg" | "wrong_arg_format";
  description: string;
  /** Tool names this pattern applies to. "*" = all tools */
  tools: string[];
  /** Per-parameter repairs */
  params: Record<string, ParamRepair>;
  /** Match conditions */
  match: MatchCondition;
  /** Hint sent back to the model explaining the repair */
  hint: string;
  severity: "error" | "warning" | "info";
  confidence: number; // 0-1, below threshold is not auto-applied
  since: string; // ISO date
  deprecated: string | null; // null = active, ISO date = deprecated
};

export type ParamRepair = {
  /** Named transform to apply */
  repair: TransformName;
  /** Static value to use (for "replace_with" transforms) */
  value?: unknown;
};

export type TransformName =
  | "remove"
  | "strip_markdown_links"
  | "parse_json_string_to_array"
  | "default_first_read"
  | "default_last_read"
  | "replace_with_value"
  | "strip_outer_quotes";

export type MatchCondition = {
  null_fields?: string[];
  missing_fields?: string[];
  expected_type?: string;
  actual_type?: string;
  pattern?: string;
};

/** Result of a single repair attempt */
export type RepairOutcome = {
  repaired: boolean;
  /** Repaired args (same as input if no repair) */
  args: Record<string, unknown>;
  /** Human-readable hint for the model */
  hint?: string;
  /** Which pattern was matched */
  patternId?: string;
};

/** A candidate pattern discovered by the miner */
export type PatternCandidate = {
  model: string;
  toolName: string;
  frequency: number;
  errorSignature: string;
  suggestedPattern: Partial<Pattern>;
  sampleArgs: Record<string, unknown>[];
  sampleErrors: string[];
};

/** A pattern file on disk */
export type PatternFile = {
  schema: number;
  model: string;
  patterns: Pattern[];
};
