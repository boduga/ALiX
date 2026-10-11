import type { OpenTuiKey } from './input.js';
import { pasteIntent, routeOpenTuiKey } from './input.js';
import type { WorkbenchStore } from '../app/workbench-store.js';
import { buildWorkbenchInputContext, type WorkbenchInputSignals } from '../input/input-context.js';
import { applyWorkbenchIntent } from '../controller/intent.js';
import type { WorkbenchHostPorts } from '../controller/host-intent.js';
import type { SelectionSnapshot } from '../controller/selection-intent.js';

export interface OpenTuiInputDeps {
  readonly store: WorkbenchStore;
  readonly signals: () => WorkbenchInputSignals;
  readonly snapshot: () => SelectionSnapshot | undefined;
  readonly ports: WorkbenchHostPorts;
  readonly coordinationAvailable: boolean;
}

function apply(deps: OpenTuiInputDeps, intent: Parameters<typeof applyWorkbenchIntent>[1]): boolean {
  return applyWorkbenchIntent(deps.store, intent, {
    snapshot: deps.snapshot(),
    ports: deps.ports,
    coordinationAvailable: deps.coordinationAvailable,
  });
}

export function handleOpenTuiKey(event: OpenTuiKey, deps: OpenTuiInputDeps): boolean {
  const context = buildWorkbenchInputContext(deps.store.snapshot(), deps.signals());
  return apply(deps, routeOpenTuiKey(event, context));
}

export function handleOpenTuiPaste(event: Parameters<typeof pasteIntent>[0], deps: OpenTuiInputDeps): boolean {
  return apply(deps, pasteIntent(event));
}
