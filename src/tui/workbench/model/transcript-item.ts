import type { ExecutionTraceStatus } from '../../runtime/execution-trace.js';
import type { PlanTask } from '../../../planning/plan-task.js';

export type TranscriptMode = 'compact' | 'detailed';

export interface TranscriptSourceRange {
  readonly firstSequence: number;
  readonly lastSequence: number;
}

interface TranscriptItemBase {
  readonly id: string;
  readonly startedAt: number;
  readonly sourceEvents: TranscriptSourceRange;
}

export interface UserTurnItem extends TranscriptItemBase {
  readonly kind: 'user';
  readonly text: string;
}

export interface AssistantMessageItem extends TranscriptItemBase {
  readonly kind: 'assistant';
  readonly text: string;
}

export interface ToolItem {
  readonly id: string;
  readonly name: string;
  readonly status: ExecutionTraceStatus;
  readonly detail?: string;
  readonly durationMs?: number;
  readonly sourceEvents: TranscriptSourceRange;
}

export interface ToolGroupItem extends TranscriptItemBase {
  readonly kind: 'tool-group';
  readonly tools: readonly ToolItem[];
}

export interface ApprovalItem extends TranscriptItemBase {
  readonly kind: 'approval';
  readonly text: string;
}

export interface PhaseItem extends TranscriptItemBase {
  readonly kind: 'phase';
  readonly phase: string;
}

export interface PlanItem extends TranscriptItemBase {
  readonly kind: 'plan';
  readonly text?: string;
  readonly tasks: readonly PlanTask[];
}

export interface DiagnosticItem extends TranscriptItemBase {
  readonly kind: 'diagnostic';
  readonly severity: 'info' | 'warning' | 'error';
  readonly text: string;
}

export type TranscriptItem =
  | UserTurnItem
  | AssistantMessageItem
  | ToolGroupItem
  | ApprovalItem
  | PlanItem
  | PhaseItem
  | DiagnosticItem;

export interface ConversationSnapshot {
  readonly items: readonly TranscriptItem[];
  readonly hiddenDiagnostics: number;
}
