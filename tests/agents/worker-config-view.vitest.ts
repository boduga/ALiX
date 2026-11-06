import { describe, expect, it } from 'vitest';
import { projectWorkerConfigView } from '../../src/agents/worker-config-view.js';
import { planWorkerCredentialGrant } from '../../src/agents/credential-grant-planner.js';

const model = {provider:'openai',name:'synthetic'} as const;

describe('GE-04 Q3.4 test-only worker config metadata projection',()=>{
  it('projects only provider, model and authorized provider names',()=>{
    const input = {...model, apiKey:'synthetic-canary', routing:{fallbacks:[{provider:'anthropic',name:'backup'}]}};
    const view=projectWorkerConfigView(input,planWorkerCredentialGrant(input));
    expect(view).toEqual({model:{provider:'openai',name:'synthetic'},allowedProviders:['openai','anthropic']});
    expect(JSON.stringify(view)).not.toContain('synthetic-canary');
    expect(JSON.stringify(view)).not.toContain('apiKey');
  });
  it('rejects missing, malformed and mismatched grants',()=>{
    expect(()=>projectWorkerConfigView(model,{providers:[]})).toThrow();
    expect(()=>projectWorkerConfigView(model,{providers:['google']})).toThrow();
    expect(()=>projectWorkerConfigView(model,{providers:['openai','openai']})).toThrow();
    expect(()=>projectWorkerConfigView(model,{providers:['openai','../google']})).toThrow();
  });
  it('rejects unresolved model selection',()=>{
    expect(()=>projectWorkerConfigView({...model,selection:{provider:'openai'}} as any,{providers:['openai']})).toThrow();
  });
  it('freezes output without retaining mutable provider list',()=>{
    const providers=['openai'];
    const view=projectWorkerConfigView(model,{providers});
    providers.push('google');
    expect(view.allowedProviders).toEqual(['openai']);
    expect(Object.isFrozen(view.model)).toBe(true);
    expect(Object.isFrozen(view.allowedProviders)).toBe(true);
  });
});
