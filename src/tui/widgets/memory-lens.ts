import { cyan, green, red, yellow, dim, bold } from "../ansi.js";

export interface MemoryEntry {
  type: "project" | "session" | "tool" | "repo";
  content: string;
  timestamp?: number;
}

export class MemoryLensWidget {
  private entries: MemoryEntry[] = [];
  private collapsedSections: Set<string> = new Set();

  addProjectEntry(content: string): void {
    this.entries.push({ type: "project", content });
  }

  addSessionDecision(decision: string): void {
    this.entries.push({ type: "session", content: `Decision: ${decision}` });
  }

  addToolCacheEntry(content: string, timestamp?: number): void {
    this.entries.push({ type: "tool", content, timestamp });
  }

  setRepoIndexStale(lastUpdate: number): void {
    this.entries.push({ type: "repo", content: `Last updated: ${this.formatAge(lastUpdate)}`, timestamp: lastUpdate });
  }

  toggleSection(section: string): void {
    if (this.collapsedSections.has(section)) {
      this.collapsedSections.delete(section);
    } else {
      this.collapsedSections.add(section);
    }
  }

  private formatAge(timestamp: number): string {
    const age = Date.now() - timestamp;
    if (age < 60000) return `${Math.round(age / 1000)}s ago`;
    if (age < 3600000) return `${Math.round(age / 60000)}m ago`;
    if (age < 86400000) return `${Math.round(age / 3600000)}h ago`;
    return `${Math.round(age / 86400000)}d ago`;
  }

  private getSectionEntries(type: string): MemoryEntry[] {
    return this.entries.filter(e => e.type === type);
  }

  private renderSection(name: string, icon: string, entries: MemoryEntry[]): string {
    const isCollapsed = this.collapsedSections.has(name.toLowerCase());
    const headerIcon = isCollapsed ? "▶" : "▼";
    const lines = [`${headerIcon} ${name} (${entries.length} entries)`];

    if (!isCollapsed) {
      for (const entry of entries) {
        lines.push(`    - ${entry.content}`);
        if (entry.timestamp && name.toLowerCase() === "tool") {
          lines.push(`      ${dim(this.formatAge(entry.timestamp))}`);
        }
      }
    }

    return lines.join("\n");
  }

  render(): string {
    const lines: string[] = [];
    lines.push(bold("MEMORY") + " " + "─".repeat(45));

    const projectEntries = this.getSectionEntries("project");
    const sessionEntries = this.getSectionEntries("session");
    const toolEntries = this.getSectionEntries("tool");
    const repoEntries = this.getSectionEntries("repo");

    lines.push(this.renderSection("Project Context", cyan("▼"), projectEntries));
    lines.push(this.renderSection("Session Memory", cyan("▼"), sessionEntries));
    lines.push(this.renderSection("Tool Cache", cyan("▼"), toolEntries));
    lines.push(this.renderSection("Repo Index", cyan("▼"), repoEntries));

    return lines.join("\n");
  }
}