/**
 * auth-audit-store.ts — Inspector auth audit as an `AuditEventStore`.
 *
 * The auth audit was the third audit persistence path: a bespoke
 * `appendFileSync` writer at `<authStateDir>/audit.jsonl`, outside the
 * shared `AuditEventStore` contract and the shared `JsonlStore` primitive
 * (#713 G1.3). This adapter brings it onto the contract while preserving
 * the fail-closed contract: `append` awaits the write and rethrows on
 * failure, so an auth mutation cannot succeed without its audit record.
 *
 * Record shape is unchanged (`{ id, timestamp, action, tokenId, details }`)
 * so existing readers (security doctor) keep working.
 */

import { randomUUID } from "node:crypto";
import { JsonlStore, parseJsonl } from "../../storage/jsonl-store.js";
import type { AuditEventStore } from "../../audit/audit-contract.js";

export type AuthAuditInput = {
  action: string;
  tokenId: string;
  details?: Record<string, unknown>;
};

export type AuthAuditRecord = AuthAuditInput & {
  id: string;
  timestamp: string;
};

export class AuthAuditStore
  implements AuditEventStore<AuthAuditInput, AuthAuditRecord>
{
  private readonly store: JsonlStore;

  constructor(readonly filePath: string) {
    // 0o700 dir / 0o600 file — the auth state dir is operator-private.
    this.store = new JsonlStore(filePath, 0o700, 0o600);
  }

  /**
   * Append one auth audit record. Throws on write failure so the enclosing
   * auth mutation can fail closed (#685).
   */
  async append(input: AuthAuditInput): Promise<AuthAuditRecord> {
    const record: AuthAuditRecord = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input,
    };
    await this.store.appendRecord(record);
    return record;
  }

  /** Read all records in file order (oldest first). */
  async list(): Promise<AuthAuditRecord[]> {
    const text = await this.store.readText();
    if (text === null) return [];
    return parseJsonl<AuthAuditRecord>(text).records;
  }
}
