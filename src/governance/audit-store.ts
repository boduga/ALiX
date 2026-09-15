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

import { join } from "node:path";
import { canonicalHash } from "../security/audit/canonical-json.js";
import type { AuditEventStore } from "../audit/audit-contract.js";
import { JsonlStore, parseJsonl } from "../storage/jsonl-store.js";
import {
  validateAuditEventInput,
  normalizeGovernanceEventType,
  type GovernanceAuditEvent,
  type GovernanceAuditEventInput,
} from "./audit-types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORE_DIR = join(".alix", "governance");
const STORE_FILE = "governance-audit-events.jsonl";

/** Map a stored event's legacy underscored eventType to the canonical vocabulary. */
function normalizeStoredEvent(event: GovernanceAuditEvent): GovernanceAuditEvent {
  const normalized = normalizeGovernanceEventType(String(event.eventType));
  if (normalized === null || normalized === event.eventType) return event;
  return { ...event, eventType: normalized };
}

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

export class FileAuditStore
  implements AuditStore, AuditEventStore<GovernanceAuditEventInput, GovernanceAuditEvent> {
  private readonly dir: string;
  private readonly store: JsonlStore;

  constructor(baseDir: string = process.cwd()) {
    this.dir = join(baseDir, STORE_DIR);
    this.store = new JsonlStore(join(this.dir, STORE_FILE));
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Read the eventHash of the last event in the store.
   * Returns null if the store is empty or doesn't exist.
   */
  private async readLastEventHash(): Promise<string | null> {
    const last = await this.store.readLastLine();
    if (last === null) return null;
    try {
      const parsed = JSON.parse(last) as { eventHash?: unknown };
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
    return parseJsonl<GovernanceAuditEvent>(content).records;
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
    await this.store.appendRecord(event);

    return event;
  }

  // -----------------------------------------------------------------------
  // Read operations
  // -----------------------------------------------------------------------

  async list(): Promise<GovernanceAuditEvent[]> {
    const events = await this.listChronological();
    // Normalize legacy underscored event names to the canonical vocabulary on
    // read (#713 step 3). Hash verification uses listChronological (raw).
    return events.reverse().map(normalizeStoredEvent);
  }

  async listChronological(): Promise<GovernanceAuditEvent[]> {
    const content = await this.store.readText();
    if (content === null) return [];
    return this.parseEvents(content);
  }

  async getById(eventId: string): Promise<GovernanceAuditEvent | null> {
    const events = await this.listChronological();
    const found = events.find((e) => e.eventId === eventId) ?? null;
    return found === null ? null : normalizeStoredEvent(found);
  }

  async size(): Promise<number> {
    const events = await this.listChronological();
    return events.length;
  }
}
