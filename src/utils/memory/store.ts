import fs from "node:fs/promises";
import path from "node:path";
import type { MemoryEntry, MemoryConfig, MemoryType } from "./types.js";
import { DEFAULT_MEMORY_CONFIG } from "./types.js";
import yaml from "yaml";

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
   * Get the base path of the memory store
   */
  getBasePath(): string {
    return this.basePath;
  }

  /**
   * Initialize memory store - create all directories and config file
   */
  async init(): Promise<void> {
    const types: MemoryType[] = ["user", "project", "feedback", "reference"];

    // Create base directory
    await fs.mkdir(this.basePath, { recursive: true });

    // Create type directories
    for (const type of types) {
      await fs.mkdir(path.join(this.basePath, type), { recursive: true });
    }

    // Create logs directory
    await fs.mkdir(path.join(this.basePath, "logs"), { recursive: true });

    // Create config file
    const configPath = path.join(this.basePath, "config.json");
    try {
      await fs.access(configPath);
    } catch {
      await fs.writeFile(configPath, JSON.stringify(this.config, null, 2));
    }

    // Create initial index
    try {
      await fs.access(this.indexPath);
    } catch {
      await fs.writeFile(this.indexPath, "# ALiX Memory Index\n\n");
    }
  }

  /**
   * Save a memory entry with frontmatter to a .md file
   */
  async save(entry: Omit<MemoryEntry, "createdAt" | "modifiedAt">): Promise<MemoryEntry> {
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

    await fs.writeFile(filePath, content);
    await this.updateIndex(fullEntry, filePath);

    return fullEntry;
  }

  /**
   * Search entries by text query
   */
  async find(query: string, limit: number = 10): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const types: MemoryType[] = ["user", "project", "feedback", "reference"];
    const queryLower = query.toLowerCase();

    for (const type of types) {
      const typeDir = path.join(this.basePath, type);
      try {
        await fs.access(typeDir);
      } catch {
        continue;
      }

      const files = (await fs.readdir(typeDir)).filter((f) => f.endsWith(".md"));

      for (const file of files) {
        if (results.length >= limit) break;

        const content = await fs.readFile(path.join(typeDir, file), "utf-8");
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
  async loadIndex(): Promise<string> {
    try {
      await fs.access(this.indexPath);
      return await fs.readFile(this.indexPath, "utf-8");
    } catch {
      return "";
    }
  }

  /**
   * Rebuild index from all entries
   */
  async buildIndex(): Promise<void> {
    const indexLines: string[] = ["# ALiX Memory Index\n", ""];
    const types: MemoryType[] = ["user", "project", "feedback", "reference"];

    for (const type of types) {
      indexLines.push(`## ${type.charAt(0).toUpperCase() + type.slice(1)}`);
      const typeDir = path.join(this.basePath, type);

      try {
        await fs.access(typeDir);
      } catch {
        indexLines.push("- No entries", "");
        continue;
      }

      const files = (await fs.readdir(typeDir)).filter((f) => f.endsWith(".md"));

      if (files.length === 0) {
        indexLines.push("- No entries", "");
        continue;
      }

      for (const file of files) {
        const content = await fs.readFile(path.join(typeDir, file), "utf-8");
        const entry = this.parseEntry(content);
        if (entry) {
          indexLines.push(`- [${entry.name}](${type}/${file}) - ${entry.description}`);
        }
      }
      indexLines.push("");
    }

    await fs.writeFile(this.indexPath, indexLines.join("\n"));
  }

  /**
   * Append to daily log
   */
  async logSession(content: string): Promise<void> {
    const today = new Date().toISOString().split("T")[0];
    const logPath = path.join(this.basePath, "logs", `${today}.md`);

    const timestamp = new Date().toISOString();
    const logEntry = `\n## ${timestamp}\n\n${content}\n`;

    try {
      const existing = await fs.readFile(logPath, "utf-8");
      await fs.writeFile(logPath, existing + logEntry);
    } catch {
      await fs.writeFile(logPath, `# Session Log - ${today}\n${logEntry}`);
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

      const data = yaml.parse(frontmatter) as Record<string, string>;

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

  private async updateIndex(entry: MemoryEntry, filePath: string): Promise<void> {
    try {
      await fs.access(this.indexPath);
    } catch {
      return;
    }

    const relativePath = path.relative(this.basePath, filePath);
    const indexContent = await fs.readFile(this.indexPath, "utf-8");
    const link = `- [${entry.name}](${relativePath}) - ${entry.description}\n`;

    // Add to appropriate section
    const typeHeader = `## ${entry.type.charAt(0).toUpperCase() + entry.type.slice(1)}`;
    const sectionIdx = indexContent.indexOf(typeHeader);

    if (sectionIdx !== -1) {
      const nextSection = indexContent.indexOf("## ", typeHeader.length);
      const insertIdx = nextSection !== -1 ? nextSection : indexContent.length;
      const newContent =
        indexContent.slice(0, insertIdx) + link + indexContent.slice(insertIdx);
      await fs.writeFile(this.indexPath, newContent);
    }
  }
}