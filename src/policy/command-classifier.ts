export type CommandRisk = "low" | "medium" | "high" | "critical";

export type CommandClassification = {
  original: string;
  risk: CommandRisk;
  safe: boolean;
  category: string;
  tags: string[];
  paths: string[];
  networkDestination?: string;
  hasChain: boolean;
  environment?: string[];
};

type RiskRule = {
  pattern: RegExp;
  risk: CommandRisk;
  category: string;
  tags: string[];
  extractNetwork?: boolean;
  hasChain?: boolean;
};

export class CommandClassifier {
  private rules: RiskRule[] = [
    // CRITICAL: Inline code execution (-e, -c, -r flags with dangerous content)
    { pattern: /^(python|python3|py)\s+(-c|-m\s+exec)\s+['"].*rm\s/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^node\s+-e\s+['"].*rm\s/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^node\s+--eval\s+['"].*rm\s/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^perl\s+-e\s+['"].*rm|unlink/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^ruby\s+-e\s+['"].*rm\s+rf|FileUtils/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^php\s+-r\s+['"].*system\s*\(\s*['"]rm|exec|symlink/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^bun\s+-e\s+['"].*rm\s/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },
    { pattern: /^deno\s+run\s+-e\s+['"].*Deno\.(remove|removeSync)/s, risk: "critical", category: "inline-code", tags: ["inline-execution", "destructive"] },

    // CRITICAL: Pipe to shell execution
    { pattern: /\|\s*sh(\s|$)/, risk: "critical", category: "pipe-shell", tags: ["shell-execution", "destructive"] },
    { pattern: /\|\s*bash(\s|$)/, risk: "critical", category: "pipe-shell", tags: ["shell-execution", "destructive"] },
    { pattern: /curl\s+https?:\/\/[^\s]+\s*\|\s*(sh|bash|python)/s, risk: "critical", category: "curl-pipe", tags: ["download-exec", "destructive"] },
    { pattern: /wget\s+https?:\/\/[^\s]+\s*(-O-|-o-)\s*\|\s*(sh|bash)/s, risk: "critical", category: "curl-pipe", tags: ["download-exec", "destructive"] },

    // CRITICAL: rm -rf with any variant
    { pattern: /rm\s+-rf\s+(\/|--force)/, risk: "critical", category: "destroy", tags: ["destructive", "recursive-delete"] },
    { pattern: /rm\s+-\s*[rf]+\s+(\/|--force)/, risk: "critical", category: "destroy", tags: ["destructive", "recursive-delete"] },
    { pattern: /rm\s+--recursive\s+--force/, risk: "critical", category: "destroy", tags: ["destructive", "recursive-delete"] },

    // CRITICAL: Find-based destruction
    { pattern: /find\s+.*-delete(\s|$)/, risk: "critical", category: "find-destroy", tags: ["destructive", "find"] },
    { pattern: /find\s+.*-exec\s+rm\s/s, risk: "critical", category: "find-destroy", tags: ["destructive", "find"] },
    { pattern: /find\s+\/\s+.*rm\s/s, risk: "critical", category: "find-destroy", tags: ["destructive", "find"] },
    { pattern: /find\s+.*-name.*-exec\s+rm/s, risk: "critical", category: "find-destroy", tags: ["destructive", "find"] },

    // CRITICAL: Command substitution with rm
    { pattern: /rm\s+-rf\s+\$\([^)]+\)/, risk: "critical", category: "command-sub", tags: ["destructive", "command-sub"] },
    { pattern: /rm\s+-rf\s+`[^`]+`/, risk: "critical", category: "command-sub", tags: ["destructive", "command-sub"] },

    // CRITICAL: Shell chaining with destructive commands
    { pattern: /&&.*rm\s+-rf/s, risk: "critical", category: "chain-destroy", tags: ["destructive", "chaining"] },
    { pattern: /;.*rm\s+-rf/s, risk: "critical", category: "chain-destroy", tags: ["destructive", "chaining"] },
    { pattern: /\|\|.*rm\s+-rf/s, risk: "critical", category: "chain-destroy", tags: ["destructive", "chaining"] },

    // CRITICAL: Package manager script injection
    { pattern: /yarn\s+run\s+[a-z]+\s+--\s+['"].*rm|\||;/s, risk: "critical", category: "npm-exec", tags: ["destructive", "yarn"] },
    { pattern: /pnpm\s+run\s+[a-z]+\s+--\s+['"].*rm|\||;/s, risk: "critical", category: "npm-exec", tags: ["destructive", "pnpm"] },
    { pattern: /npm\s+exec\s+--\s+['"].*rm|sys/i, risk: "critical", category: "npm-exec", tags: ["destructive", "npm"] },

    // HIGH: DD overwrite attacks
    { pattern: /^dd\s+if=.*of=.*(important|prod|db|\.env)/s, risk: "high", category: "dd-overwrite", tags: ["destructive", "dd"] },
    { pattern: /^dd\s+if=\/dev\/zero/, risk: "high", category: "dd-overwrite", tags: ["destructive", "dd"] },

    // HIGH: Package.json write to delete
    { pattern: /echo\s+['"]\{.*scripts.*postinstall.*rm/i, risk: "high", category: "package-json", tags: ["destructive", "package"] },
    { pattern: /package\.json.*rm\s/s, risk: "high", category: "package-json", tags: ["destructive", "package"] },

    // HIGH: Files module exploitation
    { pattern: /require\s*\(\s*['"]fs['"].*\.(unlinkSync|rmSync|rmdirSync)/s, risk: "high", category: "files-module", tags: ["destructive", "node"] },
    { pattern: /require\s*\(\s*['"]fs['"].*\.\*(sync)?.*forEach/s, risk: "high", category: "files-module", tags: ["destructive", "node"] },

    // HIGH: Directory overwrite/truncate
    { pattern: /^:\s*>\s*\./, risk: "high", category: "truncate", tags: ["destructive", "bash"] },
    { pattern: /truncate\s+-s\s+0\s+\./, risk: "high", category: "truncate", tags: ["destructive"] },

    // HIGH: Destructive file operations
    { pattern: /^rm\s+-rf/, risk: "high", category: "destroy", tags: ["destructive", "file-modification"] },
    { pattern: /^mkfs|formatt/, risk: "high", category: "destroy", tags: ["destructive", "filesystem"] },

    // HIGH: System modification
    { pattern: /^sudo\s+(rm|chmod|chown|passwd|useradd)/, risk: "high", category: "system", tags: ["sudo", "system-modification"] },
    { pattern: /^\s*>\s*\/(etc|usr|var)/, risk: "high", category: "system", tags: ["redirect", "system-path"] },

    // Read-only commands (low risk)
    { pattern: /^(cat|head|tail|grep|rg|ls|stat|wc)\s/, risk: "low", category: "read", tags: ["read-only"] },
    { pattern: /^echo\s/, risk: "low", category: "echo", tags: ["read-only"] },
    { pattern: /^pwd/, risk: "low", category: "read", tags: ["read-only"] },

    // Git commands (medium risk)
    { pattern: /^git\s+(status|stash|log|show|diff|branch)/, risk: "medium", category: "git-read", tags: ["git", "read-only"] },
    { pattern: /^git\s+(add|commit|push|pull|fetch)/, risk: "medium", category: "git-mutate", tags: ["git", "mutation"] },

    // Package managers (medium risk)
    { pattern: /^(npm|yarn|pnpm|bun)\s+(install|add)/, risk: "medium", category: "dependency", tags: ["dependency"] },
    { pattern: /^(npm|yarn|pnpm)\s+(run|exec)/, risk: "medium", category: "script", tags: ["script"] },
    { pattern: /^(npm|yarn|pnpm)\s+remove|uninstall/, risk: "medium", category: "dependency-remove", tags: ["dependency", "mutation"] },

    // Network commands (detect network destination)
    { pattern: /^(curl|wget|http|python.*requests|fetch)\s+https?:\/\/([^/\s]+)/, risk: "medium", category: "network", tags: ["network"], extractNetwork: true },

    // Build/test (medium risk)
    { pattern: /^(npm|yarn|pnpm)\s+(test|build|lint|check|typecheck)/, risk: "medium", category: "build", tags: ["build"] },
    { pattern: /^(make|cmake|go|gradle|mvn|ant)\s+(build|test|compile)/, risk: "medium", category: "build", tags: ["build"] },

    // Shell operators indicate chaining
    { pattern: /(&&|\|\||;|\||\(|\`|\$\()/, risk: "low", category: "shell", tags: ["chaining"], hasChain: true },
  ];

  private urlPattern = /https?:\/\/([^/\s]+)/;

  classify(command: string): CommandClassification {
    const trimmed = command.trim();
    let risk: CommandRisk = "low";
    let category = "unknown";
    const tags: string[] = [];
    let networkDestination: string | undefined;
    let hasChain = false;
    const paths: string[] = [];
    const environment: string[] = [];

    // Check for environment variable assignments
    const envMatches = trimmed.match(/\b([A-Z_][A-Z0-9_]*)=/g);
    if (envMatches) {
      environment.push(...envMatches);
      tags.push("environment-set");
    }

    // Check for environment variable usage
    if (/\$[A-Z_][A-Z0-9_]*/.test(trimmed)) {
      tags.push("env-usage");
    }

    // Apply rules
    for (const rule of this.rules) {
      if (rule.pattern.test(trimmed)) {
        risk = rule.risk;
        category = rule.category;
        tags.push(...rule.tags);
        hasChain = rule.hasChain || /\s(&&|\|\||;)\s/.test(trimmed);
        if (rule.extractNetwork) {
          const match = trimmed.match(this.urlPattern);
          if (match) networkDestination = match[1];
        }
        break;
      }
    }

    // Extract file paths (heuristic: quoted strings and path patterns)
    const quotedMatches = trimmed.match(/'([^']+)'|"([^"]+)"/g) || [];
    for (const match of quotedMatches) {
      const path = match.slice(1, -1);
      if (path.includes("/") || path.includes(".")) {
        paths.push(path);
      }
    }

    // Extract path arguments (src/, lib/, ./, ../)
    const pathMatches = trimmed.match(/(?:^|\s)(?:(?:\.\.?|src|lib|tests?|dist|build|out|node_modules|\.git|\.env)[^\s]*)/g) || [];
    for (const match of pathMatches) {
      const path = match.trim();
      if (path && !paths.includes(path)) {
        paths.push(path);
      }
    }

    // Check for network destination in curl/wget
    const networkMatch = trimmed.match(/(?:curl|wget|fetch|http)\s+(?:--)?(?:url=)?'?https?:\/\/([^/'\s]+)/i);
    if (networkMatch) {
      networkDestination = networkMatch[1];
    }

    return {
      original: trimmed,
      risk,
      safe: risk === "low",
      category,
      tags,
      paths: [...new Set(paths)],
      networkDestination,
      hasChain,
      environment: environment.length > 0 ? environment : undefined,
    };
  }

  getRiskLevel(command: string): CommandRisk {
    return this.classify(command).risk;
  }

  getNetworkDestination(command: string): string | undefined {
    return this.classify(command).networkDestination;
  }
}

export function classifyCommand(command: string): CommandClassification {
  return new CommandClassifier().classify(command);
}