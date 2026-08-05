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
 *  failure must not fail the input path. Stateless over the constructed
 *  opts, so it is a factory (per CONTRIBUTING "no classes where functions
 *  suffice") rather than a class. */
export interface TimelineEmitter {
  emitCtx(sessionId?: string): CapabilityEmitContext | undefined;
  emitTimelineLog(kind: 'user' | 'agent', text: string, sessionId?: string): void;
  sessionIdForTab(tab: TabId): string | undefined;
  appendAgentMessage(tab: TabId, text: string): void;
}

export function createTimelineEmitter(opts: TimelineEmitterOpts): TimelineEmitter {
  const emitCtx = (sessionId?: string): CapabilityEmitContext | undefined => {
    if (!opts.eventLog || !sessionId) return undefined;
    return { eventLog: opts.eventLog, sessionId };
  };

  const emitTimelineLog = (kind: 'user' | 'agent', text: string, sessionId?: string): void => {
    if (!opts.eventLog || !sessionId) return;
    const agentDomain = sessionId === opts.agentSessionId;
    const type = agentDomain
      ? (kind === 'user' ? 'agent.message' : 'agent.response')
      : (kind === 'user' ? 'chat.message' : 'chat.response');
    appendLogEntry(opts.eventLog, {
      sessionId,
      actor: kind === 'user' ? 'user' : 'agent',
      type,
      payload: { text },
    });
  };

  const sessionIdForTab = (tab: TabId): string | undefined => {
    if (tab === 'chat') return opts.chatSessionId;
    if (tab === 'agent') return opts.agentSessionId;
    return undefined;
  };

  const appendAgentMessage = (tab: TabId, text: string): void => {
    emitTimelineLog('agent', text, sessionIdForTab(tab));
  };

  return { emitCtx, emitTimelineLog, sessionIdForTab, appendAgentMessage };
}
