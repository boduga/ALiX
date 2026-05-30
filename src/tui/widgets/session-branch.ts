import { cyan, green, yellow, bold, dim } from "../ansi.js";

export interface Branch {
  name: string;
  isHead: boolean;
}

export class SessionBranchWidget {
  private branches: Branch[] = [];
  private current: string;

  constructor(currentBranch: string) {
    this.current = currentBranch;
    this.branches.push({ name: currentBranch, isHead: true });
  }

  addBranch(name: string, isHead = false): void {
    this.branches.push({ name, isHead });
  }

  setCurrent(name: string): void {
    this.current = name;
    this.branches = this.branches.map(b => ({
      ...b,
      isHead: b.name === name,
    }));
  }

  render(): string {
    const lines: string[] = [];

    // Branch visualization
    const branchNames = this.branches.map(b => {
      const marker = b.isHead ? cyan("(HEAD)") : "";
      return b.name + (marker ? ` ${marker}` : "");
    });

    // Git-style branch line
    let branchLine = `${bold("SESSION:")} ${branchNames[0]}`;
    if (branchNames.length > 1) {
      branchLine += " ─┬─" + branchNames.slice(1).join(" ─ ");
    }
    lines.push(branchLine);

    // Switch options
    const switchOptions = this.branches.map((b, i) => {
      const num = `[${i + 1}] ${b.name}`;
      return b.isHead ? cyan(num) : dim(num);
    });
    lines.push("");
    lines.push(`${dim("Switch:")} ${switchOptions.join(" ")}`);

    return lines.join("\n");
  }
}