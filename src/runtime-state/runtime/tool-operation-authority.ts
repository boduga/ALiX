/** Durable, approval-independent logical tool operation claim/receipt contract.
 * A claim is NOT evidence that an external effect did or did not occur.
 */
import { createHash, randomUUID } from 'node:crypto';
import { getSharedLedger } from '../storage/runtime-ledger.js';

export type ToolOperationState = 'claimed' | 'succeeded' | 'failed';
export interface ToolOperationReceipt {
  operationId: string;
  argumentHash: string;
  state: ToolOperationState;
  result?: unknown;
}
export type ToolOperationDecision =
  | { kind: 'execute'; receipt: ToolOperationReceipt }
  | { kind: 'completed'; receipt: ToolOperationReceipt }
  | { kind: 'unknown'; receipt: ToolOperationReceipt }
  | { kind: 'mismatch'; receipt: ToolOperationReceipt };

/** Stable logical identity must be supplied by the caller, not minted per retry. */
export function toolOperationId(scope: string, logicalId: string): string {
  if (!scope || !logicalId) throw new Error('Tool operation identity requires scope and logicalId');
  return 'tool-operation:' + createHash('sha256').update(JSON.stringify([scope, logicalId])).digest('hex');
}

export class ToolOperationAuthority {
  constructor(private readonly cwd: string) {}

  read(operationId: string): ToolOperationReceipt | null {
    const event = getSharedLedger(this.cwd).lastEvent(operationId, 'toolOperation');
    return event ? event.payload as ToolOperationReceipt : null;
  }

  claim(operationId: string, argumentHash: string): ToolOperationDecision {
    if (!operationId || !argumentHash) throw new Error('Missing operation identity or argument hash');
    const ledger = getSharedLedger(this.cwd);
    const current = this.read(operationId);
    if (current) return this.classify(current, argumentHash);
    const receipt: ToolOperationReceipt = { operationId, argumentHash, state: 'claimed' };
    const now = new Date().toISOString();
    const result = ledger.append({ expectedVersion: 0, event: {
      eventId: randomUUID(), eventType: 'tool.operation.claimed', schemaVersion: 1,
      entityType: 'toolOperation', entityId: operationId, entityVersion: 1,
      correlationId: operationId, actor: { type: 'system', id: 'tool-operation-authority' },
      occurredAt: now, recordedAt: now, payload: receipt,
    } });
    if (result.ok) return { kind: 'execute', receipt };
    if (result.reason !== 'version_conflict') throw new Error(`Tool operation claim rejected: ${result.reason}`);
    const raced = this.read(operationId);
    if (!raced) throw new Error('Tool operation claim conflicted without authoritative receipt');
    return this.classify(raced, argumentHash);
  }

  /** Only the original executor may finalize a claim; recovery never guesses. */
  finish(operationId: string, argumentHash: string, state: 'succeeded' | 'failed', resultValue: unknown): ToolOperationReceipt {
    const ledger = getSharedLedger(this.cwd);
    const current = this.read(operationId);
    if (!current || current.argumentHash !== argumentHash || current.state !== 'claimed') {
      throw new Error('Tool operation cannot be finalized: missing, mismatched or terminal claim');
    }
    const receipt: ToolOperationReceipt = { ...current, state, result: resultValue };
    const expectedVersion = ledger.entityVersion(operationId);
    const now = new Date().toISOString();
    const result = ledger.append({ expectedVersion, event: {
      eventId: randomUUID(), eventType: `tool.operation.${state}`, schemaVersion: 1,
      entityType: 'toolOperation', entityId: operationId, entityVersion: expectedVersion + 1,
      correlationId: operationId, actor: { type: 'system', id: 'tool-operation-authority' },
      occurredAt: now, recordedAt: now, payload: receipt,
    } });
    if (!result.ok) throw new Error(`Tool operation receipt conflict: ${result.reason}`);
    return receipt;
  }

  private classify(receipt: ToolOperationReceipt, hash: string): ToolOperationDecision {
    if (receipt.argumentHash !== hash) return { kind: 'mismatch', receipt };
    return receipt.state === 'claimed' ? { kind: 'unknown', receipt } : { kind: 'completed', receipt };
  }
}
