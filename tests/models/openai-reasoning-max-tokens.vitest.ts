import { describe, expect, it } from 'vitest';
import { openaiSpec } from '../../src/models/providers/specs/openai-spec.js';

/**
 * OpenAI o-series reasoning models reject `max_tokens`:
 *
 *   API error (400): Unsupported parameter: 'max_tokens' is not supported with
 *   this model. Use 'max_completion_tokens' instead.
 *
 * The fix renames the field ONLY for reasoning models. Non-reasoning chat models
 * (gpt-4, gpt-4o) accept `max_tokens` and must keep it — renaming unconditionally
 * would be a behaviour change for every existing OpenAI user.
 */

function request(model: string, maxOutputTokens = 256) {
  return {
    model,
    messages: [{ role: 'user' as const, content: 'hi' }],
    maxOutputTokens,
  } as never;
}

function body(model: string) {
  return openaiSpec.toRequestBody(request(model)) as Record<string, unknown>;
}

describe('OpenAI reasoning-model max_tokens rename', () => {
  it('renames for o4-mini dated variants', () => {
    const b = body('o4-mini-2025-04-16');
    expect(b.max_completion_tokens).toBe(256);
    expect(b.max_tokens).toBeUndefined();
  });

  it('renames for o3', () => {
    const b = body('o3');
    expect(b.max_completion_tokens).toBe(256);
    expect(b.max_tokens).toBeUndefined();
  });

  it('renames for o1 and o1-mini', () => {
    for (const model of ['o1', 'o1-mini', 'o3-mini']) {
      const b = body(model);
      expect(b.max_completion_tokens, model).toBe(256);
      expect(b.max_tokens, model).toBeUndefined();
    }
  });

  it('does NOT rename for gpt-4o', () => {
    const b = body('gpt-4o');
    expect(b.max_tokens).toBe(256);
    expect(b.max_completion_tokens).toBeUndefined();
  });

  it('does NOT rename for gpt-4', () => {
    const b = body('gpt-4');
    expect(b.max_tokens).toBe(256);
    expect(b.max_completion_tokens).toBeUndefined();
  });

  it('does NOT misclassify a non-reasoning id that merely starts with o', () => {
    // The guard is /^o\d/, not /^o/ — `openchat` must keep `max_tokens`.
    const b = body('openchat');
    expect(b.max_tokens).toBe(256);
    expect(b.max_completion_tokens).toBeUndefined();
  });

  it('leaves other request fields untouched', () => {
    const b = body('o4-mini-2025-04-16');
    expect(b.model).toBe('o4-mini-2025-04-16');
    expect(Array.isArray(b.messages)).toBe(true);
  });

  it('omits both fields when no output ceiling was requested', () => {
    const req = { model: 'o4-mini-2025-04-16', messages: [{ role: 'user' as const, content: 'hi' }] } as never;
    const b = openaiSpec.toRequestBody(req) as Record<string, unknown>;
    expect(b.max_completion_tokens).toBeUndefined();
    expect(b.max_tokens).toBeUndefined();
  });
});
