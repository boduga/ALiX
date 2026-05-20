import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: Date;
  filesChanged: number;
}

export interface HotPath {
  path: string;
  changeCount: number;
  lastChanged: Date;
}

export interface GitActivityReaderOptions {
  cwd?: string;
  author?: string;
}

export class GitActivityReader {
  private cwd: string;

  constructor(options: GitActivityReaderOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
  }

  async getRecentCommits(options: { limit?: number; author?: string } = {}): Promise<CommitInfo[]> {
    const limit = options.limit ?? 10;
    const authorFilter = options.author ? `--author="${options.author}"` : "";

    try {
      const { stdout } = await execAsync(
        `git log ${authorFilter} --format="%H|%s|%an|%ad|%ct" -n ${limit}`,
        { cwd: this.cwd }
      );

      return stdout.trim().split("\n")
        .filter(line => line.trim())
        .map(line => {
          const [hash, message, author, dateStr] = line.split("|");
          return {
            hash,
            message,
            author,
            date: new Date(dateStr),
            filesChanged: 0,
          };
        });
    } catch {
      return [];
    }
  }

  async getChangedFiles(ref: string): Promise<string[]> {
    try {
      const { stdout } = await execAsync(
        `git diff-tree --no-commit-id --name-only -r ${ref}`,
        { cwd: this.cwd }
      );

      return stdout.trim().split("\n").filter(line => line.trim());
    } catch {
      return [];
    }
  }

  async getHotPaths(options: { days?: number; minChanges?: number } = {}): Promise<HotPath[]> {
    const days = options.days ?? 30;
    const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

    try {
      const { stdout } = await execAsync(
        `git log --since="${sinceDate}" --name-only --format=""`,
        { cwd: this.cwd }
      );

      const counts = new Map<string, number>();
      const lines = stdout.trim().split("\n").filter(line => line.trim());

      for (const path of lines) {
        counts.set(path, (counts.get(path) ?? 0) + 1);
      }

      const result: HotPath[] = [];
      for (const [path, count] of counts) {
        if (count >= (options.minChanges ?? 1)) {
          result.push({
            path,
            changeCount: count,
            lastChanged: new Date(),
          });
        }
      }

      return result.sort((a, b) => b.changeCount - a.changeCount);
    } catch {
      return [];
    }
  }
}