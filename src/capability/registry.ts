import { CapabilityValidationError } from "./errors.js";
import type { Capability, CapabilityStatus } from "./types.js";

export interface CapabilityQuery {
  text?: string;
  tags?: string[];
  category?: string;
  risk?: string;
  permissions?: string;
  kinds?: string[];
  namespaces?: string[];
}

export interface CapabilityManifest {
  version: 1;
  generatedAt: string;
  functions: Capability[];
}

/** Rejects invalid IDs. Allowed: core.session.list, tool.file.read,
 *  mcp.github.issue.create. Rejected: SessionList, foo, ../../bad. */
const CAPABILITY_ID = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

export class CapabilityRegistry {
  private byId = new Map<string, Capability>();
  private status = new Map<string, CapabilityStatus>();
  private watchers = new Set<(evt: { type: "registered" | "removed"; capabilityId: string }) => void>();

  register(capability: Capability): void {
    if (!CAPABILITY_ID.test(capability.id)) {
      throw new CapabilityValidationError(`Invalid capability id: ${capability.id} (must match ${CAPABILITY_ID.source})`);
    }
    if (this.byId.has(capability.id)) {
      throw new CapabilityValidationError(`Capability already registered: ${capability.id}`);
    }
    this.byId.set(capability.id, capability);
    for (const w of this.watchers) w({ type: "registered", capabilityId: capability.id });
  }

  unregister(id: string): void {
    if (!this.byId.delete(id)) return;
    this.status.delete(id);
    for (const w of this.watchers) w({ type: "removed", capabilityId: id });
  }

  find(id: string): Capability | undefined { return this.byId.get(id); }
  list(): Capability[] { return [...this.byId.values()]; }
  describe(id: string): Capability | undefined { return this.byId.get(id); }

  query(q: CapabilityQuery = {}): Capability[] {
    let results = this.list();
    if (q.text) {
      const t = q.text.toLowerCase();
      results = results.filter(c =>
        c.id.toLowerCase().includes(t) ||
        c.title.toLowerCase().includes(t) ||
        c.description.toLowerCase().includes(t) ||
        (c.aliases ?? []).some(a => a.toLowerCase().includes(t)));
    }
    if (q.tags?.length) results = results.filter(c => q.tags!.some(t => c.tags.includes(t)));
    if (q.category) results = results.filter(c => c.category === q.category);
    if (q.risk) results = results.filter(c => c.risk === q.risk);
    if (q.permissions) results = results.filter(c => c.requiredPermissions.includes(q.permissions as Capability["requiredPermissions"][number]));
    if (q.kinds?.length) results = results.filter(c => q.kinds!.includes(c.kind));
    if (q.namespaces?.length) results = results.filter(c => q.namespaces!.some(ns => c.id.startsWith(`${ns}.`)));
    return results;
  }

  setStatus(id: string, s: { availability?: CapabilityStatus["availability"]; health?: CapabilityStatus["health"] }): void {
    const prev = this.status.get(id);
    const next: CapabilityStatus = {
      capabilityId: id,
      availability: s.availability ?? prev?.availability ?? "available",
      health: s.health ?? prev?.health ?? "healthy",
      lastChecked: Date.now(),
    };
    this.status.set(id, next);
  }

  getStatus(id: string): CapabilityStatus | undefined { return this.status.get(id); }

  reload(): void {
    // No-op in Phase 1. Plugin loader hooks here later to re-scan/re-register.
  }

  watch(cb: (evt: { type: "registered" | "removed"; capabilityId: string }) => void): () => void {
    this.watchers.add(cb);
    return () => this.watchers.delete(cb);
  }

  export(): CapabilityManifest {
    return { version: 1, generatedAt: new Date().toISOString(), functions: this.list() };
  }
}
