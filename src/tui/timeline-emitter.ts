import type { TabId } from './state.js';
import type { EventLog } from '../events/event-log.js';
import type { CapabilityEmitContext } from './capabilities/invocation-presenter.js';
import { appendLogEntry } from './log-emit.js';

/** Per-tab session ids + EventLog the TUI was constructed with. */
export interface TimelineEmitterOpts {
  eventLog?: EventLog;
  chatSessionId?: string;
  agentSessionId?: string;
}

/** Single-emit timeline writes into the EventLog (Phase 6 D9).
 *  The EventLog is the single source of truth timeline; the per-tab
 *  in-memory cache was removed. Fire-and-forget appends — a log-write
 *  failure must not fail the input path. */
export class TimelineEmitter {
  constructor(private readonly opts: TimelineEmitterOpts) {}

  emitCtx(sessionId?: string): CapabilityEmitContext | undefined {
    if (!this.opts.eventLog || !sessionId) return undefined;
    return { eventLog: this.opts.eventLog, sessionId };
  }

  emitTimelineLog(kind: 'user' | 'agent', text: string, sessionId?: string): void {
    if (!this.opts.eventLog || !sessionId) return;
    const agentDomain = sessionId === this.opts.agentSessionId;
    const type = agentDomain
      ? (kind === 'user' ? 'agent.message' : 'agent.response')
      : (kind === 'user' ? 'chat.message' : 'chat.response');
    appendLogEntry(this.opts.eventLog, {
      sessionId,
      actor: kind === 'user' ? 'user' : 'agent',
      type,
      payload: { text },
    });
  }

  sessionIdForTab(tab: TabId): string | undefined {
    if (tab === 'chat') return this.opts.chatSessionId;
    if (tab === 'agent') return this.opts.agentSessionId;
    return undefined;
  }

  appendAgentMessage(tab: TabId, text: string): void {
    this.emitTimelineLog('agent', text, this.sessionIdForTab(tab));
  }
}
