/**
 * audit-contract.ts — canonical persistence contract for audit event streams.
 *
 * One implementation owns audit persistence: the shared JSONL primitives in
 * `src/storage/jsonl-store.ts`, reached through a store that implements this
 * contract. Domain stores (`src/audit/audit-store.ts` runtime records,
 * `src/governance/audit-store.ts` governance records) are adapters: they own
 * record shaping, validation, and hash-chaining, but not the I/O mechanics.
 *
 * This is deliberately minimal — append and read. Query/filter/chain
 * verification stay on the concrete adapters because they are domain-specific.
 *
 * #713 — consolidation seam.
 */

export interface AuditEventStore<TInput, TEvent> {
  /** Append one event. Returns the fully-formed persisted event. */
  append(input: TInput): Promise<TEvent>;

  /** Read all events (adapter-defined order; runtime store is newest-first). */
  list(): Promise<TEvent[]>;
}
