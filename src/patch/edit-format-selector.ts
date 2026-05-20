export type EditFormat = "unified" | "context" | "unified_minimal" | "structured" | "search_replace";

export interface EditFormatSelectorOptions {
  fileType?: string;
  changeType?: "any" | "replace_lines" | "replace_function" | "replace_value" | "insert" | "delete";
  contextLines?: number;
  preferStructured?: boolean;
}

export interface FormatSelection {
  format: EditFormat;
  confidence: number;
  reasoning: string;
}

export class EditFormatSelector {
  private preferStructured: boolean;

  constructor(options: { preferStructured?: boolean } = {}) {
    this.preferStructured = options.preferStructured ?? false;
  }

  select(options: EditFormatSelectorOptions): EditFormat {
    const { fileType, changeType, contextLines = 3 } = options;

    if (this.preferStructured && this.canUseStructured(fileType, changeType)) {
      return "structured";
    }

    if (this.isStructuredLanguage(fileType) && changeType === "replace_function") {
      return "structured";
    }

    if (this.isDataFile(fileType)) {
      return "search_replace";
    }

    if (changeType === "replace_lines" && contextLines >= 3) {
      return "unified";
    }

    if (changeType === "delete" || changeType === "insert") {
      return "context";
    }

    return "unified";
  }

  selectWithConfidence(options: EditFormatSelectorOptions): FormatSelection {
    const format = this.select(options);

    let confidence = 0.8;
    let reasoning = "Default selection";

    if (this.isStructuredLanguage(options.fileType) && format === "structured") {
      confidence = 0.95;
      reasoning = "Language-aware parsing available for this file type";
    } else if (this.isDataFile(options.fileType) && format === "search_replace") {
      confidence = 0.9;
      reasoning = "Data file format benefits from pattern-based edits";
    }

    return { format, confidence, reasoning };
  }

  private canUseStructured(fileType: string | undefined, changeType: string | undefined): boolean {
    if (!fileType) return false;
    return ["ts", "tsx", "js", "jsx", "py", "go", "java"].includes(fileType);
  }

  private isStructuredLanguage(fileType: string | undefined): boolean {
    if (!fileType) return false;
    return ["ts", "tsx", "js", "jsx", "py", "go", "java", "cs", "rb"].includes(fileType);
  }

  private isDataFile(fileType: string | undefined): boolean {
    if (!fileType) return false;
    return ["json", "yaml", "yml", "toml", "xml", "env"].includes(fileType);
  }
}
