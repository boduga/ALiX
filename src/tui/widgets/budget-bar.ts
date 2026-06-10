import { cyan, green, red, yellow, bold } from "../ansi.js";
import { LAYOUT } from "../layout.js";

export class BudgetBarWidget {
  private used = 0;
  private max = 62000;
  private files = 0;
  private searches = 0;

  setTokens(used: number, max: number): void {
    this.used = used;
    this.max = max;
  }

  setFiles(count: number): void {
    this.files = count;
  }

  setSearches(count: number): void {
    this.searches = count;
  }

  private getPercentage(): number {
    return Math.round((this.used / this.max) * 100);
  }

  private getColor(): string {
    const ratio = this.max > 0 ? this.used / this.max : 0;
    if (ratio >= LAYOUT.budgetThreshold.danger) return LAYOUT.budgetColor.danger;
    if (ratio >= LAYOUT.budgetThreshold.warn) return LAYOUT.budgetColor.warn;
    return LAYOUT.budgetColor.safe;
  }

  private renderBar(ratio: number, width: number = 20): string {
    const filled = Math.round(Math.min(1, ratio) * width);
    const empty = width - filled;
    const color = this.getColor();
    if (filled === 0) return `\x1b[2m${"░".repeat(width)}\x1b[22m`;
    return `\x1b[${color}m${"█".repeat(filled)}${"░".repeat(empty)}\x1b[0m`;
  }

  render(): string {
    const ratio = this.max > 0 ? this.used / this.max : 0;
    const percentage = this.getPercentage();
    const bar = this.renderBar(ratio);

    // Format tokens as K or number
    const tokensStr = this.used >= 1000
      ? `${Math.round(this.used / 1000)}K`
      : String(this.used);
    const maxStr = this.max >= 1000
      ? `${Math.round(this.max / 1000)}K`
      : String(this.max);

    const parts = [
      `${bold("TOKENS:")} ${bar} ${percentage}% (${tokensStr}/${maxStr})`,
      `${bold("Files:")} ${this.files}`,
      `${bold("S:")} ${this.searches}`,
    ];

    return parts.join(" │ ");
  }
}
