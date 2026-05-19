export type RewriteContext = {
  path: string;
  isNewFile: boolean;
  sizeBytes: number;
  isGenerated: boolean;
  hasApproval?: boolean;
};

export type RewriteDecision = {
  allowed: boolean;
  reason?: string;
  requiredApproval?: boolean;
};

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];

const GENERATED_PATTERNS = ['dist/', 'build/', '_generated.', '.min.js', '.min.css'];

export class FullFileRewriteGuard {
  private largeFileThreshold: number;

  constructor(options?: { largeFileThreshold?: number }) {
    this.largeFileThreshold = options?.largeFileThreshold ?? 5000;
  }

  private isSourceFile(path: string): boolean {
    return SOURCE_EXTENSIONS.some((ext) => path.endsWith(ext));
  }

  private isGeneratedFile(path: string): boolean {
    return GENERATED_PATTERNS.some((pattern) => path.includes(pattern));
  }

  async evaluate(ctx: RewriteContext): Promise<RewriteDecision> {
    // Allow new files regardless of type
    if (ctx.isNewFile) {
      return { allowed: true };
    }

    // Check if it's a source file
    if (this.isSourceFile(ctx.path)) {
      // Source files need approval for any rewrite
      if (!ctx.hasApproval) {
        return {
          allowed: false,
          reason: 'Existing source files require approval for full-file rewrite',
          requiredApproval: true,
        };
      }
      return { allowed: true };
    }

    // Check if it's a generated file
    if (this.isGeneratedFile(ctx.path)) {
      if (!ctx.hasApproval) {
        return {
          allowed: false,
          reason: 'Generated files require approval for full-file rewrite',
          requiredApproval: true,
        };
      }
      return { allowed: true };
    }

    // For non-source, non-generated files: check size
    if (ctx.sizeBytes > this.largeFileThreshold && !ctx.hasApproval) {
      return {
        allowed: false,
        reason: `File exceeds size threshold (${this.largeFileThreshold} bytes) and requires approval`,
        requiredApproval: true,
      };
    }

    return { allowed: true };
  }
}