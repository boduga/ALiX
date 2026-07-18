import type { TuiView } from './types.js';
import { ApprovalsView } from './approvals-view.js';
import { ChatView } from './chat-view.js';
import { DaemonView } from './daemon-view.js';
import { PolicyView } from './policy-view.js';
import { RuntimeView } from './runtime-view.js';
import { SopsView } from './sops-view.js';

/**
 * Singleton view instances, keyed by TabId.
 * Created once and reused across tab switches.
 */
const _views: Record<string, TuiView> = {
  approvals: new ApprovalsView(),
  chat: new ChatView(),
  daemon: new DaemonView(),
  policy: new PolicyView(),
  runtime: new RuntimeView(),
  sops: new SopsView(),
};

export function getView(id: string): TuiView | undefined {
  return _views[id];
}

export function getAllViews(): readonly TuiView[] {
  return Object.values(_views);
}

export { ApprovalsView, ChatView, DaemonView, PolicyView, RuntimeView, SopsView };
export type { TuiView, ViewRenderResult, ViewRenderContext, ViewInputContext, ViewAction } from './types.js';
