import type { EventLog } from '../../../runtime-state/events/event-log.js';
import type { NormalizedMessage } from '../../../models/providers/types.js';
import { hasPendingAgentAction } from './predicates.js';

/** Shared promise gate, before any completion route can emit terminal success. */
export async function gatePendingAgentAction(input: {
  text: string;
  iteration: number;
  maxIterations: number;
  attempts: number;
  maxAttempts: number;
  messages: NormalizedMessage[];
  log: EventLog;
  session: { sessionId: string; actor: 'system' };
}): Promise<{ attempts: number; retry: boolean; summary: string } | null> {
  if (!hasPendingAgentAction(input.text)) return null;
  const retry = input.attempts < input.maxAttempts && input.iteration < input.maxIterations - 1;
  const attempts = input.attempts + (retry ? 1 : 0);
  await input.log.append({ ...input.session, actor: 'system', type: 'completion.claim_rejected',
    payload: { reason: 'pending_action', unsubstantiatedClaims: [], objectiveEvidenceGaps: [], attempt: attempts } });
  if (retry) input.messages.push({ role: 'user', content:
    'Your response promises another action, so it is not a final answer. Perform the remaining action using the offered tools, then report the executed outcome. If you cannot finish, state the unfinished work explicitly; do not promise to do it after this turn ends.' });
  return { attempts, retry,
    summary: `Task remains incomplete: the model promised another action instead of reporting its outcome. Last reply: ${input.text.trim()}` };
}
