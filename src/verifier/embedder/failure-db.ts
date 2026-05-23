import BetterSqlite3, { Database } from "better-sqlite3";
import type { FailureRecord } from "./types.js";

export class FailureDatabaseError extends Error {
  constructor(message: string, cause?: Error) {
    super(message);
    this.name = "FailureDatabaseError";
    if (cause) this.cause = cause;
  }
}

export class FailureDatabase {
  private db: Database;

  constructor(private dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
  }

  async init(): Promise<void> {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS failure_records (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          task TEXT NOT NULL,
          error_summary TEXT,
          file_changes TEXT,
          resolution TEXT,
          resolved_at INTEGER,
          embedding_id TEXT
        );

        CREATE TABLE IF NOT EXISTS embeddings (
          id TEXT PRIMARY KEY,
          vector BLOB NOT NULL,
          metadata TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_session ON failure_records(session_id);
        CREATE INDEX IF NOT EXISTS idx_resolved ON failure_records(resolved_at);
      `);
    } catch (err) {
      throw new FailureDatabaseError(
        `Failed to initialize database at ${this.dbPath}`,
        err as Error
      );
    }
  }

  async listTables(): Promise<string[]> {
    try {
      const rows = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table'"
      ).all() as { name: string }[];
      return rows.map(r => r.name);
    } catch (err) {
      throw new FailureDatabaseError("Failed to list tables", err as Error);
    }
  }

  async insertFailure(record: FailureRecord): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO failure_records
        (id, session_id, task, error_summary, file_changes, resolution, resolved_at, embedding_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        record.id,
        record.sessionId,
        record.task,
        record.errorSummary,
        JSON.stringify(record.fileChanges),
        record.resolution,
        record.resolvedAt,
        record.embeddingId
      );
    } catch (err) {
      throw new FailureDatabaseError(
        `Failed to insert failure record ${record.id}`,
        err as Error
      );
    }
  }

  async getFailure(id: string): Promise<FailureRecord | null> {
    try {
      const row = this.db.prepare(
        "SELECT * FROM failure_records WHERE id = ?"
      ).get(id) as Record<string, unknown> | undefined;

      if (!row) return null;

      return {
        id: row.id as string,
        sessionId: row.session_id as string,
        task: row.task as string,
        errorSummary: row.error_summary as string,
        fileChanges: JSON.parse((row.file_changes as string) || "[]"),
        resolution: row.resolution as string,
        resolvedAt: row.resolved_at as number,
        embeddingId: row.embedding_id as string,
      };
    } catch (err) {
      throw new FailureDatabaseError(
        `Failed to get failure record ${id}`,
        err as Error
      );
    }
  }

  async searchByEmbedding(
    _query: Float32Array,
    topK: number,
    threshold: number
  ): Promise<Array<{ record: FailureRecord; score: number }>> {
    try {
      const rows = this.db.prepare(
        "SELECT * FROM failure_records WHERE resolution IS NOT NULL LIMIT 100"
      ).all() as Record<string, unknown>[];

      const results: Array<{ record: FailureRecord; score: number }> = [];

      for (const row of rows) {
        const textSim = this.textSimilarity(row);
        if (textSim >= threshold) {
          results.push({
            record: {
              id: row.id as string,
              sessionId: row.session_id as string,
              task: row.task as string,
              errorSummary: row.error_summary as string,
              fileChanges: JSON.parse((row.file_changes as string) || "[]"),
              resolution: row.resolution as string,
              resolvedAt: row.resolved_at as number,
              embeddingId: row.embedding_id as string,
            },
            score: textSim,
          });
        }
      }

      return results
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch (err) {
      throw new FailureDatabaseError("Failed to search by embedding", err as Error);
    }
  }

  private textSimilarity(row: Record<string, unknown>): number {
    const patterns = ["TypeError", "undefined", "null", "Cannot read"];
    let score = 0;

    const text = `${row.task} ${row.error_summary} ${row.resolution}`.toLowerCase();

    for (const pattern of patterns) {
      if (text.includes(pattern.toLowerCase())) {
        score += 0.2;
      }
    }

    return Math.min(score, 1);
  }

  async countFailures(): Promise<number> {
    try {
      const row = this.db.prepare(
        "SELECT COUNT(*) as count FROM failure_records"
      ).get() as { count: number };
      return row.count;
    } catch (err) {
      throw new FailureDatabaseError("Failed to count failures", err as Error);
    }
  }

  async close(): Promise<void> {
    try {
      this.db.close();
    } catch (err) {
      throw new FailureDatabaseError("Failed to close database", err as Error);
    }
  }
}