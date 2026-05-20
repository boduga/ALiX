export type SecretType =
  | "api_key"
  | "aws_key"
  | "aws_secret"
  | "private_key"
  | "password"
  | "token"
  | "secret"
  | "bearer_token"
  | "basic_auth";

export interface SecretFinding {
  type: SecretType;
  line: number;
  column: number;
  context: string;
  value: string;
  confidence: "high" | "medium" | "low";
  rule: string;
}

export interface SecretScannerOptions {
  minConfidence?: "high" | "medium" | "low";
  customPatterns?: { type: SecretType; pattern: RegExp; rule: string }[];
  excludePaths?: string[];
}

export class SecretScanner {
  private patterns: { type: SecretType; pattern: RegExp; rule: string }[];

  constructor(options: SecretScannerOptions = {}) {
    this.patterns = [
      { type: "api_key", pattern: /sk-[a-zA-Z0-9]{16,}/g, rule: "OpenAI API key" },
      { type: "api_key", pattern: /AIza[a-zA-Z0-9_-]{35}/g, rule: "Google API key" },
      { type: "aws_key", pattern: /AKIA[0-9A-Z]{16}/g, rule: "AWS Access Key ID" },
      { type: "aws_secret", pattern: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/gi, rule: "AWS Secret" },
      { type: "private_key", pattern: /-----BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY-----/g, rule: "Private key" },
      { type: "password", pattern: /(?:password|passwd|pwd)\s*[=:]\s*['"][^'"]+['"]/gi, rule: "Password assignment" },
      { type: "token", pattern: /ghp_[a-zA-Z0-9]{36}/g, rule: "GitHub Personal Access Token" },
      { type: "token", pattern: /xox[baprs]-[0-9a-zA-Z]{10,}/g, rule: "Slack Token" },
      { type: "bearer_token", pattern: /bearer\s+[a-zA-Z0-9_-]{20,}/gi, rule: "Bearer token" },
      { type: "basic_auth", pattern: /authorization\s*:\s*basic\s+[A-Za-z0-9+/=]{20,}/gi, rule: "Basic auth" },
      { type: "secret", pattern: /(?:secret|api_secret)\s*[=:]\s*['"][A-Za-z0-9_=-]{20,}/gi, rule: "Generic secret" },
      ...(options.customPatterns ?? []),
    ];
  }

  scan(content: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = content.split("\n");

    for (let lineNum = 0; lineNum < lines.length; lineNum++) {
      const line = lines[lineNum];

      for (const { type, pattern, rule } of this.patterns) {
        pattern.lastIndex = 0;
        let match;

        while ((match = pattern.exec(line)) !== null) {
          findings.push({
            type,
            line: lineNum + 1,
            column: match.index + 1,
            context: line.trim(),
            value: this.sanitize(match[0]),
            confidence: this.getConfidence(type, match[0]),
            rule,
          });
        }
      }
    }

    return findings;
  }

  scanOne(content: string): SecretFinding | null {
    return this.scan(content)[0] ?? null;
  }

  private sanitize(value: string): string {
    if (value.length <= 4) return "*".repeat(value.length);
    return value.slice(0, 4) + "*".repeat(value.length - 4);
  }

  private getConfidence(type: SecretType, value: string): "high" | "medium" | "low" {
    if (type === "private_key") return "high";
    if (type === "aws_key" || type === "api_key") return "high";
    if (value.includes("example") || value.includes("test")) return "low";
    return "medium";
  }
}