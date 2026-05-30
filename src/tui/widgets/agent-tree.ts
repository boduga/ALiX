import { cyan, green, red, yellow, dim, bold } from "../ansi.js";
import type { SubagentNode, SubagentStatus } from "../store.js";

const STATUS_COLORS: Record<SubagentStatus, (text: string) => string> = {
  pending: dim,
  running: cyan,
  completed: green,
  failed: red,
};

const STATUS_LABELS: Record<SubagentStatus, string> = {
  pending: "○ PENDING",
  running: "● RUNNING",
  completed: "✓ COMPLETED",
  failed: "✗ FAILED",
};

export class AgentTreeWidget {
  private nodes: Map<string, SubagentNode> = new Map();
  private expandedNodes: Set<string> = new Set();
  private orchestratorLabel: string;

  constructor(orchestratorLabel: string = "orchestrator") {
    this.orchestratorLabel = orchestratorLabel;
  }

  addNode(node: SubagentNode): void {
    this.nodes.set(node.id, node);
  }

  updateNode(id: string, updates: Partial<SubagentNode>): void {
    const existing = this.nodes.get(id);
    if (existing) {
      this.nodes.set(id, { ...existing, ...updates });
    }
  }

  removeNode(id: string): void {
    this.nodes.delete(id);
  }

  expandNode(id: string): void {
    this.expandedNodes.add(id);
  }

  collapseNode(id: string): void {
    this.expandedNodes.delete(id);
  }

  render(): string {
    const lines: string[] = [];

    // Orchestrator root
    lines.push(`${cyan("●")} ${bold(this.orchestratorLabel)}`);

    if (this.nodes.size === 0) {
      lines.push(`  ${dim("No subagents")}`);
      return lines.join("\n");
    }

    // Render each subagent
    const entries = Array.from(this.nodes.values());
    entries.forEach((node, idx) => {
      const isLast = idx === entries.length - 1;
      const prefix = isLast ? "└─" : "├─";
      const statusColorFn = STATUS_COLORS[node.status];

      // Node line
      const roleStr = cyan(node.role);
      const taskStr = node.task.length > 30 ? node.task.slice(0, 30) + "..." : node.task;
      const statusStr = statusColorFn(STATUS_LABELS[node.status]);

      lines.push(`  ${prefix} ${roleStr} (${taskStr})  ${statusStr}`);

      // Expanded findings
      if (this.expandedNodes.has(node.id) && node.findings && node.findings.length > 0) {
        node.findings.forEach(finding => {
          lines.push(`      ${dim("└")} ${finding}`);
        });
      }
    });

    return lines.join("\n");
  }
}