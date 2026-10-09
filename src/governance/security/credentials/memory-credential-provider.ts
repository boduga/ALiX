/**
 * MemoryCredentialProvider — shared CRUD for the store-backed provider
 * backends (PlainFileProvider, EncryptedFileProvider).
 *
 * Both providers hold a `StoreSchema` in memory and differ ONLY in how they
 * persist it to disk (plaintext JSON vs AES-GCM ciphertext). The CRUD
 * surface — get/set/delete/list/serialize — is identical modulo the
 * persist() backend. This base class implements that shared surface against
 * an abstract `persist()`; a subclass provides `load()` (read the store)
 * and `persist()` (write it).
 *
 * Duplication note: before this base, plain-file and encrypted-file each
 * carried near-verbatim copies of get/set/delete/list/serialize (same
 * lookupKey find, same MAX_CREDENTIAL_ENTRIES gate, same splice/persist).
 * Extracting them here means a change to the CRUD contract touches ONE
 * file, not two.
 */

import { randomUUID } from "node:crypto";
import { MAX_CREDENTIAL_ENTRIES, lookupKey, type CredentialEntry, type StoreSchema } from "./credential-store.js";
import { emptyStore } from "./plain-file-provider.js";
import type { CredentialProvider } from "./credential-provider.js";
import type { CredentialBackend } from "./backend-selection.js";

/**
 * Base class for store-backed providers. Subclasses MUST implement
 * `persist()` (write `this.store`) and `load()` (populate `this.store`).
 * The `store` field and the loaded flag are owned here so the CRUD methods
 * can rely on them.
 */
export abstract class MemoryCredentialProvider implements CredentialProvider {
  abstract readonly backend: CredentialBackend;

  protected store: StoreSchema;
  protected loaded = false;

  protected constructor() {
    this.store = emptyStore();
  }

  abstract load(): Promise<void>;

  get(provider: string, keyLabel: string): string | null {
    const key = lookupKey(provider, keyLabel);
    const found = this.store.credentials.find(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );
    return found ? found.value : null;
  }

  async set(
    provider: string,
    keyLabel: string,
    value: string,
    metadata?: Record<string, string>,
    migratedFrom?: CredentialBackend,
  ): Promise<CredentialEntry> {
    if (!this.loaded) {
      throw new Error(
        "Credential store not loaded. Call load() before setting credentials.",
      );
    }

    const key = lookupKey(provider, keyLabel);
    const existing = this.store.credentials.find(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );

    if (existing) {
      existing.value = value;
      existing.entry.updatedAt = new Date().toISOString();
      if (metadata !== undefined) existing.entry.metadata = metadata;
      if (migratedFrom !== undefined) existing.entry.migratedFrom = migratedFrom;
      await this.persist();
      return { ...existing.entry };
    }

    if (this.store.credentials.length >= MAX_CREDENTIAL_ENTRIES) {
      throw new Error(
        `Credential store is full: ${MAX_CREDENTIAL_ENTRIES} entries maximum. ` +
          "Delete unused credentials before adding new ones.",
      );
    }

    const entry: CredentialEntry = {
      id: randomUUID(),
      provider,
      keyLabel,
      encrypted: this.backend !== "plain-file",
      backend: this.backend,
      migratedFrom,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata,
    };
    this.store.credentials.push({ entry, value });
    await this.persist();
    return { ...entry };
  }

  async delete(provider: string, keyLabel: string): Promise<boolean> {
    if (!this.loaded) {
      throw new Error(
        "Credential store not loaded. Call load() before deleting credentials.",
      );
    }
    const key = lookupKey(provider, keyLabel);
    const idx = this.store.credentials.findIndex(
      (c) => lookupKey(c.entry.provider, c.entry.keyLabel) === key,
    );
    if (idx === -1) return false;
    this.store.credentials.splice(idx, 1);
    await this.persist();
    return true;
  }

  list(): CredentialEntry[] {
    return this.store.credentials.map((c) => ({ ...c.entry }));
  }

  serialize(): StoreSchema {
    return this.store;
  }

  /** Write `this.store` to backing storage (subclass). */
  protected abstract persist(): Promise<void>;
}
