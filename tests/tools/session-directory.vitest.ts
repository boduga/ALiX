import { describe, expect, it } from 'vitest';
import { sessionIdFromDirectory } from '../../src/capabilities/tools/executor.js';

describe('executor session identity across directory separators', () => {
  it.each([
    ['/workspace/.alix/sessions/session-d9', 'session-d9'],
    [String.raw`C:\workspace\.alix\sessions\session-d9`, 'session-d9'],
    [String.raw`C:\workspace\.alix/sessions/session-d9`, 'session-d9'],
    ['/workspace/my-sessions/other', 'unknown'],
    ['/workspace/no-session', 'unknown'],
  ])('%s -> %s', (path, expected) => {
    expect(sessionIdFromDirectory(path)).toBe(expected);
  });
});
