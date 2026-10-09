// src/runtime-state/contracts/runtime-state-reader.ts
//
// R1 boundary freeze — RuntimeStateReader.
// Read-only versioned state. No mutation permitted through this port.

export interface VersionedEntityState {
  entityId: string;
  entityType: string;
  version: number;
  status: string;
  updatedAt: string;
}

export interface RuntimeStateReader {
  read(entityId: string): Promise<VersionedEntityState | null>;
  readVersion(entityId: string): Promise<number | null>;
}
