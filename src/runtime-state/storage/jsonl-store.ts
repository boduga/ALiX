/**
 * jsonl-store.ts — Shared durable-store primitives (#712).
 *
 * One implementation of the patterns every file-backed store
 * re-implements: directory creation, JSONL append, full-file and
 * streaming reads with corruption accounting, and atomic single-file
 * JSON writes. Domain stores keep their validation, hashing, filtering,
 * and public interfaces — they delegate only raw I/O and parsing here,
 * so corruption/locking/limit fixes land once and reach every store.
 *
 * Sync variants exist for stores with synchronous public interfaces
 * (e.g. AdaptationProposalStore.save/load); prefer the async API for
 * new code.
 */

import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// JSONL parsing
// ---------------------------------------------------------------------------

export type JsonlParseResult<T> = {
  records: T[];
  /** Lines that were non-blank but unparseable (or rejected by validate). */
  malformed: number;
};

/** Parse one line: blank lines are skipped by the caller convention. */
export function parseJsonlLine<T>(
  line: string,
  validate?: (value: unknown) => value is T,
): { record: T } | { malformed: true } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { malformed: true };
  }
  if (validate && !validate(parsed)) return { malformed: true };
  return { record: parsed as T };
}

/** Parse whole JSONL content, skipping blank lines. */
export function parseJsonl<T>(
  content: string,
  validate?: (value: unknown) => value is T,
): JsonlParseResult<T> {
  const records: T[] = [];
  let malformed = 0;
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    const result = parseJsonlLine<T>(line, validate);
    if ("record" in result) records.push(result.record);
    else malformed++;
  }
  return { records, malformed };
}

/**
 * Stream raw lines with 1-based physical line numbers (O(1) memory).
 * Blank lines are yielded as-is — callers decide whether they are
 * skipped (parsing) or counted (corruption accounting).
 */
export async function* streamJsonlLines(
  filePath: string,
): AsyncGenerator<{ line: string; lineNumber: number }> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    let lineNumber = 0;
    for await (const line of rl) {
      lineNumber++;
      yield { line, lineNumber };
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

// ---------------------------------------------------------------------------
// JSONL store
// ---------------------------------------------------------------------------

export class JsonlStore {
  constructor(
    readonly filePath: string,
    private readonly dirMode?: number,
    private readonly fileMode?: number,
  ) {}

  get dir(): string {
    return join(this.filePath, "..");
  }

  async ensureDir(): Promise<void> {
    if (!existsSync(this.dir)) {
      await mkdir(this.dir, this.dirMode === undefined ? { recursive: true } : { recursive: true, mode: this.dirMode });
    }
  }

  async appendLine(line: string): Promise<void> {
    await this.ensureDir();
    // `fileMode` (when set) applies only when appendFile creates the file —
    // same semantics as appendFileSync's mode option. Used by stores with
    // restrictive-permission requirements (e.g. the Inspector auth audit).
    if (this.fileMode === undefined) {
      await appendFile(this.filePath, line + "\n", "utf-8");
    } else {
      await appendFile(this.filePath, line + "\n", { encoding: "utf-8", mode: this.fileMode });
    }
  }

  async appendRecord(record: unknown): Promise<void> {
    await this.appendLine(JSON.stringify(record));
  }

  /** File content, or null when the store file does not exist yet. */
  async readText(): Promise<string | null> {
    if (!existsSync(this.filePath)) return null;
    return readFile(this.filePath, "utf-8");
  }

  async readRecords<T>(
    validate?: (value: unknown) => value is T,
  ): Promise<JsonlParseResult<T>> {
    const text = await this.readText();
    if (text === null) return { records: [], malformed: 0 };
    return parseJsonl<T>(text, validate);
  }

  /** Last non-blank line without parsing the whole file into records. */
  async readLastLine(): Promise<string | null> {
    if (!existsSync(this.filePath)) return null;
    let last: string | null = null;
    for await (const { line } of streamJsonlLines(this.filePath)) {
      if (line.trim()) last = line;
    }
    return last;
  }
}

// ---------------------------------------------------------------------------
// Single-file JSON (atomic write + tolerant read)
// ---------------------------------------------------------------------------

/** Write JSON atomically via temp file + rename (async). */
export async function writeJsonFileAtomic(filePath: string, data: unknown): Promise<void> {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${randomUUID().slice(0, 8)}`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600, flag: "wx" });
  await rename(tmpPath, filePath);
}

/** Write JSON atomically via temp file + rename (sync). */
export function writeJsonFileAtomicSync(filePath: string, data: unknown): void {
  const dir = join(filePath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${randomUUID().slice(0, 8)}`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: "utf-8", mode: 0o600, flag: "wx" });
  renameSync(tmpPath, filePath);
}

/**
 * Read and parse a JSON file. Returns null when missing; throws on
 * malformed content (callers distinguish "absent" from "corrupt").
 */
export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!existsSync(filePath)) return null;
  return JSON.parse(await readFile(filePath, "utf-8")) as T;
}

/** Sync variant of readJsonFile. */
export function readJsonFileSync<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

/** Synchronous recursive directory creation. */
export function ensureDirSync(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}
