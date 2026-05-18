import fs from "node:fs";
import path from "node:path";
import type { MemoryEntry, MemoryConfig, MemoryType } from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";

export class MemoryStore {
  private basePath: string;
  private config: MemoryConfig;
  private indexPath: string;

  constructor(basePath: string = ".alix/memory", config?: Partial<MemoryConfig>) {
    this.basePath = basePath;
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config };
    this.indexPath = path.join(this.basePath, "memory.md");
  }

  /**
   * Initialize memory store - create all directories and config file
   */
  init(): void {
    const types: MemoryType[] = ["user", "project", "feedback", "reference"];

    // Create base directory
    fs.mkdirSync(this.basePath, { recursive: true });

    // Create type directories
    for (const type of types) {
      fs.mkdirSync(path.join(this.basePath, type), { recursive: true });
    }

    // Create logs directory
    fs.mkdirSync(path.join(this.basePath, "logs"), { recursive: true });

    // Create config file
    const configPath = path.join(this.basePath, "config.json");
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2));
    }

    // Create initial index
    if (!fs.existsSync(this.indexPath)) {
      fs.writeFileSync(this.indexPath, "# ALiX Memory Index\n\n");
    }
  }

  /**
   * Save a memory entry with frontmatter to a .md file
   */
  save(entry: Omit<MemoryEntry, "createdAt" | "modifiedAt">): MemoryEntry {
    const now = new Date().toISOString();
    const fullEntry: MemoryEntry = {
      ...entry,
      createdAt: now,
      modifiedAt: now,
    };

    const filename = this.sanitizeFilename(entry.name) + ".md";
    const filePath = path.join(this.basePath, entry.type, filename);

    const frontmatter = this.buildFrontmatter(fullEntry);
    const content = `${frontmatter}\n${entry.content}`;

    fs.writeFileSync(filePath, content);
    this.updateIndex(fullEntry, filePath);

    return fullEntry;
  }

  /**
   * Search entries by text query
   */
  find(query: string, limit: number = 10): MemoryEntry[] {
    const results: MemoryEntry[] = [];
    const types: MemoryType[] = ["user", "project", "feedback", "reference"];
    const queryLower = query.toLowerCase();

    for (const type of types) {
      const typeDir = path.join(this.basePath, type);
      if (!fs.existsSync(typeDir)) continue;

      const files = fs.readdirSync(typeDir).filter((f) => f.endsWith(".md"));

      for (const file of files) {
        if (results.length >= limit) break;

        const content = fs.readFileSync(path.join(typeDir, file), "utf-8");
        if (content.toLowerCase().includes(queryLower)) {
          const entry = this.parseEntry(content);
          if (entry) {
            results.push(entry);
          }
        }
      }
    }

    return results;
  }

  /**
   * Load memory index
   */
  loadIndex(): string {
    if (!fs.existsSync(this.indexPath)) {
      return "";
    }
    return fs.readFileSync(this.indexPath, "utf-8");
  }

  /**
   * Rebuild index from all entries
   */
  buildIndex(): void {
    const indexLines: string[] = ["# ALiX Memory Index\n", ""];
    const types: MemoryType[] = ["user", "project", "feedback", "reference"];

    for (const type of types) {
      indexLines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
      const typeDir = path.join(this.basePath, type);

      if (!fs.existsSync(typeDir)) {
        indexLines.push("- No entries", "");
        continue;
      }

      const files = fs.readdirSync(typeDir).filter((f) => f.endsWith(".md"));

      if (files.length === 0) {
        indexLines.push("- No entries", "");
        continue;
      }

      for (const file of files) {
        const content = fs.readFileSync(path.join(typeDir, file), "utf-8");
        const entry = this.parseEntry(content);
        if (entry) {
          indexLines.push(`- [${entry.name}](${type}/${file}) - ${entry.description}`);
        }
      }
      indexLines.push("");
    }

    fs.writeFileSync(this.indexPath, indexLines.join("\n"));
  }

  /**
   * Append to daily log
   */
  logSession(content: string): void {
    const today = new Date().toISOString().split("T")[0];
    const logPath = path.join(this.basePath, "logs", `${today}.md`);

    const timestamp = new Date().toISOString();
    const logEntry = `\n## ${timestamp}\n\n${content}\n`;

    if (fs.existsSync(logPath)) {
      fs.appendFileSync(logPath, logEntry);
    } else {
      fs.writeFileSync(logPath, `# Session Log - ${today}\n${logEntry}`);
    }
  }

  private buildFrontmatter(entry: MemoryEntry): string {
    return `---
name: ${entry.name}
description: ${entry.description}
type: ${entry.type}
confidence: ${entry.confidence}
confirmations: ${entry.confirmations}
createdAt: ${entry.createdAt}
modifiedAt: ${entry.modifiedAt}
${entry.source ? `source: ${entry.source}` : ""}
---`;
  }

  private parseEntry(content: string): MemoryEntry | null {
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) return null;

    try {
      const frontmatter = match[1];
      const body = match[2];

      const lines = frontmatter.split("\n");
      const data: Record<string, string> = {};

      for (const line of lines) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        data[key] = value;
      }

      return {
        name: data.name || "",
        description: data.description || "",
        type: (data.type as MemoryType) || "project",
        content: body,
        createdAt: data.createdAt || "",
        modifiedAt: data.modifiedAt || "",
        confidence: parseFloat(data.confidence) || 0.5,
        confirmations: parseInt(data.confirmations) || 0,
        source: data.source,
      };
    } catch {
      return null;
    }
  }

  private sanitizeFilename(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  private updateIndex(entry: MemoryEntry, filePath: string): void {
    if (!fs.existsSync(this.indexPath)) return;

    const relativePath = path.relative(this.basePath, filePath);
    const indexContent = fs.readFileSync(this.indexPath, "utf-8");
    const link = `- [${entry.name}](${relativePath}) - ${entry.description}\n`;

    // Add to appropriate section
    const typeHeader = `## ${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}`;
    const sectionIdx = indexContent.indexOf(typeHeader);

    if (sectionIdx !== -1) {
      const nextSection = indexContent.indexOf("## ", typeHeader.length);
      const insertIdx = nextSection !== -1 ? nextSection : indexContent.length;
      const newContent =
        indexContent.slice(0, insertIdx) + link + indexContent.slice(insertIdx);
      fs.writeFileSync(this.indexPath, newContent);
    }
  }
}