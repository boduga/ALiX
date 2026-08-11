// SPDX-FileCopyrightText: 2024-present alix <alix@example.com>
// SPDX-License-Identifier: MIT

import { appendFileSync, mkdirSync, readFileSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CapabilityDefinition } from "./definition.js";
import { validateCapabilityDefinition } from "./definition.js";
import type { CapabilityProviderBinding } from "./provider.js";

export interface CatalogStoreOptions { dir: string; }

interface DefLine { id: string; version: string; kind: string; /* + full def */ }
interface BindingLine { id: string; binding: CapabilityProviderBinding; }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Durable JSONL store for canonical capability definitions + bindings (§12).
 *  Layout: <dir>/capabilities/definitions.jsonl, <dir>/capabilities/bindings.jsonl. */
export class CapabilityDefinitionStore {
  private readonly defsFile: string;
  private readonly bindingsFile: string;
  private definitions = new Map<string, CapabilityDefinition>();  // key: id@version
  private bindings = new Map<string, CapabilityProviderBinding>();

  constructor(opts: CatalogStoreOptions) {
    this.defsFile = join(opts.dir, "capabilities", "definitions.jsonl");
    this.bindingsFile = join(opts.dir, "capabilities", "bindings.jsonl");
    this.load();
  }

  private load(): void {
    for (const raw of this.readLines(this.defsFile)) {
      try {
        const obj = JSON.parse(raw);
        if (isRecord(obj) && typeof obj.id === "string" && typeof obj.version === "string") {
          validateCapabilityDefinition(obj as unknown as CapabilityDefinition);
          this.definitions.set(this.key(obj.id, obj.version), obj as unknown as CapabilityDefinition);
        }
      } catch { /* corrupt line — skip */ }
    }
    for (const raw of this.readLines(this.bindingsFile)) {
      try {
        const obj = JSON.parse(raw);
        if (isRecord(obj) && typeof obj.id === "string" && isRecord(obj.binding)) {
          this.bindings.set(obj.id, obj.binding as unknown as CapabilityProviderBinding);
        }
      } catch { /* corrupt line — skip */ }
    }
  }

  private readLines(file: string): string[] {
    if (!existsSync(file)) return [];
    const text = readFileSync(file, "utf-8");
    return text.split("\n").filter((l) => l.trim().length > 0);
  }

  private key(id: string, version: string): string { return `${id}@${version}`; }

  private atomicAppend(file: string, line: object): void {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    const existing = existsSync(file) ? readFileSync(file, "utf-8") : "";
    writeFileSync(tmp, existing + JSON.stringify(line) + "\n", "utf-8");
    renameSync(tmp, file); // atomic replace
  }

  listDefinitions(): CapabilityDefinition[] {
    return [...this.definitions.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  getDefinition(id: string): CapabilityDefinition | undefined {
    // Return the highest SemVer for the id — deterministic "current" (§479).
    const matches = [...this.definitions.values()].filter((d) => d.id === id);
    if (matches.length === 0) return undefined;
    matches.sort((a, b) => this.compareVer(a.version, b.version));
    return matches[matches.length - 1];
  }

  private compareVer(a: string, b: string): number {
    const pa = a.split(".").map(Number); const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) { if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0); }
    return 0;
  }

  appendDefinition(def: CapabilityDefinition): void {
    validateCapabilityDefinition(def);
    if (this.definitions.has(this.key(def.id, def.version))) {
      throw new Error(`capability: definition ${def.id}@${def.version} already exists`);
    }
    this.definitions.set(this.key(def.id, def.version), def);
    this.atomicAppend(this.defsFile, def);
  }

  replaceDefinition(def: CapabilityDefinition): void {
    validateCapabilityDefinition(def);
    const k = this.key(def.id, def.version);
    this.definitions.set(k, def);
    // Rewrite the whole file with the updated entry (replace, not append).
    const lines = this.listDefinitions().map((d) => JSON.stringify(d)).join("\n") + "\n";
    mkdirSync(dirname(this.defsFile), { recursive: true });
    const tmp = `${this.defsFile}.tmp`;
    writeFileSync(tmp, lines, "utf-8");
    renameSync(tmp, this.defsFile);
  }

  removeDefinition(id: string): void {
    const remaining = this.listDefinitions().filter((d) => d.id !== id);
    this.definitions = new Map(remaining.map((d) => [this.key(d.id, d.version), d]));
    const lines = remaining.map((d) => JSON.stringify(d)).join("\n") + "\n";
    mkdirSync(dirname(this.defsFile), { recursive: true });
    const tmp = `${this.defsFile}.tmp`;
    writeFileSync(tmp, lines, "utf-8");
    renameSync(tmp, this.defsFile);
    this.bindings.delete(id);
  }

  getBinding(id: string): CapabilityProviderBinding | undefined {
    return this.bindings.get(id);
  }

  appendBinding(id: string, binding: CapabilityProviderBinding): void {
    this.bindings.set(id, binding);
    this.atomicAppend(this.bindingsFile, { id, binding });
  }
}
