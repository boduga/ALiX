// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { CapabilityDefinition } from "./definition.js";
import type { CapabilityProviderBinding } from "./provider.js";
import type { CapabilityDefinitionStore } from "./catalog-store.js";

export interface CapabilityCatalogPatch {
  title?: string; description?: string; tags?: string[]; category?: string;
  risk?: CapabilityDefinition["risk"]; requiredPermissions?: CapabilityDefinition["requiredPermissions"];
  bindings?: CapabilityProviderBinding[];
}

/** Canonical capability catalog — the single durable source of definitions (§10).
 *  Not a registry (no lifecycle/availability); not a governance ledger. */
export class CapabilityCatalog {
  constructor(private readonly store: CapabilityDefinitionStore) {}

  get(id: string): CapabilityDefinition | undefined { return this.store.getDefinition(id); }
  list(): CapabilityDefinition[] { return this.store.listDefinitions(); }
  has(id: string): boolean { return this.store.getDefinition(id) !== undefined; }

  register(def: CapabilityDefinition, binding?: CapabilityProviderBinding): void {
    this.store.appendDefinition(def);
    if (binding) this.store.appendBinding(def.id, binding);
  }

  update(id: string, patch: CapabilityCatalogPatch): void {
    const current = this.store.getDefinition(id);
    if (!current) throw new Error(`capability: catalog update for unknown id ${id}`);
    const next: CapabilityDefinition = { ...current, ...patch };
    this.store.replaceDefinition(next);
    if (patch.bindings) {
      // Replace binding is not part of the store's replace; handled by caller (CAP-6 A4).
    }
  }

  remove(id: string): void { this.store.removeDefinition(id); }

  getBinding(id: string): CapabilityProviderBinding | undefined { return this.store.getBinding(id); }
}
