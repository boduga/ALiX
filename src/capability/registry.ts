// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { CapabilityValidationError } from "./errors.js";
import type { EventBus } from "./event-bus.js";
import type { Capability, CapabilityStatus, Permission } from "./types.js";
import type { LifecycleState } from "../adaptation/capability-evolution-types.js";
import type { CapabilityDefinition } from "./canonical/definition.js";
import type { CapabilityCatalog } from "./canonical/catalog.js";
import type { CapabilityProviderBinding, ProviderType } from "./canonical/provider.js";
import { canonicalToLegacyCapability, legacyToCanonicalDefinition } from "./legacy-adapter.js";
import type { CapabilityMutationPort } from "./mutation-port.js";

/** CAP-4 canonical availability (user ruling): two unavailable reasons.
 *  missing_binding = nothing to resolve; provider_unavailable = something to
 *  resolve but no provider is currently usable. Exhaustion is provider_unavailable,
 *  never a separate reason. Availability is NOT a lifecycle change. */
export interface CapabilityAvailability {
  available: boolean;
  reason?: "missing_binding" | "provider_unavailable";
}

/** Single canonical registry model (user-approved): one map, definition from
 *  the catalog + lifecycle + availability + bindings. Legacy Capability is
 *  DERIVED on demand — never stored in a parallel map. */
export interface RegisteredCapability {
  definition: CapabilityDefinition;
  lifecycle: LifecycleState;
  availability: CapabilityAvailability;
  bindings: CapabilityProviderBinding[];
}

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

const DEFAULT_LIFECYCLE: LifecycleState = "emerging";

/** Rejects invalid IDs. Allowed: core.session.list, tool.file.read,
 *  mcp.github.issue.create. Rejected: SessionList, foo, ../../bad. */
const CAPABILITY_ID = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

/** Canonical registry — runtime projection of the CAP-2 catalog.
 *  Exactly one instance per runtime universe (composition root = platform.ts).
 *  The registry stores NO definitions independently; `list()` == catalog state.
 *  Legacy find/list/query/register are a TEMPORARY adapter over canonical state. */
export class CapabilityRegistry {
  private entries = new Map<string, RegisteredCapability>();
  private readonly status = new Map<string, CapabilityStatus>();
  private watchers = new Set<(evt: { type: "registered" | "removed"; capabilityId: string }) => void>();
  private bus?: EventBus;
  private mutationPort?: CapabilityMutationPort;
  private providerBound?: (type: string) => boolean;

  constructor(private readonly catalog: CapabilityCatalog) {}

  /** Composition-root wiring (CAP-3). CAP-6 replaces the port implementation
   *  with A4-governed execution; no mutation API bypasses this port. */
  setMutationPort(port: CapabilityMutationPort): void {
    this.mutationPort = port;
  }

  /** Optional provider-availability probe (wired by platform from ProviderExecutorRegistry).
   *  Used ONLY by getAvailableProviders — declarative, no CAP-4 fallback/health. */
  setProviderBound(fn: (type: string) => boolean): void {
    this.providerBound = fn;
  }

  private refresh(): void {
    const next = new Map<string, RegisteredCapability>();
    for (const def of this.catalog.list()) {
      const prev = this.entries.get(def.id);
      next.set(def.id, {
        definition: def,
        lifecycle: prev?.lifecycle ?? DEFAULT_LIFECYCLE,
        availability: prev?.availability ?? { available: true },
        bindings: def.bindings,
      });
    }
    this.entries = next;
  }

  private ensureEntry(id: string): RegisteredCapability {
    this.refresh();
    const entry = this.entries.get(id);
    if (!entry) throw new CapabilityValidationError(`Unknown capability id: ${id}`);
    return entry;
  }

  // ── Canonical API ────────────────────────────────────────────────

  get(id: string): RegisteredCapability | undefined {
    this.refresh();
    return this.entries.get(id);
  }

  listRegistered(): RegisteredCapability[] {
    this.refresh();
    return [...this.entries.values()];
  }

  queryRegistered(q: CapabilityQuery = {}): RegisteredCapability[] {
    return this.query(q).map((c) => this.get(c.id)!).filter(Boolean);
  }

  getLifecycleState(id: string): LifecycleState | undefined {
    return this.get(id)?.lifecycle;
  }

  /** Lifecycle current-state authority (#481). This IS the registry's own
   *  state — not an A7 overlay. The A7 ledger remains history only. */
  setLifecycleState(id: string, to: LifecycleState): void {
    const entry = this.ensureEntry(id);
    entry.lifecycle = to;
  }

