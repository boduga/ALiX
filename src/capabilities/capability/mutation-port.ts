// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityCatalog } from "./canonical/catalog.js";
import type { CapabilityDefinition } from "./canonical/definition.js";

/** Mutation boundary seam (CAP-3): register/unregister route here, NOT into
 *  the registry's own state. CAP-3 ships the catalog-backed implementation.
 *  CAP-6 replaces this port's implementation with the A4-governed mutation
 *  boundary (CapabilityMutationExecutor); no consumer-facing registry mutation
 *  API may bypass the port after CAP-6. Bootstrap/compatibility ONLY — no A4
 *  authorization, governance, or mutation-ledger semantics in this CAP. */
export interface CapabilityMutationPort {
  register(def: CapabilityDefinition): void;
  unregister(id: string): void;
}

/** CAP-3 implementation: the catalog is already the mutation authority. The
 *  registry never writes the catalog itself; it forwards through this port.
 *  register is IDEMPOTENT — a duplicate id@version is a no-op (bootstrap
 *  seeding may re-run; the store rejects duplicate id@version). */
export class CatalogBackedCapabilityMutationPort implements CapabilityMutationPort {
  constructor(private readonly catalog: CapabilityCatalog) {}

  register(def: CapabilityDefinition): void {
    if (this.catalog.has(def.id)) return; // idempotent bootstrap seeding
    this.catalog.register(def, def.bindings[0]);
  }

  unregister(id: string): void {
    if (!this.catalog.has(id)) return; // silent no-op on unknown id
    this.catalog.remove(id);
  }
}
