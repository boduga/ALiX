import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionCancelledError } from '../../src/runtime/cancellation-token.js';
import { resumeSession } from '../../src/agent/session/resume.js';
import { buildSessionConversationMessages } from '../../src/agent/session/conversation-history.js';
import { classifyMessageToCategory } from '../../src/run/task-loop/context-helpers.js';
import { TuiApp, type TuiAppOptions } from '../../src/tui/app.js';
import { MockInput, MockOutput } from '../../src/tui/io.js';
import { processTurn } from '../../src/agent/session/turn.js';
import { createSessionState } from '../../src/agent/session/state.js';
import { EventLog } from '../../src/events/event-log.js';
import { MemoryStore } from '../../src/utils/memory/store.js';
import { ScopeTracker } from '../../src/autonomy/scope-tracker.js';
import { MinimalMetrics } from '../../src/kernel/minimal-metrics.js';
import { createContextBudget } from '../../src/config/context-budget.js';
import { ensureEncoder } from '../../src/utils/tokens.js';
import type { ModelAdapter, NormalizedRequest } from '../../src/providers/types.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const firstTask = 'Investigate TUI typing latency in this repository and report findings, without making changes.';
const findings = 'TUI audit found quadratic grapheme segmentation; measured typing latency 46 ms median and 115 ms maximum.';

async function fixture(id: string) {
  const cwd = mkdtempSync(join(tmpdir(), 'alix-continuity-')); roots.push(cwd);
  const sessionDir = join(cwd, '.alix', 'sessions', id); mkdirSync(sessionDir, { recursive: true });
  const log = new EventLog(sessionDir); await log.init();
  const memoryStore = new MemoryStore(join(cwd, 'memory')); await memoryStore.init();
  const requests: NormalizedRequest[] = [];
  const provider: ModelAdapter = {
    id: 'mock', capabilities: { provider: 'mock', model: 'mock', inputTokenLimit: 100000, outputTokenLimit: 16384, supportsTools: true, supportsStreaming: false, supportsStructuredOutput: false, supportsVision: false, parallelToolCalls: false },
    editFormatPreference: 'search_replace', longContextStrategy: 'trimmed_context',
    async complete(request) {
      requests.push(structuredClone(request));
      const text = request.messages.some(msg => msg.role === 'user' && msg.content === firstTask) ? findings : JSON.stringify(request.messages).includes('quadratic grapheme segmentation') ? 'The TUI audit found quadratic segmentation, with 46 ms median typing latency.' : 'Latest coordination run researched the president of Nigeria.';
      return { text, toolCalls: [], finishReason: 'stop', usage: { inputTokens: 100, outputTokens: 40 } };
    },
  };
  await ensureEncoder('cl100k_base');
  const state = createSessionState({ cwd, task: '', sessionId: id, streaming: false, verbose: false, readOnly: true });
  state.initialized = true;
  state.ctx = { sessionId: id, sessionDir, log, provider, config: { models: { default: { provider: 'mock', name: 'mock', streaming: false } }, permissions: { sessionMode: 'auto' }, skills: {}, apiKeys: {} }, toolExecutor: {}, memoryStore, scope: new ScopeTracker() } as any;
  state.session = { sessionId: id, actor: 'system' };
  state.metrics = new MinimalMetrics();
  state.systemPrompt = 'You are an assistant. Answer the current request using available evidence.';
  state.contextBudget = createContextBudget({ contextWindowTokens: 100000 }, { outputRatio: .1, outputFloor: 1000, outputCap: 16384 });
  state.cappedIterations = 2;
  return { state, requests, log };
}

