import { describe, expect, it } from 'vitest';
import { planWorkerCredentialGrant } from '../../src/agents/credential-grant-planner.js';
import type { ModelConfig } from '../../src/operations/config/schema.js';

const primary = { provider: 'openai', name: 'synthetic-model' } satisfies ModelConfig;

describe('GE-04 Q3.3 test-only credential grant planning', () => {
  it('primary only', () => expect(planWorkerCredentialGrant(primary).providers).toEqual(['openai']));
  it('deduplicates same-provider fallback', () => {
    expect(planWorkerCredentialGrant({ ...primary, routing: { fallbacks: [{provider:'openai',name:'backup'}] } }).providers).toEqual(['openai']);
  });
  it('includes only configured cross-provider fallback', () => {
    const plan = planWorkerCredentialGrant({ ...primary, routing: { fallbacks: [{provider:'anthropic',name:'backup'}] } });
    expect(plan.providers).toEqual(['openai','anthropic']);
    expect(plan.providers).not.toContain('google');
  });
  it('uses routing authority for OpenRouter free fallback', () => {
    expect(planWorkerCredentialGrant({provider:'openrouter',name:'primary',routing:{freeFallback:true}}).providers).toEqual(['openrouter']);
    expect(planWorkerCredentialGrant({...primary,routing:{freeFallback:true}}).providers).toEqual(['openai']);
  });
  it('preserves fallback order and deduplicates', () => {
    expect(planWorkerCredentialGrant({...primary,routing:{fallbacks:[{provider:'groq',name:'a'},{provider:'anthropic',name:'b'},{provider:'groq',name:'c'}]}}).providers).toEqual(['openai','groq','anthropic']);
  });
  it('fails closed on malformed primary or fallback provider', () => {
    expect(()=>planWorkerCredentialGrant({...primary,provider:'../openai'})).toThrow();
    expect(()=>planWorkerCredentialGrant({...primary,routing:{fallbacks:[{provider:'',name:'x'}]}})).toThrow();
    expect(()=>planWorkerCredentialGrant({...primary,routing:{fallbacks:[{provider:'anthropic',name:''}]}})).toThrow();
  });
  it('rejects unresolved model selection', () => {
    expect(()=>planWorkerCredentialGrant({...primary,selection:{provider:'openai'}} as ModelConfig)).toThrow();
  });
  it('does not permit mutation of the plan', () => {
    const plan=planWorkerCredentialGrant(primary);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.providers)).toBe(true);
  });
});
