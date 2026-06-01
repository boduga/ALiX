// src/self-extend/registry.ts

export type InProcessExtension = {
  type: "skill" | "hook" | "mcp" | "recipe" | "subagent";
  name: string;
  manifest: any;  // ExtensionManifest from src/extensions/manifest.js
  registeredAt: number;
};

const store = new Map<string, InProcessExtension>();

function key(type: string, name: string): string {
  return `${type}::${name}`;
}

export function registerInProcess(ext: InProcessExtension): void {
  const k = key(ext.type, ext.name);
  if (store.has(k)) {
    throw new Error(`Extension already exists: ${ext.type}/${ext.name}`);
  }
  store.set(k, { ...ext, registeredAt: ext.registeredAt ?? Date.now() });
}

export function unregisterInProcess(type: string, name: string): void {
  store.delete(key(type, name));
}

export function listInProcess(): InProcessExtension[] {
  return Array.from(store.values());
}

export function getInProcess(type: string, name: string): InProcessExtension | undefined {
  return store.get(key(type, name));
}

export function _clearInProcessForTesting(): void {
  store.clear();
}