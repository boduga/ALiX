import { cyan, green, red, yellow, bold } from "../ansi.js";

export class BudgetBarWidget {
  private tokensUsed = 0;
  private tokensMax = 62000;
  private files = 0;
  private searches = 0;

  setTokens(used: number, max: number): void {
    this.tokensUsed = used;
    this.tokensMax = max;
  }

  setFiles(count: number): void {
    this.files = count;
  }

  setSearches(count: number): void {
    this.searches = count;
  }

  private getPercentage(): number {
    return Math.round((this.tokensUsed / this.tokensMax) * 100);
  }

  private renderBar(percentage: number, width: number = 10): string {
    const filled = Math.round((percentage / 100) * width);
    const empty = width - filled;

    let colorFn: (text: string) => string = green;
    if (percentage >= 90) colorFn = red;
    else if (percentage >= 75) colorFn = yellow;
    else if (percentage >= 50) colorFn = cyan;

    return colorFn("█".repeat(filled)) + "░".repeat(empty);
  }

  render(): string {
    const percentage = this.getPercentage();
    const bar = this.renderBar(percentage);

    // Format tokens as K or number
    const tokensStr = this.tokensUsed >= 1000
      ? `${Math.round(this.tokensUsed / 1000)}K`
      : String(this.tokensUsed);
    const maxStr = this.tokensMax >= 1000
      ? `${Math.round(this.tokensMax / 1000)}K`
      : String(this.tokensMax);

    const parts = [
      `${bold("TOKENS:")} ${bar} ${percentage}% (${tokensStr}/${maxStr})`,
      `${bold("Files:")} ${this.files}`,
      `${bold("S:")} ${this.searches}`,
    ];

    return parts.join(" │ ");
  }
}
