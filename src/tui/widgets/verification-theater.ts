import { cyan, green, red, yellow, dim, bold } from "../ansi.js";

export type CheckStatus = "queued" | "running" | "passed" | "failed";

export interface CheckState {
  id: string;
  name: string;
  command: string;
  status: CheckStatus;
  progress: number;
}

export class VerificationTheaterWidget {
  private checks: Map<string, CheckState> = new Map();
  private residualRisk = 0;
  private uncoveredFiles: string[] = [];

  addCheck(check: { id: string; name: string; command: string; status: CheckStatus }): void {
    this.checks.set(check.id, { ...check, progress: 0 });
  }

  updateProgress(id: string, progress: number): void {
    const check = this.checks.get(id);
    if (check) {
      check.progress = Math.max(0, Math.min(100, progress));
    }
  }

  setStatus(id: string, status: CheckStatus): void {
    const check = this.checks.get(id);
    if (check) {
      check.status = status;
      if (status === "passed" || status === "failed") {
        check.progress = 100;
      }
    }
  }

  getProgress(id: string): number {
    return this.checks.get(id)?.progress ?? 0;
  }

  setResidualRisk(percentage: number, uncoveredFiles: string[] = []): void {
    this.residualRisk = percentage;
    this.uncoveredFiles = uncoveredFiles;
  }

  private renderCheck(check: CheckState): string {
    const statusIcon = check.status === "passed" ? green("✓")
                     : check.status === "failed" ? red("✗")
                     : check.status === "running" ? yellow("◌")
                     : dim("○");

    const statusLabel = check.status === "passed" ? green("PASS")
                       : check.status === "failed" ? red("FAIL")
                       : check.status === "running" ? yellow("RUNNING")
                       : dim("QUEUED");

    // Progress bar
    const filled = Math.round((check.progress / 100) * 20);
    const bar = check.status === "running"
      ? yellow("█".repeat(filled) + "░".repeat(20 - filled))
      : check.status === "passed"
        ? green("█".repeat(20))
        : check.status === "failed"
          ? red("█".repeat(20))
          : dim("░".repeat(20));

    return `${statusIcon} ${check.name.padEnd(15)} [${bar}] ${statusLabel}`;
  }

  render(): string {
    const lines: string[] = [];

    // Header
    lines.push(bold("VERIFICATION") + " " + "─".repeat(40));

    if (this.checks.size === 0) {
      lines.push(dim("  No verification checks"));
    } else {
      for (const check of this.checks.values()) {
        lines.push(" " + this.renderCheck(check));
      }
    }

    // Residual risk
    if (this.residualRisk > 0 || this.uncoveredFiles.length > 0) {
      lines.push("");
      const riskBar = "■".repeat(Math.round(this.residualRisk / 10)) + "□".repeat(10 - Math.round(this.residualRisk / 10));
      const riskColor = this.residualRisk >= 75 ? red
                       : this.residualRisk >= 50 ? yellow
                       : green;
      lines.push(`${bold("RESIDUAL RISK:")} [${riskColor(riskBar)}] ${this.residualRisk}% verified`);

      for (const file of this.uncoveredFiles) {
        lines.push(` ${yellow("⚠")} ${dim(file)} not tested`);
      }
    }

    return lines.join("\n");
  }
}