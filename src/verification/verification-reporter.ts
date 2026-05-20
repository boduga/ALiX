import type { RunResult } from "./command-runner.js";

export interface VerificationResult {
  name: string;
  result: RunResult;
  timestamp?: number;
  metadata?: Record<string, unknown>;
}

export interface VerificationSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
  passRate: number;
}

export interface TestAnalysis {
  testCount?: number;
  passed?: number;
  failed?: number;
  duration?: string;
  framework?: string;
}

export class VerificationReporter {
  private results: VerificationResult[] = [];

  addResult(result: VerificationResult): void {
    this.results.push({
      ...result,
      timestamp: result.timestamp ?? Date.now(),
    });
  }

  getResults(): VerificationResult[] {
    return [...this.results];
  }

  getSummary(): VerificationSummary {
    const passed = this.results.filter(r => r.result.success).length;
    const failed = this.results.filter(r => !r.result.success).length;
    const skipped = this.results.filter(r => r.result.error === "skipped").length;
    const totalDurationMs = this.results.reduce((sum, r) => sum + r.result.durationMs, 0);

    return {
      total: this.results.length,
      passed,
      failed,
      skipped,
      totalDurationMs,
      passRate: this.results.length > 0 ? passed / this.results.length : 0,
    };
  }

  analyzeOutput(testName: string): TestAnalysis {
    const result = this.results.find(r => r.name === testName);
    if (!result) return {};

    const analysis: TestAnalysis = {};
    const stdout = result.result.stdout;

    const jestMatch = stdout.match(/Tests:?\s+(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (jestMatch) {
      analysis.testCount = parseInt(jestMatch[1]) + parseInt(jestMatch[2]);
      analysis.passed = parseInt(jestMatch[1]);
      analysis.failed = parseInt(jestMatch[2]);
      analysis.framework = "jest";
    }

    const pytestMatch = stdout.match(/(\d+)\s+passed.*?(\d+)\s+failed/i);
    if (pytestMatch && !analysis.testCount) {
      analysis.testCount = parseInt(pytestMatch[1]) + parseInt(pytestMatch[2]);
      analysis.passed = parseInt(pytestMatch[1]);
      analysis.failed = parseInt(pytestMatch[2]);
      analysis.framework = "pytest";
    }

    const mochaMatch = stdout.match(/(\d+)\s+passing/i);
    if (mochaMatch) {
      analysis.testCount = parseInt(mochaMatch[1]);
      analysis.passed = parseInt(mochaMatch[1]);
      analysis.framework = "mocha";
    }

    const durationMatch = stdout.match(/(\d+)m\s+(\d+)s/);
    if (durationMatch) {
      analysis.duration = `${durationMatch[1]}m ${durationMatch[2]}s`;
    }

    return analysis;
  }

  generateMarkdownReport(options: { verbose?: boolean; includeOutput?: boolean } = {}): string {
    const summary = this.getSummary();
    const lines: string[] = [];

    lines.push("## Verification Results\n");
    lines.push(`**Total:** ${summary.total} | **Passed:** ${summary.passed} | **Failed:** ${summary.failed} | **Pass Rate:** ${(summary.passRate * 100).toFixed(1)}%\n`);
    lines.push(`**Duration:** ${(summary.totalDurationMs / 1000).toFixed(2)}s\n`);

    if (summary.failed > 0) {
      lines.push("\n### Failed Tests\n");

      for (const result of this.results.filter(r => !r.result.success)) {
        lines.push(`- ❌ **${result.name}**`);
        if (result.result.stderr) {
          lines.push(`  \`\`\`\n${result.result.stderr.slice(0, 500)}\n  \`\`\``);
        }
      }
    }

    if (options.verbose) {
      lines.push("\n### All Tests\n");

      for (const result of this.results) {
        const status = result.result.success ? "✅" : "❌";
        lines.push(`- ${status} **${result.name}** (${result.result.durationMs}ms)`);

        if (options.includeOutput && result.result.stderr) {
          lines.push(`  \`\`\`\n${result.result.stderr.slice(0, 200)}...\n  \`\`\``);
        }
      }
    }

    return lines.join("\n");
  }

  generateJsonReport(): string {
    return JSON.stringify({
      summary: this.getSummary(),
      results: this.results,
      generatedAt: new Date().toISOString(),
    }, null, 2);
  }

  clear(): void {
    this.results = [];
  }
}