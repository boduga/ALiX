/** Child process for cross-process durable worker claim regression. */
import { CoordinationStore } from '../../src/coordination/kernel/coordination-store.js';
const [cwd, runId, workerId] = process.argv.slice(2);
if (!cwd || !runId || !workerId) process.exit(2);
const claimed = await new CoordinationStore(cwd).claimPendingWorker(runId, workerId, 0, { executionOwnerId: `cli-${process.pid}` });
process.stdout.write(JSON.stringify({ claimed }) + '\n');
