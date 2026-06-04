import { TuiStore, createTuiStore } from "./store.js";
import { TuiRenderer } from "./render.js";
import { EventLogBridge } from "./events.js";
import type { EventLog } from "../events/event-log.js";

export interface TuiOptions {
  sessionId: string;
  eventLog?: EventLog;
  enableSound?: boolean;
}

export class Tui {
  private store: TuiStore;
  private renderer?: TuiRenderer;
  private bridge: EventLogBridge;
  private options: TuiOptions;

  constructor(options: TuiOptions) {
    this.options = options;
    this.store = createTuiStore({ sessionId: options.sessionId });
    this.bridge = new EventLogBridge(this.store);
  }

  async init(): Promise<void> {
    this.renderer = new TuiRenderer();
    this.renderer.start();
    this.renderer.drawLayout();

    if (this.options.eventLog) {
      this.options.eventLog.watch((event) => {
        this.bridge.applyEvent(event.type, event.payload as Record<string, unknown>);
      });
    }
  }

  getStore(): TuiStore {
    return this.store;
  }

  getBridge(): EventLogBridge {
    return this.bridge;
  }

  appendOutput(text: string, streaming = false): void {
    this.renderer?.appendOutput(text, streaming);
  }

  destroy(): void {
    this.renderer?.stop();
  }
}

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
