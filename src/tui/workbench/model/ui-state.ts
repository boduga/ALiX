export type WorkbenchFocus = 'composer' | 'transcript' | 'drawer' | 'modal';
export type WorkbenchDrawer = 'closed' | 'agents' | 'tasks' | 'artifacts';
export type WorkbenchTranscriptMode = 'compact' | 'detailed' | 'raw';
export type WorkbenchTranscriptFilter = 'all' | 'response' | 'tool' | 'activity' | 'error';
export type WorkbenchTranscriptScope = 'all' | 'selected';
export type WorkbenchOverlay = 'diff' | 'review' | 'diagnostics' | 'help' | 'coordination' | 'inspector';

export interface ComposerState {
  readonly text: string;
  readonly cursor: number;
}

export interface QueuedMessage {
  readonly id: string;
  readonly text: string;
  readonly createdAt: number;
}

export interface WorkbenchUiState {
  readonly focus: WorkbenchFocus;
  readonly overlayScrollOffset: number;
  readonly overlayStack: readonly WorkbenchOverlay[];
  readonly transcriptMode: WorkbenchTranscriptMode;
  readonly transcriptFilter: WorkbenchTranscriptFilter;
  readonly transcriptScope: WorkbenchTranscriptScope;
  readonly selectedItemId?: string;
  /** Undefined means the aggregate across every coordination run. */
  readonly selectedRunId?: string;
  /** Undefined means the aggregate across every agent in the selected run. */
  readonly selectedAgentId?: string;
  readonly selectedTaskId?: string;
  readonly selectedArtifactId?: string;
  readonly agentRosterExpanded: boolean;
  readonly drawer: WorkbenchDrawer;
  readonly drawerScrollOffset: number;
  readonly followTail: boolean;
  readonly composer: ComposerState;
  readonly queuedMessages: readonly QueuedMessage[];
  readonly dimensions: { readonly columns: number; readonly rows: number };
}

export function createInitialWorkbenchUiState(
  dimensions: WorkbenchUiState['dimensions'] = { columns: 80, rows: 24 },
): WorkbenchUiState {
  return {
    focus: 'composer',
    overlayStack: [],
    overlayScrollOffset: 0,
    transcriptMode: 'compact',
    transcriptFilter: 'all',
    transcriptScope: 'all',
    agentRosterExpanded: true,
    drawer: 'closed',
    drawerScrollOffset: 0,
    followTail: true,
    composer: { text: '', cursor: 0 },
    queuedMessages: [],
    dimensions,
  };
}
