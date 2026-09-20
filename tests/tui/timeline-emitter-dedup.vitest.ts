import { describe, it, expect } from 'vitest';
import { shouldSkipDuplicateResponse } from '../../src/tui/timeline-emitter.js';

describe('shouldSkipDuplicateResponse (write-time response dedup)', () => {
  it('skips when the summary is byte-identical to the persisted prose', () => {
    expect(shouldSkipDuplicateResponse('hello', 'hello')).toBe(true);
  });

  it('keeps divergent summaries (synthesis rewrites, sentinels, errors)', () => {
    expect(shouldSkipDuplicateResponse('final answer', 'draft prose')).toBe(false);
    expect(shouldSkipDuplicateResponse('(no response)', 'draft prose')).toBe(false);
    expect(shouldSkipDuplicateResponse('partial\n\nfinal', 'final')).toBe(false);
  });

  it('keeps the response when no loop prose exists (direct/chat routes)', () => {
    expect(shouldSkipDuplicateResponse('hello', undefined)).toBe(false);
  });

  it('keeps empty summaries', () => {
    expect(shouldSkipDuplicateResponse('', '')).toBe(false);
  });
});
