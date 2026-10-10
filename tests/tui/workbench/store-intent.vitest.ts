import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { WorkbenchStore } from '../../../src/interfaces/tui/workbench/app/workbench-store.js';
import { createInitialWorkbenchUiState } from '../../../src/interfaces/tui/workbench/model/ui-state.js';
import { applyWorkbenchStoreIntent } from '../../../src/interfaces/tui/workbench/controller/store-intent.js';

const context = { coordinationAvailable: true };

function store() {
  return new WorkbenchStore(createInitialWorkbenchUiState());
}

describe('applyWorkbenchStoreIntent', () => {
  it('applies composer edits, mirroring the authoritative text', () => {
    const s = store();
    const result = applyWorkbenchStoreIntent(s, { type: 'composer.insert', text: 'hi' }, context);
    assert.equal(s.snapshot().composer.text, 'hi');
    assert.deepEqual(result, { handled: true, repaint: true, syncComposer: true });
  });

  it('re-anchors follow for filtering when following', () => {
    const s = store();
    assert.equal(applyWorkbenchStoreIntent(s, { type: 'transcript.filter', filter: 'tool' }, context).followToBottom, true);
    const paused = new WorkbenchStore({ ...createInitialWorkbenchUiState(), followTail: false });
    assert.equal(applyWorkbenchStoreIntent(paused, { type: 'transcript.filter', filter: 'tool' }, context).followToBottom, undefined);
  });

  it('toggles transcript mode and requests repaint/anchor', () => {
    const s = store();
    const result = applyWorkbenchStoreIntent(s, { type: 'transcript.toggle' }, context);
    assert.equal(s.snapshot().transcriptMode, 'detailed');
    assert.equal(result.transcriptMode, 'detailed');
    assert.equal(result.pinnedBottom, true);
    assert.equal(result.followToBottom, true);
  });

  it('toggles the drawer and resets selection', () => {
    const s = store();
    applyWorkbenchStoreIntent(s, { type: 'drawer.toggle', drawer: 'tasks' }, context);
    assert.equal(s.snapshot().drawer, 'tasks');
    applyWorkbenchStoreIntent(s, { type: 'agent.aggregate' }, context);
    assert.equal(s.snapshot().selectedAgentId, undefined);
  });

  it('reports coordination availability on inspect', () => {
    const unavailable = store();
    applyWorkbenchStoreIntent(unavailable, { type: 'coordination.inspect' }, { coordinationAvailable: false });
    assert.equal(unavailable.snapshot().overlayStack.at(-1), 'coordination');
    assert.equal(unavailable.snapshot().coordination.phase, 'idle');
    assert.match(unavailable.snapshot().coordination.message ?? '', /unavailable/i);
  });

  it('leaves effectful and follow-toggle intents to the host', () => {
    const s = store();
    assert.equal(applyWorkbenchStoreIntent(s, { type: 'turn.submit' }, context).handled, false);
    assert.equal(applyWorkbenchStoreIntent(s, { type: 'transcript.follow.toggle' }, context).handled, false);
    assert.equal(applyWorkbenchStoreIntent(s, { type: 'approval.resolve', decision: 'approved' }, context).handled, false);
  });
});
