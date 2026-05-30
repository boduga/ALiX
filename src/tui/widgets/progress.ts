import { green, red, cyan, yellow, bold } from "../ansi.js";

export interface ProgressOptions {
  label?: string;
  width?: number;
  fillChar?: string;
  emptyChar?: string;
  status?: string;
}

export class ProgressWidget {
  private label: string;
  private width: number;
  private fillChar: string;
  private emptyChar: string;
  private progress = 0;
  private status?: string;

  constructor(options: ProgressOptions = {}) {
    this.label = options.label ?? "";
    this.width = options.width ?? 30;
    this.fillChar = options.fillChar ?? "█";
    this.emptyChar = options.emptyChar ?? "░";
    this.status = options.status;
  }

  setProgress(value: number): void {
    this.progress = Math.max(0, Math.min(100, value));
  }

  getProgress(): number {
    return this.progress;
  }

  setLabel(label: string): void {
    this.label = label;
  }

  setStatus(status?: string): void {
    this.status = status;
  }

  render(): string {
    const filled = Math.round((this.progress / 100) * this.width);
    const bar = this.fillChar.repeat(filled) + this.emptyChar.repeat(this.width - filled);
    const percent = `${String(this.progress).padStart(3)}%`;

    let colorFn = cyan;
    if (this.status === "PASS") colorFn = green;
    else if (this.status === "FAIL") colorFn = red;
    else if (this.status === "RUNNING") colorFn = yellow;

    const barColored = colorFn(bar);
    const labelPart = this.label ? ` ${bold(this.label)}` : "";
    const statusPart = this.status ? ` ${colorFn(this.status)}` : "";

    return `${barColored} ${percent}${labelPart}${statusPart}`;
  }
}