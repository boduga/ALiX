import type { ApprovalRecordSnapshot } from '../../snapshot.js';
import type { AgentInspectorModel } from '../model/agent-inspector.js';
import type { AgentRosterSnapshot } from '../model/agent-roster.js';
import type { WorkbenchArtifactSnapshot } from '../model/artifact-inspection.js';
import type { OperatorShellSnapshot } from '../model/operator-shell.js';
import type { TaskRosterSnapshot } from '../model/task-roster.js';
import type { ConversationSnapshot } from '../model/transcript-item.js';
import type {
  ComposerState,
  CoordinationEntryState,
  QueuedMessage,
  WorkbenchDrawer,
  WorkbenchFocus,
  WorkbenchOverlay,
  WorkbenchTranscriptFilter,
  WorkbenchTranscriptMode,
  WorkbenchTranscriptScope,
} from '../model/ui-state.js';

/** Selected execution identities. Undefined is the explicit aggregate scope. */
export interface WorkbenchViewSelection {
  readonly selectedRunId?: string;
  readonly selectedAgentId?: string;
  readonly selectedTaskId?: string;
  readonly selectedArtifactId?: string;
}

export interface WorkbenchViewRoster {
  readonly agents: AgentRosterSnapshot | null;
  readonly tasks: TaskRosterSnapshot | null;
  readonly artifacts: WorkbenchArtifactSnapshot | null;
}

export interface WorkbenchViewTranscript {
  readonly conversation: ConversationSnapshot;
  readonly mode: WorkbenchTranscriptMode;
  readonly filter: WorkbenchTranscriptFilter;
  readonly scope: WorkbenchTranscriptScope;
  readonly followTail: boolean;
}

export interface WorkbenchViewComposer {
  readonly composer: ComposerState;
  readonly coordination: CoordinationEntryState;
  readonly queuedMessages: readonly QueuedMessage[];
}

export interface WorkbenchViewOverlay {
  readonly stack: readonly WorkbenchOverlay[];
  readonly scrollOffset: number;
  readonly drawer: WorkbenchDrawer;
  readonly drawerScrollOffset: number;
  readonly agentRosterExpanded: boolean;
}

/**
 * Renderer-neutral Workbench presentation state, assembled once from the
 * immutable dashboard snapshot and the Workbench UI store. Both the ANSI canvas
 * renderer and the OpenTUI renderer consume this boundary; neither derives
 * additional semantic runtime or operator-intent state. Header and footer share
 * the single operator-shell projection (chrome is one model on two rows).
 */
export interface WorkbenchViewState {
  readonly header: OperatorShellSnapshot;
  readonly footer: OperatorShellSnapshot;
  readonly roster: WorkbenchViewRoster;
  readonly transcript: WorkbenchViewTranscript;
  readonly inspector: AgentInspectorModel;
  readonly composer: WorkbenchViewComposer;
  readonly approval: readonly ApprovalRecordSnapshot[];
  readonly selection: WorkbenchViewSelection;
  readonly overlay: WorkbenchViewOverlay;
  readonly focus: WorkbenchFocus;
}