describe('AgentSession conversation continuity through real task loop', () => {
  it('summarizes the preceding TUI audit rather than unrelated global coordination', async () => {
    const { state, requests } = await fixture('continuity-a');
    const first = await processTurn(state, firstTask);
    expect(first.summary).toContain('quadratic grapheme segmentation');
    const nextStart = requests.length;
    const next = await processTurn(state, 'Summarize the findings from that TUI audit.');
    expect(JSON.stringify(requests[nextStart]?.messages)).toContain(firstTask);
    expect(JSON.stringify(requests[nextStart]?.messages)).toContain('quadratic grapheme segmentation');
    expect(next.summary).toContain('TUI audit');
    expect(next.summary).not.toContain('Nigeria');
  });
  it('carries direct replies into subsequent workspace follow-ups and never another session', async () => {
    const { state, requests } = await fixture('direct-history');
    const complete = vi.fn(async (request: NormalizedRequest) => {
      requests.push(structuredClone(request));
      return { text: 'Quick keys bloom / Cyan panes answer softly / Slow loops rest tonight', toolCalls: [], finishReason: 'stop' as const };
    });
    state.config.chatProvider = { ...state.ctx.provider, complete };
    const direct = await processTurn(state, 'Write a haiku about TUI responsiveness.');
    expect(direct.reason).toBe('direct');
    const before = requests.length;
    await processTurn(state, 'Summarize that haiku in the context of this repository.');
    expect(JSON.stringify(requests[before]?.messages)).toContain('Quick keys bloom');
    const other = await fixture('different-session');
    await processTurn(other.state, firstTask);
    expect(JSON.stringify(other.requests)).not.toContain('Quick keys bloom');
  });

  it('retains truthful cancellation instead of an unfinished request with no outcome', async () => {
    const { state, requests } = await fixture('cancel-history');
    const healthy = state.ctx.provider.complete;
    state.ctx.provider.complete = async () => { throw new ExecutionCancelledError('operator cancelled'); };
    await expect(processTurn(state, firstTask)).rejects.toThrow('operator cancelled');
    state.ctx.provider.complete = healthy;
    await processTurn(state, 'What happened to the previous TUI audit in this repository?');
    expect(JSON.stringify(requests[0]?.messages)).toMatch(/Cancelled|cancelled/);
    expect(JSON.stringify(requests[0]?.messages)).not.toContain('Task completed');
  });

  it('uses only bounded public conversation from resumed state, not tool or private reasoning', async () => {
    const { state, requests } = await fixture('resumed-history');
    state.config.store = { load: async () => ({ messages: [
      { role: 'user', content: firstTask },
      { role: 'assistant', content: '<think>private-secret</think>' + findings, reasoning: 'hidden-internal' },
      { role: 'user', content: '<tool_result id="x">tool-garbage</tool_result>' },
    ], toolHistory: [], task: firstTask, completed: false, updatedAt: new Date().toISOString() }) } as any;
    await resumeSession(state, 'resumed-history');
    await processTurn(state, 'Summarize the findings from that TUI audit.');
    const sent = JSON.stringify(requests[0]?.messages);
    expect(sent).toContain('quadratic grapheme segmentation');
    expect(sent).not.toMatch(/private-secret|hidden-internal|tool-garbage/);
    expect(requests[0]?.messages.at(-1)).toMatchObject({ role: 'user', content: 'Summarize the findings from that TUI audit.' });
  });

  it('bounds count, per-message size and encoded total without promoting stale objectives', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({ role: i % 2 ? 'assistant' as const : 'user' as const, content: `old-${i}:` + '\\'.repeat(20000) }));
    const messages = buildSessionConversationMessages(history, 'Current read-only summary request');
    expect((messages[0]!.content as string).length).toBeLessThanOrEqual(24000);
    const entries = JSON.parse((messages[0]!.content as string).slice((messages[0]!.content as string).indexOf('[{')));
    expect(entries).toHaveLength(2);
    expect(entries.map((entry: any) => entry.content).join(' ')).toContain('old-98');
    expect(entries.map((entry: any) => entry.content).join(' ')).toContain('old-99');
    expect(entries.every((entry: any) => JSON.stringify(entry.content).length <= 8000)).toBe(true);
    expect(classifyMessageToCategory(messages[0]!, 0, false)).toBe('recent_conversation');
    expect(classifyMessageToCategory(messages[1]!, 1, true)).toBe('current_task');
    const countBound = buildSessionConversationMessages(Array.from({length:100},(_,i)=>({role:'user',content:String(i)})), 'now');
    expect(JSON.parse((countBound[0]!.content as string).slice((countBound[0]!.content as string).indexOf('[{')))).toHaveLength(24);
  });

  it('excludes resumed tool/runtime nudges and private payloads but preserves actual public requests', () => {
    const messages = buildSessionConversationMessages([
      { role: 'user', content: 'What did the TUI audit find?' },
      { role: 'assistant', content: findings },
      ...['[Verification Failed] internal', '[Progress checkpoint] internal', 'Your previous response needs correction', 'Your response promises another action, so it is not a final answer', 'No tool calls were detected', 'Tools completed. Write a concise summary', 'You called tools but did not finish', 'Your last coordination run needs evidence', 'You have 2 iterations left', 'Continue rendering internal'].map(content => ({role:'user' as const,content})),
      { role: 'assistant', content: '<analysis>hidden-analysis</analysis>' },
      { role: 'assistant', content: findings, toolCalls: [{name:'alix_shell_run'}] } as any,
    ], 'Summarize that');
    const sent = JSON.stringify(messages);
    expect(sent).not.toMatch(/internal|hidden-analysis|alix_shell_run|correction/);
    expect(sent).toContain('What did the TUI audit find?');
    expect(sent).toContain(findings);
  });

  it('carries prior findings through real TUI queued FIFO processTurn calls', async () => {
    const { state, requests } = await fixture('queued-history');
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const complete = state.ctx.provider.complete;
    let started = false;
    state.ctx.provider.complete = async request => {
      if (!started) { started = true; await gate; }
      return complete(request);
    };
    const snapshot = { generatedAt: 1, session: { mode:'auto', phase:'Idle', version:'test', startedAt:1, turns:0 }, daemon:null,approvals:null,runtime:null,sops:null,policy:null,cwd:state.config.cwd };
    const submitted: string[] = [];
    const app = new TuiApp({ builder:{build:async()=>snapshot,buildSync:()=>snapshot}, daemonMetrics:{start:()=>{},stop:async()=>{}}, input:new MockInput(),output:new MockOutput(),workbenchEnabled:true,
      agentSession:{processTurn:async(text:string)=>{submitted.push(text);return processTurn(state,text);}} } as unknown as TuiAppOptions);
    // This regression owns queued runtime context, not paint performance.
    // Keep real raw input/controller/loop while isolating presentation work.
    vi.spyOn((app as any).framePainter, 'paintFullFrame').mockImplementation(() => {});
    app.getStateForTest().lastSnapshot = snapshot as any;
    app.getStateForTest().activeTab = 'agent';
    const raw = (text:string) => { for(const character of text) (app as any).handleRaw(Buffer.from(character)); };
    raw(firstTask); raw('\r');
    await vi.waitFor(()=>expect(started).toBe(true));
    const follow1 = 'Summarize the findings from that TUI audit.';
    const follow2 = 'Explain that TUI latency measurement in this repository.';
    raw(follow1);raw('\r');raw(follow2);raw('\r');
    expect(app.getWorkbenchStateForTest().queuedMessages).toHaveLength(2);
    release();
    await vi.waitFor(()=>expect(submitted).toEqual([firstTask,follow1,follow2]),{timeout:5000});
    await vi.waitFor(()=>expect(state.messages.filter(msg=>msg.role==='assistant')).toHaveLength(3),{timeout:5000});
    for(const follow of [follow1,follow2]) {
      const request = requests.find(req=>req.messages.some(msg=>msg.role==='user'&&msg.content===follow));
      expect(JSON.stringify(request?.messages)).toContain('quadratic grapheme segmentation');
    }
    expect(app.getWorkbenchStateForTest().queuedMessages).toHaveLength(0);
    await vi.waitFor(() => expect((app as any).sessionDispatchActive).toBe(false), { timeout: 5000 });
  });

  it('records a grounded-route request/result once for the next foreground objective', async () => {
    const module = await import('../../src/runtime/governed-route-executor.js');
    const governed = vi.spyOn(module, 'executeRouteGoverned').mockResolvedValue({ result: findings } as any);
    try {
      const { state, requests } = await fixture('grounded-history');
      const result = await processTurn(state, 'Search the web for the current president of Nigeria.');
      expect(result.reason).toBe('grounded_chat');
      expect(state.messages).toHaveLength(2);
      expect(state.messages.map(msg=>msg.content)).toEqual(['Search the web for the current president of Nigeria.', findings]);
      await processTurn(state, 'Summarize that result for this repository.');
      expect(JSON.stringify(requests[0]?.messages)).toContain(findings);
    } finally { governed.mockRestore(); }
  });

  it('explicit continue adopts the latest substantive objective, never the first stale task', async () => {
    const { state } = await fixture('latest-objective');
    await processTurn(state, firstTask);
    const later = 'Create report.md with the TUI audit findings and test the changed code.';
    await processTurn(state, later);
    expect(state.sessionGoal).toBe(later);
    await processTurn(state, 'continue');
    expect(state.sessionGoal).toBe(later);
    expect(state.currentTask).toBe('continue');
  });

  it('resumed continue resolves the latest public objective while excluding runtime prompts', async () => {
    const { state } = await fixture('resume-objective');
    const later = 'Review this repository without changing files.';
    state.messages = [{role:'user',content:firstTask},{role:'assistant',content:findings},{role:'user',content:later},{role:'assistant',content:'Review unfinished'}, {role:'user',content:'Your response promises another action, so it is not a final answer'}];
    await processTurn(state, 'continue');
    expect(state.sessionGoal).toBe(later);
    expect(state.currentTask).toBe('continue');
  });

  it.each([true, false])('resuming onto initialized state never keeps another cached goal (messages: %s)', hasMessages => {
    return (async () => {
      const { state } = await fixture('resumed-owned-objective');
      state.sessionGoal = 'Create unrelated old-session secret.md';
      const current = 'Review this repository without changing files.';
      state.config.store = { load: async () => ({ messages: hasMessages ? [{role:'user',content:current},{role:'assistant',content:'Review pending'}] : [], toolHistory:[],task:current,completed:false,updatedAt:new Date().toISOString() }) } as any;
      await resumeSession(state, 'resumed-owned-objective');
      await processTurn(state, 'continue');
      expect(state.sessionGoal).toBe(current);
    })();
  });

});
