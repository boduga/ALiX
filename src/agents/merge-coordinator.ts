/**
 * Coordinates results from multiple concurrent subagents.
 * Detects conflicts, summarizes findings, and feeds into parent decision loop.
 */
import type { SubagentResult, SubagentFinding } from "../config/schema.js";

export type Conflict = {
  path: string;
  findings: SubagentFinding[];
};

export class MergeCoordinator {
  private pending: SubagentResult[] = [];

  /** Queue a subagent result for processing. */
  enqueue(result: SubagentResult): void {
    this.pending.push(result);
  }

  /** Get all pending results and clear the queue. */
  drain(): SubagentResult[] {
    const results = [...this.pending];
    this.pending = [];
    return results;
  }

  /** Number of pending results. */
  size(): number { return this.pending.length; }

  /**
   * Identify potential conflicts — file paths where multiple subagents
   * found different things (e.g., two explorers mapped the same file differently).
   */
  detectConflicts(results: SubagentResult[]): Conflict[] {
    const byRef = new Map<string, SubagentFinding[]>();

    for (const result of results) {
      for (const finding of result.findings) {
        if (finding.refs) {
          for (const ref of finding.refs) {
            if (!byRef.has(ref)) byRef.set(ref, []);
            byRef.get(ref)!.push(finding);
          }
        }
      }
    }

    const conflicts: Conflict[] = [];
    for (const [path, findings] of byRef) {
      if (findings.length > 1) {
        conflicts.push({ path, findings });
      }
    }
    return conflicts;
  }

  /**
   * Merge findings into a summary string for the parent agent.
   * Parent incorporates this into its message stream.
   */
  summarize(results: SubagentResult[]): string {
    const lines: string[] = [];
    for (const result of results) {
      lines.push(`## ${result.role} (${result.id.slice(0, 8)})`);
      if (result.error) {
        lines.push(`**Error:** ${result.error}`);
        continue;
      }
      if (result.findings.length === 0) {
        lines.push("(no findings)");
        continue;
      }
      for (const finding of result.findings) {
        lines.push(`- [${finding.type}] ${finding.content}`);
      }
    }
    return lines.join("\n");
  }
}