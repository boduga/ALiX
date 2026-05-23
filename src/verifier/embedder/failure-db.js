import BetterSqlite3 from "better-sqlite3";
export class FailureDatabaseError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = "FailureDatabaseError";
        if (cause)
            this.cause = cause;
    }
}
export class FailureDatabase {
    dbPath;
    db;
    constructor(dbPath) {
        this.dbPath = dbPath;
        this.db = new BetterSqlite3(dbPath);
    }
    async init() {
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
        }
        catch (err) {
            throw new FailureDatabaseError(`Failed to initialize database at ${this.dbPath}`, err);
        }
    }
    async listTables() {
        try {
            const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            return rows.map(r => r.name);
        }
        catch (err) {
            throw new FailureDatabaseError("Failed to list tables", err);
        }
    }
    async insertFailure(record) {
        try {
            const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO failure_records
        (id, session_id, task, error_summary, file_changes, resolution, resolved_at, embedding_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(record.id, record.sessionId, record.task, record.errorSummary, JSON.stringify(record.fileChanges), record.resolution, record.resolvedAt, record.embeddingId);
        }
        catch (err) {
            throw new FailureDatabaseError(`Failed to insert failure record ${record.id}`, err);
        }
    }
    async getFailure(id) {
        try {
            const row = this.db.prepare("SELECT * FROM failure_records WHERE id = ?").get(id);
            if (!row)
                return null;
            return {
                id: row.id,
                sessionId: row.session_id,
                task: row.task,
                errorSummary: row.error_summary,
                fileChanges: JSON.parse(row.file_changes || "[]"),
                resolution: row.resolution,
                resolvedAt: row.resolved_at,
                embeddingId: row.embedding_id,
            };
        }
        catch (err) {
            throw new FailureDatabaseError(`Failed to get failure record ${id}`, err);
        }
    }
    async searchByEmbedding(_query, topK, threshold) {
        try {
            const rows = this.db.prepare("SELECT * FROM failure_records WHERE resolution IS NOT NULL LIMIT 100").all();
            const results = [];
            for (const row of rows) {
                const textSim = this.textSimilarity(row);
                if (textSim >= threshold) {
                    results.push({
                        record: {
                            id: row.id,
                            sessionId: row.session_id,
                            task: row.task,
                            errorSummary: row.error_summary,
                            fileChanges: JSON.parse(row.file_changes || "[]"),
                            resolution: row.resolution,
                            resolvedAt: row.resolved_at,
                            embeddingId: row.embedding_id,
                        },
                        score: textSim,
                    });
                }
            }
            return results
                .sort((a, b) => b.score - a.score)
                .slice(0, topK);
        }
        catch (err) {
            throw new FailureDatabaseError("Failed to search by embedding", err);
        }
    }
    textSimilarity(row) {
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
    async close() {
        try {
            this.db.close();
        }
        catch (err) {
            throw new FailureDatabaseError("Failed to close database", err);
        }
    }
}
