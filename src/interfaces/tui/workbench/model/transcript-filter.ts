import type { TranscriptItem } from './transcript-item.js';

export type TranscriptFilter = 'all' | 'response' | 'tool' | 'activity' | 'error';
export type TranscriptScope = 'all' | 'selected';

export function getTranscriptFocusAgentId(state?: {
  readonly transcriptScope?: TranscriptScope;
  readonly selectedAgentId?: string;
}): string | undefined {
  return state?.transcriptScope === 'selected' ? state.selectedAgentId : undefined;
}

export function transcriptItemMatchesFilter(item: TranscriptItem, filter: TranscriptFilter): boolean {
  if (item.kind === 'approval' || filter === 'all') return true;
  switch (filter) {
    case 'response': return item.kind === 'user' || item.kind === 'assistant' || item.kind === 'plan';
    case 'tool': return item.kind === 'tool-group';
    case 'activity': return item.kind === 'activity' || item.kind === 'phase' || (item.kind === 'diagnostic' && item.severity !== 'error');
    case 'error': return (item.kind === 'diagnostic' && item.severity === 'error') || (item.kind === 'tool-group' && item.tools.some((tool) => tool.status === 'failed'));
  }
}
