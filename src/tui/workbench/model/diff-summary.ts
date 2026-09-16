export interface WorkbenchDiffSummary {
  readonly id: string;
  readonly toolCallId?: string;
  readonly changedFiles: readonly string[];
  readonly status: 'checkpointed' | 'applied' | 'failed' | 'rolled_back';
  readonly firstSequence: number;
  readonly lastSequence: number;
}

export interface WorkbenchDiffSnapshot {
  readonly diffs: readonly WorkbenchDiffSummary[];
  readonly filesChanged: number;
}
