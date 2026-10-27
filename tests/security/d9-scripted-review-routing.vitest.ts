import { afterEach, describe, expect, it } from 'vitest';
import { ScriptedMockProvider, type ScriptedScenario } from '../../src/operations/evals/providers/scripted-mock-provider.js';
import { clearScriptedScenario, setScriptedScenario, withScriptedScenario, scriptedMockCarrier } from '../../src/operations/evals/providers/scripted-mock-carrier.js';
import { reviewCoordinationResult } from '../../src/agents/coordination-objective-review.js';

const worker: ScriptedScenario = { steps: [
  { kind: 'tool', tool: 'file.create', args: { path: 'docs/d9-receipt.txt', content: 'D9-APPROVED' } },
  { kind: 'text', text: 'Done.' },
] };
const verdict = (satisfied: boolean): ScriptedScenario => ({ steps: [{ kind: 'text', text: JSON.stringify({
  satisfied, summary: satisfied ? 'The persisted receipt has the requested content.' : 'The requested content is wrong.',
  gaps: satisfied ? [] : ['Receipt content does not match the objective'],
}) }] });
afterEach(() => clearScriptedScenario());
async function review(provider: ScriptedMockProvider) {
  return reviewCoordinationResult({
    result: { id: 'worker-id', role: 'worker', status: 'success', findings: [{ type: 'summary', content: 'Done.', confidence: 'medium' }], events: [] },
    objective: 'Create docs/d9-receipt.txt containing D9-APPROVED', mutatedPaths: ['docs/d9-receipt.txt'], evidence: [], provider,
    readArtifacts: async () => [{ path: 'docs/d9-receipt.txt', content: 'D9-APPROVED' }],
  });
}
describe('D9 scripted worker/reviewer routing', () => {
  it('a separate global verdict survives the worker invocation-scoped script', async () => {
    setScriptedScenario(verdict(true));
    const cachedProvider = new ScriptedMockProvider();
    await withScriptedScenario(worker, async () => {
      expect((await cachedProvider.complete({ systemPrompt: 'Fixture worker', messages: [] })).toolCalls).toHaveLength(1);
      expect((await cachedProvider.complete({ systemPrompt: 'Fixture worker', messages: [] })).text).toBe('Done.');
    });
    expect(scriptedMockCarrier.calls).toBe(0);
    expect((await review(cachedProvider)).status).toBe('success');
    expect(scriptedMockCarrier.calls).toBe(1);
  });
  it('reproduces the original rejection when the global fixture also contains worker tools', async () => {
    setScriptedScenario(worker);
    const cachedProvider = new ScriptedMockProvider();
    await withScriptedScenario(worker, async () => {
      await cachedProvider.complete({ systemPrompt: 'Fixture worker', messages: [] }); await cachedProvider.complete({ systemPrompt: 'Fixture worker', messages: [] });
    });
    const result = await review(cachedProvider);
    expect(result.status).toBe('partial');
    expect(result.error).toContain('Reviewer requested tools instead of returning a verdict');
  });
  it('a negative review still rejects an existing receipt', async () => {
    setScriptedScenario(verdict(false));
    const result = await review(new ScriptedMockProvider());
    expect(result.status).toBe('partial');
    expect(result.error).toContain('Receipt content does not match the objective');
  });
});
