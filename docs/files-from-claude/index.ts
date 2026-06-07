/**
 * tui/index.ts
 * Drop-in replacement for the original Tui class.
 *
 * Wraps the Ink <AlixApp> component in an imperative API that matches the
 * interface used throughout runTui:
 *
 *   const tui = new Tui({ sessionId, eventLog, maxTokens });
 *   await tui.init();
 *   tui.appendOutput("hello", false);
 *   tui.resetOutput();
 *   tui.destroy();
 */

import React from "react";
import { render, Instance } from "ink";
import { AlixApp, AlixAppApi } from "./AlixApp.js";
import { EventLog } from "../events/event-log.js";

export interface TuiConstructorOptions {
  sessionId: string;
  eventLog: EventLog;
  maxTokens?: number;
}

export class Tui {
  private readonly sessionId: string;
  private readonly maxTokens: number | undefined;
  private inkInstance: Instance | null = null;
  private api: AlixAppApi | null = null;
  private tokenFraction = 0;

  // Callbacks wired in by runTui after init()
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
          tokenUsage: this.tokenFraction,
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

  /**
   * Append a line to the scrollable output area.
   * @param text    The text to display.
   * @param stream  true = streamed model output, false = system/info line.
   */
  appendOutput(text: string, stream: boolean): void {
    if (!this.api) return;
    this.api.appendLine(text, stream ? "output" : "info");
  }

  /**
   * Clear the output area (called before each new task in the original code).
   * With Ink's <Static> we can't literally remove lines, so we emit a visible
   * separator instead — this preserves scrollback history which is more useful.
   */
  resetOutput(): void {
    if (!this.api) return;
    const cols = process.stdout.columns ?? 80;
    this.api.appendLine("═".repeat(cols), "info");
  }

  /**
   * Update the context token usage display.
   * @param usedTokens  Tokens consumed so far.
   */
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
