/**
 * P14.5a — Governance Audit Trail: append-only JSONL store with hash-chaining.
 *
 * FileAuditStore persists GovernanceAuditEvents in a hash-linked chain,
 * providing tamper evidence through SHA-256 hashing over canonical JSON.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { readFile, appendFile, mkdir, access } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { canonicalHash } from "../security/audit/canonical-json.js";
import {
  validateAuditEventInput,
  type GovernanceAuditEvent,
  type GovernanceAuditEventInput,
} from "./audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_DIR = join(".alix", "governance");
const STORE_FILE = "governance-audit-events.jsonl";

// ---------------------------------------------------------------------------
// AuditStore interface
// ---------------------------------------------------------------------------

export interface AuditStore {
  /**
   * Append a governance audit event.
   * Validates the input, computes hash-chain fields, persists to JSONL.
   * Returns the fully-formed event with hashes.
   */
  append(input: GovernanceAuditEventInput): Promise<GovernanceAuditEvent>;

  /**
   * Read all events, newest-first.
   * Malformed JSONL lines are silently skipped.
   */
  list(): Promise<GovernanceAuditEvent[]>;

  /**
   * Read all events in file order (oldest first).
   * Used for chain verification.
   */
  listChronological(): Promise<GovernanceAuditEvent[]>;

  /**
   * Lookup a single event by eventId.
   * Returns null if not found.
   */
  getById(eventId: string): Promise<GovernanceAuditEvent | null>;

  /** Return the number of events in the store. */
  size(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of an audit event body.
 *
 * The caller MUST strip the `eventHash` field before passing the body.
 * The `previousHash` field IS included in the hash computation.
 *
 * Uses canonicalHash from the security audit module for deterministic
 * sorted-key JSON serialisation with domain prefix.
 */
export function computeEventHash(body: Record<string, unknown>): string {
  return canonicalHash(body);
}

// ---------------------------------------------------------------------------
// FileAuditStore
// ---------------------------------------------------------------------------

export class FileAuditStore implements AuditStore {
  private readonly dir: string;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, STORE_DIR);
  }

  private get storePath(): string {
    return join(this.dir, STORE_FILE);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async ensureDir(): Promise<void> {
    try {
      await access(this.dir, constants.F_OK);
    } catch {
      await mkdir(this.dir, { recursive: true });
    }
  }

  /**
   * Read the eventHash of the last event in the store.
   * Returns null if the store is empty or doesn't exist.
   */
  private async readLastEventHash(): Promise<string | null> {
    try {
      const content = await readFile(this.storePath, "utf8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length === 0) return null;
      const parsed = JSON.parse(lines[lines.length - 1]);
      return typeof parsed.eventHash === "string" ? parsed.eventHash : null;
    } catch {
      return null;
    }
  }

  /**
   * Parse and validate JSONL content into events.
   * Malformed lines are silently skipped.
   */
  private parseEvents(content: string): GovernanceAuditEvent[] {
    const lines = content.trim().split("\n").filter(Boolean);
    const events: GovernanceAuditEvent[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as GovernanceAuditEvent;
        events.push(parsed);
      } catch {
        // Skip malformed lines
      }
    }
    return events;
  }

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  async append(input: GovernanceAuditEventInput): Promise<GovernanceAuditEvent> {
    // Validate input
    const validation = validateAuditEventInput(input);
    if (!validation.valid) {
      throw new Error(`Invalid audit event: ${validation.errors.join("; ")}`);
    }

    // Determine previous hash from the last event in the chain
    const previousHash = await this.readLastEventHash();

    // Build body for hash computation (includes previousHash, excludes eventHash)
    const body: Record<string, unknown> = {
      ...(input as unknown as Record<string, unknown>),
      previousHash,
    };

    const eventHash = computeEventHash(body);

    const event: GovernanceAuditEvent = {
      ...input,
      previousHash,
      eventHash,
    };

    // Ensure directory exists and append
    await this.ensureDir();
    await appendFile(this.storePath, JSON.stringify(event) + "\n", "utf8");

    return event;
  }

  // -----------------------------------------------------------------------
  // Read operations
  // -----------------------------------------------------------------------

  async list(): Promise<GovernanceAuditEvent[]> {
    const events = await this.listChronological();
    return events.reverse();
  }

  async listChronological(): Promise<GovernanceAuditEvent[]> {
    let content: string;
    try {
      content = await readFile(this.storePath, "utf8");
    } catch {
      return [];
    }
    return this.parseEvents(content);
  }

  async getById(eventId: string): Promise<GovernanceAuditEvent | null> {
    const events = await this.listChronological();
    return events.find((e) => e.eventId === eventId) ?? null;
  }

  async size(): Promise<number> {
    const events = await this.listChronological();
    return events.length;
  }
}
