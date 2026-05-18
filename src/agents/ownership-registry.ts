/**
 * Tracks which worker subagent owns which file paths.
 * Prevents overlapping write ownership across subagents.
 */
export class OwnershipRegistry {
  private owned = new Map<string, string>(); // path -> subagentId

  claim(subagentId: string, paths: string[]): void {
    for (const path of paths) {
      const existing = this.owned.get(path);
      if (existing && existing !== subagentId) {
        throw new Error(`Overlapping ownership: '${path}' already owned by '${existing}'`);
      }
      this.owned.set(path, subagentId);
    }
  }

  release(subagentId: string): void {
    for (const [path, id] of this.owned) {
      if (id === subagentId) this.owned.delete(path);
    }
  }

  isOwner(subagentId: string, path: string): boolean {
    return this.owned.get(path) === subagentId;
  }

  ownedBy(subagentId: string): string[] {
    return [...this.owned.entries()]
      .filter(([, id]) => id === subagentId)
      .map(([path]) => path);
  }

  count(): number { return this.owned.size; }
}