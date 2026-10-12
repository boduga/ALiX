import type { CliRenderer, KeyEvent, MouseEvent, PasteEvent } from '@opentui/core';
import { pasteText, translateKeyEvent } from './input.js';
import { mountOpenTuiWorkbenchContent, type ContentState, type OpenTuiClickAction, type OpenTuiWorkbenchContent } from './workbench-content.js';
import { mountOpenTuiWorkbenchLayout, type LayoutState, type OpenTuiWorkbenchLayout } from './workbench-layout.js';

export interface OpenTuiHostDeps {
  readonly layoutState: () => LayoutState;
  readonly contentState: () => ContentState;
  readonly onKey: (key: string) => void;
  readonly onPaste: (text: string) => void;
  readonly onClick: (action: OpenTuiClickAction) => void;
}

export interface OpenTuiWorkbenchHost {
  readonly layout: OpenTuiWorkbenchLayout;
  readonly content: OpenTuiWorkbenchContent;
  update(): void;
  dispose(): void;
}

export function mountOpenTuiWorkbenchHost(renderer: CliRenderer, deps: OpenTuiHostDeps): OpenTuiWorkbenchHost {
  const layout = mountOpenTuiWorkbenchLayout(renderer, deps.layoutState());
  const content = mountOpenTuiWorkbenchContent(renderer, layout, deps.contentState());
  layout.regions.transcript.onMouseScroll = (event): void => {
    if (event.scroll?.direction === 'up') deps.onKey('ArrowUp');
    else if (event.scroll?.direction === 'down') deps.onKey('ArrowDown');
    else return;
    event.preventDefault();
  };
  const clickAllowed = (): boolean => {
    const state = deps.contentState();
    return state.approval.length === 0 && state.overlay.stack.length === 0;
  };
  let pressedAt: { x: number; y: number } | undefined;
  let dragged = false;
  layout.shell.onMouseDown = (event): void => {
    pressedAt = event.button === 0 ? { x: event.x, y: event.y } : undefined;
    dragged = false;
  };
  layout.shell.onMouseUp = (): void => { pressedAt = undefined; };
  layout.shell.onMouseDrag = (): void => { dragged = true; };
  const isClick = (event: MouseEvent): boolean =>
    event.button === 0 && !dragged && pressedAt?.x === event.x && pressedAt.y === event.y;
  layout.regions.roster.onMouseUp = (event): void => {
    if (!isClick(event) || !clickAllowed()) return;
    const action = content.rosterClickTarget(event.y - content.roster.screenY);
    if (!action) return;
    deps.onClick(action);
    event.preventDefault();
  };
  layout.regions.overlay.onMouseUp = (event): void => {
    if (!isClick(event) || !clickAllowed()) return;
    const action = content.rosterClickTarget(event.y - content.overlay.screenY, 'overlay');
    if (!action) return;
    deps.onClick(action);
    event.preventDefault();
  };
  layout.regions.transcript.onMouseUp = (event): void => {
    if (!isClick(event) || !clickAllowed()) return;
    const action = content.transcriptClickTarget(event.x - content.transcript.screenX, event.y - content.transcript.screenY)
      ?? { type: 'focus.set', focus: 'transcript' };
    deps.onClick(action);
    event.preventDefault();
  };
  layout.regions.composer.onMouseUp = (event): void => {
    if (!isClick(event) || !clickAllowed()) return;
    deps.onClick({ type: 'focus.set', focus: 'composer' });
    event.preventDefault();
  };
  const update = (): void => {
    layout.update(deps.layoutState());
    content.update(deps.contentState());
    renderer.requestRender();
  };
  const onKey = (event: KeyEvent): void => {
    const key = translateKeyEvent(event);
    if (key !== null) deps.onKey(key);
  };
  const onPaste = (event: PasteEvent): void => {
    deps.onPaste(pasteText(event));
  };
  const onResize = (): void => {
    update();
  };
  renderer.keyInput.on('keypress', onKey);
  renderer.keyInput.on('paste', onPaste);
  renderer.on('resize', onResize);
  update();
  let disposed = false;
  return {
    layout,
    content,
    update,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      renderer.keyInput.off('keypress', onKey);
      renderer.keyInput.off('paste', onPaste);
      renderer.off('resize', onResize);
      content.dispose();
      layout.dispose();
    },
  };
}
