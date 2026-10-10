import type { ExecutionTraceEntry } from '../../runtime/execution-trace.js';
import type { TimelineEntry } from '../../runtime/timeline-builder.js';
import type { DashboardSnapshot } from '../../snapshot.js';
import { buildAgentInspectorModel } from '../model/agent-inspector.js';
import type { OperatorShellSnapshot } from '../model/operator-shell.js';
import { getTranscriptFocusAgentId } from '../model/transcript-filter.js';
import type { TranscriptMode } from '../model/transcript-item.js';
import type { WorkbenchUiState } from '../model/ui-state.js';
import { ConversationProjection } from '../projections/conversation-projection.js';
import type { WorkbenchViewState } from './types.js';

export interface WorkbenchViewStateInput {
  /** Immutable dashboard snapshot composed by SnapshotBuilder. */
  readonly snapshot: DashboardSnapshot;
  /** Feature-gated Workbench presentation state owned by WorkbenchStore. */
  readonly ui: WorkbenchUiState;
  /** Operator-shell projection; needs legacy/live inputs, so it is supplied. */
  readonly chrome: OperatorShellSnapshot;
  /** Agent-session transcript sources (the per-tab runtime snapshot). */
  readonly transcriptSource: {
    readonly timeline: readonly TimelineEntry[];
    readonly trace: readonly ExecutionTraceEntry[];
  };
}

const transcriptProjection = new ConversationProjection();

/**
 * Assemble the renderer-neutral Workbench view state. Pure: it reads only the
 * supplied snapshot, UI store, chrome projection, and transcript sources — no
 * runtime service or event log. No second state store and no event stream are
 * introduced; the same projection the ANSI painter uses builds the transcript.
 */
export function assembleWorkbenchViewState(input: WorkbenchViewStateInput): WorkbenchViewState {
  const { snapshot, ui, chrome, transcriptSource } = input;
  const mode: TranscriptMode = ui.transcriptMode === 'detailed' ? 'detailed' : 'compact';
  const focusAgentId = getTranscriptFocusAgentId(ui);
  const conversation = transcriptProjection.project({
    timeline: transcriptSource.timeline,
    trace: transcriptSource.trace,
    mode,
    ...(focusAgentId ? { focusAgentId } : {}),
  });

  return {
    header: chrome,
    footer: chrome,
    roster: {
      agents: snapshot.runtime?.agents ?? null,
      tasks: snapshot.runtime?.tasks ?? null,
      artifacts: snapshot.runtime?.artifacts ?? null,
    },
    transcript: {
      conversation,
      mode: ui.transcriptMode,
      filter: ui.transcriptFilter,
      scope: ui.transcriptScope,
      followTail: ui.followTail,
    },
    inspector: buildAgentInspectorModel(snapshot, {
      selectedAgentId: ui.selectedAgentId,
      selectedRunId: ui.selectedRunId,
      selectedTaskId: ui.selectedTaskId,
    }),
    composer: {
      composer: ui.composer,
      coordination: ui.coordination,
      queuedMessages: ui.queuedMessages,
    },
    approval: snapshot.approvals?.pending ?? [],
    selection: {
      selectedRunId: ui.selectedRunId,
      selectedAgentId: ui.selectedAgentId,
      selectedTaskId: ui.selectedTaskId,
      selectedArtifactId: ui.selectedArtifactId,
    },
    overlay: {
      stack: ui.overlayStack,
      scrollOffset: ui.overlayScrollOffset,
      drawer: ui.drawer,
      drawerScrollOffset: ui.drawerScrollOffset,
      agentRosterExpanded: ui.agentRosterExpanded,
    },
    focus: ui.focus,
  };
}
