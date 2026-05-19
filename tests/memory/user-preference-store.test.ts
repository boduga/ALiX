import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserPreferenceStore } from '../../src/memory/user-preference-store';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

describe('UserPreferenceStore', () => {
  const testDir = join(__dirname, '../test-data/user-preference-store');
  let store: UserPreferenceStore;

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  it('should initialize without error', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
  });

  it('should save and load a preference', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    await store.set('theme', 'dark');
    const result = await store.get('theme');
    expect(result).toBe('dark');
  });

  it('should return default value when key does not exist', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    const result = await store.get('nonexistent', 'default');
    expect(result).toBe('default');
  });

  it('should return undefined when key does not exist without default', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    const result = await store.get('nonexistent');
    expect(result).toBeUndefined();
  });

  it('should list all preferences', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    await store.set('theme', 'dark');
    await store.set('language', 'en');
    const result = await store.list();
    expect(result).toEqual({ theme: 'dark', language: 'en' });
  });

  it('should delete a preference', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    await store.set('theme', 'dark');
    await store.delete('theme');
    const result = await store.get('theme');
    expect(result).toBeUndefined();
  });

  it('should clear all preferences', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    await store.set('theme', 'dark');
    await store.set('language', 'en');
    await store.clear();
    const result = await store.list();
    expect(result).toEqual({});
  });

  it('should persist preferences across instances', async () => {
    const filename = 'preferences.json';
    store = new UserPreferenceStore(testDir, filename);
    await store.init();
    await store.set('theme', 'dark');

    const store2 = new UserPreferenceStore(testDir, filename);
    await store2.init();
    const result = await store2.get('theme');
    expect(result).toBe('dark');
  });

  it('should overwrite existing value when setting same key', async () => {
    store = new UserPreferenceStore(testDir);
    await store.init();
    await store.set('theme', 'dark');
    await store.set('theme', 'light');
    const result = await store.get('theme');
    expect(result).toBe('light');
  });
});
