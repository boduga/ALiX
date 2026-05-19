import { readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

export type MemoryRecord = {
  id: string;
  scope: "project" | "user" | "session" | "tool" | "repo";
  content: string;
  source: string;
  createdAt: string;
  expiresAt?: string;
};

export type MemoryStats = {
  projectRecords: number;
  sessionRecords: number;
  toolRecords: number;
  repoRecords: number;
  totalTokens: number;
};

export type InspectionResult = {
  scope: string;
  records: MemoryRecord[];
  totalTokens: number;
};

export class MemoryInspector {
  private resolvedMemoryDir: string;

  constructor(
    private baseDir: string,
    memoryDir?: string
  ) {
    this.resolvedMemoryDir = memoryDir ?? join(baseDir, ".alix", "memory");
  }

  async inspect(scope: string): Promise<InspectionResult> {
    const records = await this.loadRecords(scope);
    const totalTokens = this.estimateTokens(records);

    return {
      scope,
      records,
      totalTokens,
    };
  }

  async getStats(): Promise<MemoryStats> {
    const scopes = ["project", "session", "tool", "repo"] as const;
    const stats: MemoryStats = {
      projectRecords: 0,
      sessionRecords: 0,
      toolRecords: 0,
      repoRecords: 0,
      totalTokens: 0,
    };

    for (const scope of scopes) {
      const records = await this.loadRecords(scope);
      const key = `${scope}Records` as keyof MemoryStats;
      stats[key] = records.length;
      stats.totalTokens += this.estimateTokens(records);
    }

    return stats;
  }

  async format(scope: string): Promise<string> {
    const { records, totalTokens } = await this.inspect(scope);

    if (records.length === 0) {
      return `No ${scope} memory records`;
    }

    const lines = [
      `# ${scope.charAt(0).toUpperCase() + scope.slice(1)} Memory`,
      `Records: ${records.length} | Tokens: ~${totalTokens}`,
      "",
    ];

    for (const record of records) {
      lines.push(`## ${record.id}`);
      lines.push(`Source: ${record.source}`);
      lines.push(`Created: ${record.createdAt}`);
      if (record.expiresAt) {
        lines.push(`Expires: ${record.expiresAt}`);
      }
      lines.push("");
      lines.push(record.content.slice(0, 500));
      if (record.content.length > 500) {
        lines.push("... (truncated)");
      }
      lines.push("");
      lines.push("---");
    }

    return lines.join("\n");
  }

  async clear(scope: string): Promise<number> {
    const dir = join(this.resolvedMemoryDir, scope);
    if (!existsSync(dir)) return 0;

    const files = await readdir(dir);
    let deleted = 0;

    for (const file of files) {
      if (file.endsWith(".json")) {
        await unlink(join(dir, file));
        deleted++;
      }
    }

    return deleted;
  }

  private async loadRecords(scope: string): Promise<MemoryRecord[]> {
    const dir = join(this.resolvedMemoryDir, scope);
    if (!existsSync(dir)) return [];

    const records: MemoryRecord[] = [];
    const files = await readdir(dir);

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await readFile(join(dir, file), "utf8");
          const record = JSON.parse(content) as MemoryRecord;
          if (!record.expiresAt || new Date(record.expiresAt) > new Date()) {
            records.push(record);
          }
        } catch {
          // Skip invalid records
        }
      }
    }

    return records;
  }

  private estimateTokens(records: MemoryRecord[]): number {
    // Rough estimate: 4 chars per token
    return records.reduce((sum, r) => sum + Math.ceil(r.content.length / 4), 0);
  }
}