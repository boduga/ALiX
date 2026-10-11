import type { CliRenderer, KeyEvent, PasteEvent } from '@opentui/core';
import type { WorkbenchStore } from '../app/workbench-store.js';
import type { WorkbenchHostPorts } from '../controller/host-intent.js';
import type { SelectionSnapshot } from '../controller/selection-intent.js';
import type { WorkbenchInputSignals } from '../input/input-context.js';
import type { WorkbenchViewState } from '../view-state/types.js';
import { handleOpenTuiKey, handleOpenTuiPaste } from './key-handler.js';
import { mountOpenTuiWorkbenchContent, type ContentState, type OpenTuiWorkbenchContent } from './workbench-content.js';
import { mountOpenTuiWorkbenchLayout, type OpenTuiWorkbenchLayout } from './workbench-layout.js';

type LayoutState = Pick<WorkbenchViewState, 'composer' | 'overlay'>;

export interface OpenTuiHostDeps {
  readonly store: WorkbenchStore;
  readonly layoutState: () => LayoutState;
  readonly contentState: () => ContentState;
  readonly signals: () => WorkbenchInputSignals;
  readonly snapshot: () => SelectionSnapshot | undefined;
  readonly ports: WorkbenchHostPorts;
  readonly coordinationAvailable: boolean;
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
  const ports: WorkbenchHostPorts = {
    ...deps.ports,
    repaint: update,
    syncComposer: () => {},
    setPinnedBottom: () => {},
    setTranscriptMode: () => {},
    anchorTranscriptBottom: () => {},
  };
  const input = {
    store: deps.store,
    signals: deps.signals,
    snapshot: deps.snapshot,
    ports,
    coordinationAvailable: deps.coordinationAvailable,
  };
  const onKey = (key: KeyEvent): void => {
    handleOpenTuiKey(key, input);
  };
  const onPaste = (event: PasteEvent): void => {
    handleOpenTuiPaste(event, input);
  };
  renderer.keyInput.on('keypress', onKey);
  renderer.keyInput.on('paste', onPaste);
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
      content.dispose();
      layout.dispose();
    },
  };
}
