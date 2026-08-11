// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import type { ProviderType, CapabilityProviderBinding } from "./canonical/provider.js";
import type { ProviderExecutor } from "./provider-executor.js";

/** A binding paired with its resolved executor — what the runtime attempts.
 *  Carries provider identity (providerId/providerType/bindingIndex) as a
 *  first-class execution fact; capability identity never changes (CAP-4). */
export interface ProviderCandidate {
  binding: CapabilityProviderBinding;
  providerId: string;       // = binding.id ("gitnexus", "gh")
  providerType: ProviderType;
  bindingIndex: number;     // position in bindings[]
  executor: ProviderExecutor;
}

/** Type-keyed provider registry (user ruling): ONE executor per provider class.
 *  Instance identity lives in binding.id/binding.config, never here.
 *  register() rejects duplicates — deterministic wiring. */
export class ProviderExecutorRegistry {
  private byType = new Map<ProviderType, ProviderExecutor>();

  register(type: ProviderType, executor: ProviderExecutor): void {
    if (this.byType.has(type)) {
      throw new Error(`capability: provider type '${type}' already registered (duplicate registration rejected)`);
    }
    this.byType.set(type, executor);
  }

  get(type: ProviderType): ProviderExecutor | undefined { return this.byType.get(type); }
  has(type: ProviderType): boolean { return this.byType.has(type); }
  listTypes(): ProviderType[] { return [...this.byType.keys()]; }
}