  /** A7 compatibility alias (deprecated). 3 production files call
   *  applyLifecycleTransition (rehydration, step-executor) and are outside
   *  CAP-3's file allowlist — this alias keeps them working unmodified while
   *  lifecycle state lives in ONE authority (setLifecycleState). */
  applyLifecycleTransition(id: string, to: LifecycleState): void {
    this.setLifecycleState(id, to);
  }

  clearLifecycleState(id: string): void {
    const entry = this.entries.get(id);
    if (entry) entry.lifecycle = DEFAULT_LIFECYCLE;
  }

  listLifecycleStates(): { capabilityId: string; state: LifecycleState }[] {
    this.refresh();
    return [...this.entries.entries()]
      .map(([capabilityId, e]) => ({ capabilityId, state: e.lifecycle }))
      .sort((a, b) => (a.capabilityId < b.capabilityId ? -1 : a.capabilityId > b.capabilityId ? 1 : 0));
  }

  getAvailability(id: string): CapabilityAvailability | undefined {
    return this.get(id)?.availability;
  }

  /** Runtime exhaustion feedback (CAP-4): marks a capability provider-unavailable
   *  or missing-binding WITHOUT touching lifecycle (#476, #481). */
  setAvailability(id: string, availability: CapabilityAvailability): void {
    const entry = this.ensureEntry(id);
    entry.availability = availability;
  }

  /** Declarative provider read (CAP-3, no CAP-4 semantics): the distinct
   *  binding provider types referenced by currently registered definitions. */
  getProviders(): ProviderType[] {
    const types = new Set<ProviderType>();
    for (const rc of this.listRegistered()) for (const b of rc.bindings) types.add(b.type);
    return [...types];
  }

  /** Declarative: this capability's bindings whose provider type has a bound
   *  executor (via the injected providerBound probe). NOT health/fallback. */
  getAvailableProviders(id: string, bound?: (type: string) => boolean): ProviderType[] {
    const rc = this.get(id);
    if (!rc) return [];
    const probe = bound ?? this.providerBound ?? (() => false);
    return rc.bindings.map((b) => b.type).filter((t) => probe(t));
  }

  export(): CapabilityManifest {
    return { version: 1, generatedAt: new Date().toISOString(), functions: this.list() };
  }

  /** Idempotent bulk import (bootstrap). Routes through the mutation port. */
  import(entries: Array<Capability | CapabilityDefinition>): void {
    for (const e of entries) {
      const isLegacy = "execution" in e;
      const def = isLegacy ? legacyToCanonicalDefinition(e as Capability) : (e as CapabilityDefinition);
      this.mutationPort?.register(def);
    }
    this.refresh();
  }

  // ── Temporary legacy adapter (derived, never stored) ─────────────

  attach(bus: EventBus): void { this.bus = bus; }

  register(capability: Capability): void {
    if (!CAPABILITY_ID.test(capability.id)) {
      throw new CapabilityValidationError(`Invalid capability id: ${capability.id} (must match ${CAPABILITY_ID.source})`);
    }
    if (!this.mutationPort) throw new CapabilityValidationError(`No mutation port wired — register() is bootstrap-only (CAP-3)`);
    this.mutationPort.register(legacyToCanonicalDefinition(capability));
    this.refresh();
    for (const w of this.watchers) w({ type: "registered", capabilityId: capability.id });
    this.bus?.emit({ type: "CapabilityRegistered", capabilityId: capability.id, at: Date.now() });
  }

  unregister(id: string): void {
    this.mutationPort?.unregister(id);
    this.refresh();
    this.status.delete(id);
    this.entries.delete(id);
    for (const w of this.watchers) w({ type: "removed", capabilityId: id });
    this.bus?.emit({ type: "CapabilityRemoved", capabilityId: id, at: Date.now() });
  }

  find(id: string): Capability | undefined {
    const rc = this.get(id);
    if (!rc) return undefined;
    return canonicalToLegacyCapability(rc.definition);
  }

  list(): Capability[] { return this.listRegistered().map((rc) => this.find(rc.definition.id)!).filter(Boolean); }

  describe(id: string): Capability | undefined { return this.find(id); }

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

  reload(): void { this.refresh(); }

  watch(cb: (evt: { type: "registered" | "removed"; capabilityId: string }) => void): () => void {
    this.watchers.add(cb);
    return () => this.watchers.delete(cb);
  }
}
