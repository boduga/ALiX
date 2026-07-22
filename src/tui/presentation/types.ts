import type { SidebarPanelId } from '../state.js';

export interface TabInfo {
  readonly id: string;
  readonly label: string;
  readonly active: boolean;
  readonly deprecated?: boolean;
}

export interface PanelItem {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly status: 'pending' | 'active' | 'resolved' | 'warning' | 'error' | 'info';
  readonly statusLabel?: string;
  readonly rightLabel?: string;
}

export interface PanelViewModel {
  readonly id: string;
  readonly title: string;
  readonly items: readonly PanelItem[];
  readonly scrollOffset: number;
  readonly focused: boolean;
  readonly totalItems: number;
  readonly visible: boolean;
  readonly kind: 'daemon' | 'approvals' | 'runtime' | 'sops_policy';
}

export interface InputViewModel {
  readonly buffer: string;
  readonly prompt: string;
  readonly cursorPos: number;
  readonly activeTab: string;
  readonly mode: 'neutral' | 'chat' | 'agent';
}

export interface SidebarPanelView {
  readonly kind: SidebarPanelId;
  readonly title: string;
  readonly visible: boolean;
  readonly loading: boolean;
  readonly items: readonly PanelItem[];
  readonly scrollOffset: number;
  readonly focused: boolean;
  readonly totalItems: number;
}

export interface ViewContent {
  readonly mainLines: readonly string[];
  readonly scrollPercent: number;
  readonly sidebarPanels: Readonly<Record<SidebarPanelId, SidebarPanelView>>;
  readonly showInput: boolean;
}

export interface ResourceBar {
  readonly label: string;
  readonly fraction: number;
  readonly value: string;
}

export interface StatusBarViewModel {
  readonly phaseRadios: ReadonlyArray<{ readonly phase: string; readonly active: boolean; readonly label: string }>;
  readonly fields: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly activeTab: string;
}

export interface OperatorViewState {
  readonly tabs: readonly TabInfo[];
  readonly activeTab: string;
  readonly panels: readonly PanelViewModel[];
  readonly input: InputViewModel;
  readonly statusBar: StatusBarViewModel;
  readonly sessionMetadata: {
    readonly version: string;
    readonly mode: string;
    readonly phase: string;
  } | null;
  readonly daemonStatus: {
    readonly running: boolean;
    readonly cpuPercent: number;
    readonly memoryRssBytes: number;
    readonly memoryTotalBytes: number;
    readonly diskUsedBytes: number;
    readonly diskTotalBytes: number;
    readonly pid: number | null;
    readonly uptimeSeconds: number;
  } | null;

  readonly viewContent: ViewContent;
}
