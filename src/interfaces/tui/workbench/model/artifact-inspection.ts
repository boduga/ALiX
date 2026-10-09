export type WorkbenchInspectableKind = 'artifact' | 'result';
export type WorkbenchInspectableStatus = 'available' | 'failed' | 'unavailable';

export interface WorkbenchInspectableItem {
  readonly id: string;
  readonly kind: WorkbenchInspectableKind;
  readonly status: WorkbenchInspectableStatus;
  readonly title: string;
  readonly artifactType?: string;
  readonly uri?: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly digest?: string;
  readonly preview?: string;
  readonly coordinationRunId?: string;
  readonly agentId?: string;
  readonly taskId?: string;
  readonly createdAt: number;
  readonly sourceSequence: number;
}

export interface WorkbenchArtifactSnapshot {
  readonly items: readonly WorkbenchInspectableItem[];
  readonly artifacts: number;
  readonly results: number;
  readonly failed: number;
}
