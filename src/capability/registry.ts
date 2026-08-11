import { CapabilityValidationError } from "./errors.js";
import type { EventBus } from "./event-bus.js";
import type { Capability, CapabilityStatus, Permission } from "./types.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";

export interface CapabilityQuery {
  text?: string;
  tags?: string[];
  category?: string;
  risk?: string;
  permissions?: Permission;
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
  private readonly lifecycle = new Map<string, LifecycleState>();
  private watchers = new Set<(evt: { type: "registered" | "removed"; capabilityId: string }) => void>();
  private bus?: EventBus;

  /** Bridges registry lifecycle onto the canonical CapabilityEvent bus
   *  (CapabilityRegistered/CapabilityRemoved). The registry-local watch()
   *  surface is unchanged. */
  attach(bus: EventBus): void {
    this.bus = bus;
  }

  register(capability: Capability): void {
    if (!CAPABILITY_ID.test(capability.id)) {
      throw new CapabilityValidationError(`Invalid capability id: ${capability.id} (must match ${CAPABILITY_ID.source})`);
    }
    if (this.byId.has(capability.id)) {
      throw new CapabilityValidationError(`Capability already registered: ${capability.id}`);
    }
    this.byId.set(capability.id, capability);
    for (const w of this.watchers) w({ type: "registered", capabilityId: capability.id });
    this.bus?.emit({ type: "CapabilityRegistered", capabilityId: capability.id, at: Date.now() });
  }

  unregister(id: string): void {
    if (!this.byId.delete(id)) return;
    this.status.delete(id);
    this.lifecycle.delete(id);
    for (const w of this.watchers) w({ type: "removed", capabilityId: id });
    this.bus?.emit({ type: "CapabilityRemoved", capabilityId: id, at: Date.now() });
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
    const perm = q.permissions;
    if (perm) results = results.filter(c => c.requiredPermissions.includes(perm));
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

  /** A7.1 — governed lifecycle overlay. The registry remains the current-state
   *  authority; this is a runtime projection of the A7 lifecycle ledger, and
   *  never a value in the Capability definition. */
  applyLifecycleTransition(id: string, to: LifecycleState): void {
    if (!this.byId.has(id)) throw new CapabilityValidationError(`Unknown capability id: ${id}`);
    this.lifecycle.set(id, to);
  }

  getLifecycleState(id: string): LifecycleState | undefined {
    return this.lifecycle.get(id);
  }

  /** A7.1 — clear the lifecycle overlay entry (used by compensating rollback).
   *  Idempotent: a no-op on an absent id, so callers may invoke it unconditionally. */
  clearLifecycleState(id: string): void {
    this.lifecycle.delete(id);
  }

  /** A7.1 — snapshot of the lifecycle overlay, capabilityId-sorted for a stable
   *  canonical serialization. The overlay is a runtime projection (never a value
   *  in a Capability definition), so `list()`/`query()` do not include it. */
  listLifecycleStates(): { capabilityId: string; state: LifecycleState }[] {
    return [...this.lifecycle.entries()]
      .map(([capabilityId, state]) => ({ capabilityId, state }))
      .sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0));
  }

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
