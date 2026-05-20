interface Snapshot {
  id: string;
  file: string;
  content: string;
  timestamp: number;
  version: number;
}

export class RollbackManager {
  private snapshots = new Map<string, Snapshot[]>();
  private maxSnapshots: number;
  private counter = 0;

  constructor(options: { maxSnapshots?: number } = {}) {
    this.maxSnapshots = options.maxSnapshots ?? 10;
  }

  async snapshot(file: string, content: string): Promise<string> {
    const id = `${file}-${++this.counter}-${Date.now()}`;
    const fileSnapshots = this.snapshots.get(file) ?? [];

    fileSnapshots.push({
      id,
      file,
      content,
      timestamp: Date.now(),
      version: fileSnapshots.length + 1,
    });

    while (fileSnapshots.length > this.maxSnapshots) {
      fileSnapshots.shift();
    }

    this.snapshots.set(file, fileSnapshots);
    return id;
  }

  async getSnapshot(file: string, version?: number): Promise<Snapshot | null> {
    const fileSnapshots = this.snapshots.get(file) ?? [];
    if (fileSnapshots.length === 0) return null;

    if (version !== undefined) {
      const targetIndex = fileSnapshots.length - version;
      return fileSnapshots[targetIndex] ?? null;
    }

    return fileSnapshots[fileSnapshots.length - 1];
  }

  async rollback(file: string, steps = 1): Promise<string | null> {
    const fileSnapshots = this.snapshots.get(file) ?? [];
    const targetIndex = fileSnapshots.length - steps - 1;

    if (targetIndex < 0) return null;

    return fileSnapshots[targetIndex].content;
  }

  async listSnapshots(file: string): Promise<Snapshot[]> {
    return this.snapshots.get(file) ?? [];
  }

  async commit(file: string): Promise<void> {
    this.snapshots.delete(file);
  }

  async clear(): Promise<void> {
    this.snapshots.clear();
  }

  async getMetadata(file: string): Promise<{ snapshotCount: number; oldestSnapshot?: Date; newestSnapshot?: Date } | null> {
    const fileSnapshots = this.snapshots.get(file);
    if (!fileSnapshots || fileSnapshots.length === 0) return null;

    return {
      snapshotCount: fileSnapshots.length,
      oldestSnapshot: new Date(fileSnapshots[0].timestamp),
      newestSnapshot: new Date(fileSnapshots[fileSnapshots.length - 1].timestamp),
    };
  }
}
