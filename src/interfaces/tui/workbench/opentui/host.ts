import type { CliRenderer, KeyEvent, PasteEvent } from '@opentui/core';
import { pasteText, translateKeyEvent } from './input.js';
import { mountOpenTuiWorkbenchContent, type ContentState, type OpenTuiWorkbenchContent } from './workbench-content.js';
import { mountOpenTuiWorkbenchLayout, type LayoutState, type OpenTuiWorkbenchLayout } from './workbench-layout.js';

export interface OpenTuiHostDeps {
  readonly layoutState: () => LayoutState;
  readonly contentState: () => ContentState;
  readonly onKey: (key: string) => void;
  readonly onPaste: (text: string) => void;
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
