/**
 * db/manager.ts -- SQLite database manager for M0.9 kernel primitives.
 *
 * Manages the ~/.alix/alix.db connection, runs migrations,
 * and provides health checks.
 */

import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export class DatabaseManager {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? join(homedir(), ".alix", "alix.db");
  }

  /** Open or create the database. */
  open(): void {
    const dir = join(this.dbPath, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  /** Run a SQL migration file. */
  migrate(sqlPath: string): void {
    if (!this.db) throw new Error("Database not opened");
    const sql = readFileSync(sqlPath, "utf-8");
    this.db.exec(sql);
  }

  /** Run the M0.9 kernel migration from the SQL file. */
  migrateKernel(): void {
    if (!this.db) throw new Error("Database not opened");
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const sqlPath = join(__dirname, "migrations", "0001_m09_kernel.sql");
    const sql = readFileSync(sqlPath, "utf-8");
    this.db.exec(sql);
  }

  /** Check database health. */
  health(): { ok: boolean; tables: string[]; error?: string } {
    try {
      if (!this.db) return { ok: false, tables: [], error: "Not opened" };
      const rows = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
      const tables = rows.map(r => r.name);
      return { ok: true, tables };
    } catch (err) {
      return { ok: false, tables: [], error: String(err) };
    }
  }

  /** Close connection. */
  close(): void {
    this.db?.close();
    this.db = null;
  }

  /** Get the raw db handle for queries. */
  get handle(): Database.Database | null {
    return this.db;
  }
}
