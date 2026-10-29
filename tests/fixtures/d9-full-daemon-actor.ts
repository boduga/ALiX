/** Independent operator-side process; no decision or store is mocked. */
import { ApprovalStore } from '../../src/governance/approvals/approval-store.js';
import { closeAllSharedLedgers } from '../../src/runtime-state/storage/runtime-ledger.js';
const [cwd, id, action] = process.argv.slice(2);
if (!process.send || !cwd || !id || !action) throw new Error('Expected isolated actor');
const store = new ApprovalStore(cwd); await store.load();
const original = store.get(id)!;
await new Promise<void>(resolve => { process.once('message', () => resolve()); process.send!({ event: 'ready', pid: process.pid }); });
try {
  let result: unknown;
  if (action === 'approve' || action === 'deny') result = await store.resolve(id, action === 'approve' ? 'approved' : 'denied');
  else if (action === 'revoke') result = await store.revoke(id, { actor: 'operator', reason: 'D9 concurrent cancellation of approval authority' });
  else if (action === 'consume') result = await store.consumeApproved(id, original.bindingKey!, { workerId: 'decision-contender', workerAttempt: 1 }, original.invocation);
  else throw new Error('Unknown actor action');
  process.send!({ event: 'result', pid: process.pid, result });
} finally { closeAllSharedLedgers(); process.disconnect!(); }
