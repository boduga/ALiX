import { describe, expect, it } from 'vitest';
import { routeWorkbenchInput } from '../../../src/tui/workbench/input/input-router.js';

const context = (overrides: Partial<Parameters<typeof routeWorkbenchInput>[1]> = {}) => ({
  turnActive: false,
  composerText: 'do work',
  slashActive: false,
  approvalPending: false,
  overlayOpen: false,
  transcriptMode: 'compact' as const,
  drawer: 'closed' as const,
  focus: 'composer' as const,
  ...overrides,
});

describe('routeWorkbenchInput', () => {
  it.each(['Shift+Enter', 'Backspace', 'Delete', 'Ctrl+o', 'Ctrl+a', 'Ctrl+t', 'Shift+Tab', 'Enter', 'Tab'])('blocks %s behind diagnostic overlays', (key) => {
    expect(routeWorkbenchInput(key, context({ overlayOpen: true }))).toEqual({ type: 'unhandled' });
  });

  it('keeps authoritative approval decisions available above diagnostics', () => {
    expect(routeWorkbenchInput('a', context({ overlayOpen: true, approvalPending: true }))).toEqual({ type: 'approval.resolve', decision: 'approved' });
    expect(routeWorkbenchInput('d', context({ overlayOpen: true, approvalPending: true }))).toEqual({ type: 'approval.resolve', decision: 'denied' });
  });
  it('submits while idle and queues while a turn is active', () => {
    expect(routeWorkbenchInput('Enter', context())).toEqual({ type: 'turn.submit' });
    expect(routeWorkbenchInput('Enter', context({ turnActive: true }))).toEqual({ type: 'turn.queue' });
  });

  it('reserves Shift+Enter for a composer newline', () => {
    expect(routeWorkbenchInput('Shift+Enter', context())).toEqual({ type: 'composer.insert', text: '\n' });
  });

  it('routes Delete to forward composer deletion', () => {
    expect(routeWorkbenchInput('Delete', context())).toEqual({ type: 'composer.delete' });
  });

  it.each([
    ['ArrowLeft', 'left'],
    ['ArrowRight', 'right'],
    ['Home', 'start'],
    ['End', 'end'],
  ] as const)('routes %s to composer movement', (key, direction) => {
    expect(routeWorkbenchInput(key, context())).toEqual({ type: 'composer.move', direction });
  });

  it.each(['\u{1f469}\u200d\u{1f4bb}', `e\u0301`])('routes printable grapheme %s to the composer', (grapheme) => {
    expect(routeWorkbenchInput(grapheme, context())).toEqual({ type: 'composer.insert', text: grapheme });
  });

  it('routes slash submission and Workbench drawer shortcuts by context', () => {
    expect(routeWorkbenchInput('Enter', context({ slashActive: true }))).toEqual({ type: 'slash.submit' });
    expect(routeWorkbenchInput('Ctrl+a', context())).toEqual({ type: 'drawer.toggle', drawer: 'agents' });
    expect(routeWorkbenchInput('Ctrl+t', context())).toEqual({ type: 'drawer.toggle', drawer: 'tasks' });
  });

  it('gives an open focused drawer ownership of navigation and Escape', () => {
    const drawer = context({ drawer: 'agents', focus: 'drawer' });
    expect(routeWorkbenchInput('ArrowUp', drawer)).toEqual({ type: 'drawer.move', direction: -1 });
    expect(routeWorkbenchInput('j', drawer)).toEqual({ type: 'drawer.move', direction: 1 });
    expect(routeWorkbenchInput('Escape', drawer)).toEqual({ type: 'drawer.close' });
    expect(routeWorkbenchInput('j', context({ drawer: 'tasks', focus: 'drawer' }))).toEqual({ type: 'drawer.move', direction: 1 });
    expect(routeWorkbenchInput('[', drawer)).toEqual({ type: 'run.move', direction: -1 });
    expect(routeWorkbenchInput(']', drawer)).toEqual({ type: 'run.move', direction: 1 });
    expect(routeWorkbenchInput('Enter', drawer)).toEqual({ type: 'agentRoster.toggle' });
  });

  it('does not submit an empty composer', () => {
    expect(routeWorkbenchInput('Enter', context({ composerText: '  ' }))).toEqual({ type: 'unhandled' });
  });

  it('routes approval and permission actions before printable composer input', () => {
    expect(routeWorkbenchInput('a', context({ approvalPending: true }))).toEqual({ type: 'approval.resolve', decision: 'approved' });
    expect(routeWorkbenchInput('d', context({ approvalPending: true }))).toEqual({ type: 'approval.resolve', decision: 'denied' });
    expect(routeWorkbenchInput('Shift+Tab', context())).toEqual({ type: 'permission.cycle' });
  });

  it('closes an overlay before cancelling foreground work', () => {
    expect(routeWorkbenchInput('Escape', context({ overlayOpen: true, turnActive: true }))).toEqual({ type: 'overlay.close' });
    expect(routeWorkbenchInput('x', context({ overlayOpen: true }))).toEqual({ type: 'unhandled' });
  });
});
