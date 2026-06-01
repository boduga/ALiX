import cliSpinners from "cli-spinners";
import { cyan, green, red, yellow } from "../ansi.js";

export type SpinnerPhase = "thinking" | "writing" | "verifying" | "idle";

export interface SpinnerOptions {
  label?: string;
  spinner?: keyof typeof cliSpinners;
  color?: "cyan" | "green" | "red" | "yellow";
  phase?: SpinnerPhase;
}

export class SpinnerWidget {
  private label: string;
  private frames: string[];
  private frameIndex = 0;
  private running = false;
  private intervalId?: NodeJS.Timeout;
  private colorFn: (text: string) => string;
  private phase: SpinnerPhase = "thinking";

  constructor(options: SpinnerOptions = {}) {
    this.label = options.label ?? "";
    const spinnerType = options.spinner ?? "dots";
    this.frames = cliSpinners[spinnerType].frames;
    this.colorFn = options.color === "green" ? green
                 : options.color === "red" ? red
                 : options.color === "yellow" ? yellow
                 : cyan;
    if (options.phase) this.phase = options.phase;
  }

  getPhase(): SpinnerPhase { return this.phase; }
  setPhase(phase: SpinnerPhase): void { this.phase = phase; }

  getLabel(): string {
    return this.label;
  }

  setLabel(label: string): void {
    this.label = label;
  }

  tick(): void {
    this.frameIndex = (this.frameIndex + 1) % this.frames.length;
  }

  render(): string {
    if (this.phase === "idle") return "";
    const frame = this.frames[this.frameIndex];
    const phaseLabel = {
      thinking: "Thinking",
      writing: "Writing",
      verifying: "Verifying",
    }[this.phase];
    return `${this.colorFn(frame)} ${phaseLabel} ${this.label}`;
  }

  start(): void {
    this.running = true;
    this.intervalId = setInterval(() => {
      this.tick();
    }, cliSpinners.dots.interval);
  }

  stop(): void {
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  isRunning(): boolean {
    return this.phase !== "idle";
  }
}