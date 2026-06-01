import { TuiStore } from "./store.js";
import { StateTheaterWidget } from "./widgets/state-theater.js";
import { AgentTreeWidget } from "./widgets/agent-tree.js";
import { BudgetBarWidget } from "./widgets/budget-bar.js";
import { SpinnerWidget } from "./widgets/spinner.js";
import { moveUp, clearLine } from "./ansi.js";
import { renderDiff } from "./diff-render.js";

export class TuiRenderer {
  private store: TuiStore;
  private stateTheater: StateTheaterWidget;
  private agentTree: AgentTreeWidget;
  private budgetBar: BudgetBarWidget;
  private spinner: SpinnerWidget;
  private running = false;
  private timerId?: NodeJS.Timeout;
  private lastRender = "";
  private lastRenderTime = 0;
  private initialPrinted = false;

  constructor(store: TuiStore) {
    this.store = store;
    this.stateTheater = new StateTheaterWidget();
    this.agentTree = new AgentTreeWidget();
    this.budgetBar = new BudgetBarWidget();
    this.spinner = new SpinnerWidget({ label: "Thinking..." });

    // Subscribe to store changes
    this.store.subscribe(() => this.scheduleRender());
  }

  start(): void {
    this.running = true;
  }

  renderInitial(): string {
    if (this.initialPrinted) {
      return "";
    }
    this.initialPrinted = true;
    this.lastRender = this.buildOutput();
    return this.lastRender;
  }

  stop(): void {
    this.running = false;
    if (this.timerId) {
      clearTimeout(this.timerId);
    }
  }

  private scheduleRender(): void {
    if (!this.running) return;

    const now = performance.now();
    const elapsed = now - this.lastRenderTime;

    // Render at 10fps for updates
    if (elapsed >= 100) {
      this.doRender();
      this.lastRenderTime = now;
    }

    this.timerId = setTimeout(() => this.scheduleRender(), 100);
  }

  private doRender(): void {
    const output = this.buildOutput();

    if (!this.initialPrinted) {
      process.stdout.write(output + "\n");
      this.lastRender = output;
      this.initialPrinted = true;
      return;
    }

    renderDiff(this.lastRender, output);
    this.lastRender = output;
  }

  private buildOutput(): string {
    const state = this.store.getState();

    // Update widgets from store state
    this.stateTheater.setState(state.agentState);
    if (state.agentReasoning) {
      this.stateTheater.setReasoning(state.agentReasoning);
    }

    this.budgetBar.setTokens(state.tokenBudget.used, state.tokenBudget.max);
    this.budgetBar.setFiles(state.tokenBudget.files);

    // Sync subagents to tree
    for (const subagent of state.subagents) {
      const existing = this.agentTree["nodes"].get(subagent.id);
      if (!existing) {
        this.agentTree.addNode(subagent);
      } else {
        this.agentTree.updateNode(subagent.id, subagent);
      }
    }

    // Build output
    const lines: string[] = [];

    // State theater
    lines.push(this.stateTheater.render());
    lines.push("");

    // Budget bar
    lines.push(this.budgetBar.render());
    lines.push("");

    // Agent tree
    lines.push(this.agentTree.render());
    lines.push("");

    // Spinner (if running)
    if (this.spinner.isRunning()) {
      lines.push(this.spinner.render());
    }

    return lines.join("\n");
  }
}
