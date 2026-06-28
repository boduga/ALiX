export type ActorType = 'user' | 'agent' | 'tool' | 'model' | 'system' | 'sidecar' | 'policy';
export type EventVisibility = 'public' | 'internal' | 'sensitive';

export interface AlixEvent<TPayload = unknown> {
  id: string;
  schemaVersion: '1.0';
  timestamp: string;
  sessionId: string;
  workflowId?: string;
  graphId?: string;
  nodeId?: string;
  actorType: ActorType;
  actorId: string;
  eventType: string;
  payload: TPayload;
  visibility: EventVisibility;
  causality?: { parentEventId?: string; traceId?: string; spanId?: string };
  integrity?: { payloadHash?: string; previousEventHash?: string };
}

export interface EventSink {
  emit<TPayload>(event: AlixEvent<TPayload>): Promise<void>;
}

export function createEvent<TPayload>(input: Omit<AlixEvent<TPayload>, 'id' | 'schemaVersion' | 'timestamp'>): AlixEvent<TPayload> {
  return {
    id: `evt_${crypto.randomUUID()}`,
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    ...input,
  };
}
