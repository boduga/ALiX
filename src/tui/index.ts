import React from "react";
import { render, type Instance } from "ink";
import { AlixApp, type AlixAppApi } from "./AlixApp.js";

export interface TuiConstructorOptions {
  sessionId: string;
  maxTokens?: number;
}

export class Tui {
  private readonly sessionId: string;
  private readonly maxTokens: number | undefined;
  private inkInstance: Instance | null = null;
  private api: AlixAppApi | null = null;
  private tokenFraction = 0;

  public onTask: ((task: string) => Promise<void>) | null = null;
  public onExit: (() => void) | null = null;

  constructor(opts: TuiConstructorOptions) {
    this.sessionId = opts.sessionId;
    this.maxTokens = opts.maxTokens;
  }

  async init(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.inkInstance = render(
        React.createElement(AlixApp, {
          sessionId: this.sessionId,
          maxTokens: this.maxTokens,
          onTask: async (task: string) => {
            if (this.onTask) await this.onTask(task);
          },
          onExit: () => {
            if (this.onExit) this.onExit();
          },
          onReady: (api: AlixAppApi) => {
            this.api = api;
            resolve();
          },
        }),
      );
    });
  }

  appendOutput(text: string, streaming: boolean): void {
    if (!this.api) return;
    this.api.appendOutput(text, streaming);
  }

  resetOutput(): void {
    if (!this.api) return;
    this.api.resetOutput();
  }

  updateTokenUsage(usedTokens: number): void {
    if (!this.api || !this.maxTokens) return;
    this.tokenFraction = Math.min(usedTokens / this.maxTokens, 1);
    this.api.setTokenUsage(this.tokenFraction);
  }

  destroy(): void {
    this.inkInstance?.unmount();
    this.inkInstance = null;
    this.api = null;
  }
}

// Preserve existing exports for backward compatibility
export { TuiStore, createTuiStore } from "./store.js";
export { EventLogBridge } from "./events.js";
export { StateTheaterWidget } from "./widgets/state-theater.js";
export { AgentTreeWidget } from "./widgets/agent-tree.js";
export { BudgetBarWidget } from "./widgets/budget-bar.js";
export { SessionBranchWidget } from "./widgets/session-branch.js";
export { VerificationTheaterWidget } from "./widgets/verification-theater.js";
export { DiffReelWidget } from "./widgets/diff-reel.js";
export { MemoryLensWidget } from "./widgets/memory-lens.js";
export { SpinnerWidget } from "./widgets/spinner.js";
export { ProgressWidget } from "./widgets/progress.js";
