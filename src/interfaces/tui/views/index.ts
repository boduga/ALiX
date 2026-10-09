import type { TuiView } from './types.js';
import { AgentView } from './agent-view.js';
import { ApprovalsView } from './approvals-view.js';
import { CapabilitiesView } from '../capabilities/capabilities-view.js';
import { ChatView } from './chat-view.js';
import { DashboardView } from './dashboard-view.js';
import { DaemonView } from './daemon-view.js';
import { EvolutionView } from '../evolution/evolution-view.js';
import { PolicyView } from './policy-view.js';
import { RuntimeView } from './runtime-view.js';
import { SopsView } from './sops-view.js';

/**
 * Singleton view instances, keyed by TabId.
 * Created once and reused across tab switches.
 */
const _views: Record<string, TuiView> = {
  dashboard: new DashboardView(),
  agent: new AgentView(),
  approvals: new ApprovalsView(),
  capabilities: new CapabilitiesView(),
  chat: new ChatView(),
  daemon: new DaemonView(),
  evolution: new EvolutionView(),
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

export { AgentView, ApprovalsView, CapabilitiesView, ChatView, DashboardView, DaemonView, EvolutionView, PolicyView, RuntimeView, SopsView };
export type { TuiView, ViewRenderResult, ViewRenderContext, ViewInputContext, ViewAction } from './types.js';
