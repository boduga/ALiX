import type { WorkbenchAgentState } from './agent-roster.js';

export type WorkbenchColorMode = 'truecolor' | 'ansi16' | 'monochrome';
export type WorkbenchGlyphMode = 'unicode' | 'ascii';

export interface WorkbenchPreviewPalette {
  readonly background: string;
  readonly foreground: string;
  readonly muted: string;
  readonly cyan: string;
  readonly green: string;
  readonly yellow: string;
  readonly purple: string;
  readonly teal: string;
  readonly red: string;
  readonly divider: string;
  readonly selectionFill: string;
  readonly badgeText: string;
  readonly badgeFill: string;
}

export interface WorkbenchPreviewGlyphs {
  readonly topLeft: string;
  readonly topRight: string;
  readonly bottomLeft: string;
  readonly bottomRight: string;
  readonly horizontal: string;
  readonly vertical: string;
  readonly idle: string;
  readonly active: string;
  readonly waiting: string;
  readonly completed: string;
  readonly failed: string;
  readonly cancelled: string;
  readonly success: string;
  readonly separator: string;
}

export interface WorkbenchPreviewTheme {
  readonly colorMode: WorkbenchColorMode;
  readonly glyphMode: WorkbenchGlyphMode;
  readonly palette: WorkbenchPreviewPalette;
  readonly glyphs: WorkbenchPreviewGlyphs;
}

const PALETTES: Readonly<Record<WorkbenchColorMode, WorkbenchPreviewPalette>> = Object.freeze({
  truecolor: Object.freeze({
    background: '\x1b[48;2;8;21;27m',
    foreground: '\x1b[38;2;230;237;243m',
    muted: '\x1b[38;2;156;180;202m',
    cyan: '\x1b[38;2;6;201;239m',
    green: '\x1b[38;2;61;244;81m',
    yellow: '\x1b[38;2;255;198;61m',
    purple: '\x1b[38;2;177;105;238m',
    teal: '\x1b[38;2;8;227;181m',
    red: '\x1b[38;2;255;99;110m',
    divider: '\x1b[38;2;84;123;145m',
    selectionFill: '\x1b[48;2;6;49;61m',
    badgeText: '\x1b[38;2;8;21;27m',
    badgeFill: '\x1b[48;2;6;201;239m',
  }),
  ansi16: Object.freeze({
    background: '\x1b[40m', foreground: '\x1b[97m', muted: '\x1b[37m',
    cyan: '\x1b[96m', green: '\x1b[92m', yellow: '\x1b[93m',
    purple: '\x1b[95m', teal: '\x1b[36m', red: '\x1b[91m',
    divider: '\x1b[90m', selectionFill: '\x1b[44m',
    badgeText: '\x1b[30m', badgeFill: '\x1b[106m',
  }),
  monochrome: Object.freeze({
    background: '', foreground: '', muted: '', cyan: '', green: '',
    yellow: '', purple: '', teal: '', red: '', divider: '',
    selectionFill: '', badgeText: '', badgeFill: '',
  }),
});

const GLYPHS: Readonly<Record<WorkbenchGlyphMode, WorkbenchPreviewGlyphs>> = Object.freeze({
  unicode: Object.freeze({
    topLeft: '╭', topRight: '╮', bottomLeft: '╰', bottomRight: '╯',
    horizontal: '─', vertical: '│', idle: '○', active: '●', waiting: '●',
    completed: '●', failed: '✗', cancelled: '○', success: '✓', separator: '•',
  }),
  ascii: Object.freeze({
    topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+',
    horizontal: '-', vertical: '|', idle: 'o', active: '*', waiting: '!',
    completed: '+', failed: 'x', cancelled: '-', success: '+', separator: '.',
  }),
});

/** Explicit capabilities keep terminal detection outside presentation models. */
export function getWorkbenchPreviewTheme(
  colorMode: WorkbenchColorMode = 'truecolor',
  glyphMode: WorkbenchGlyphMode = 'unicode',
): WorkbenchPreviewTheme {
  return Object.freeze({ colorMode, glyphMode, palette: PALETTES[colorMode], glyphs: GLYPHS[glyphMode] });
}

interface AgentPresentationSpec {
  readonly label: string;
  readonly color: keyof Pick<WorkbenchPreviewPalette, 'muted' | 'green' | 'yellow' | 'purple' | 'red'>;
  readonly glyph: keyof Pick<WorkbenchPreviewGlyphs, 'idle' | 'active' | 'waiting' | 'completed' | 'failed' | 'cancelled'>;
}

const AGENT_PRESENTATIONS = {
  queued: { label: 'QUEUED', color: 'muted', glyph: 'idle' },
  starting: { label: 'STARTING', color: 'green', glyph: 'idle' },
  thinking: { label: 'RUNNING', color: 'green', glyph: 'active' },
  tool_running: { label: 'RUNNING', color: 'green', glyph: 'active' },
  waiting: { label: 'WAITING', color: 'yellow', glyph: 'waiting' },
  waiting_approval: { label: 'APPROVAL', color: 'yellow', glyph: 'waiting' },
  waiting_dependency: { label: 'WAITING', color: 'yellow', glyph: 'waiting' },
  verifying: { label: 'VERIFYING', color: 'green', glyph: 'active' },
  completed: { label: 'COMPLETED', color: 'purple', glyph: 'completed' },
  partial: { label: 'PARTIAL', color: 'yellow', glyph: 'completed' },
  failed: { label: 'FAILED', color: 'red', glyph: 'failed' },
  cancelling: { label: 'CANCELLING', color: 'yellow', glyph: 'active' },
  cancelled: { label: 'CANCELLED', color: 'muted', glyph: 'cancelled' },
} as const satisfies Record<WorkbenchAgentState, AgentPresentationSpec>;

/** Lifecycle text stays visible when colors or Unicode are unavailable. */
export function getWorkbenchAgentPresentation(state: WorkbenchAgentState, theme: WorkbenchPreviewTheme): {
  readonly label: string;
  readonly color: string;
  readonly glyph: string;
} {
  const spec = AGENT_PRESENTATIONS[state];
  return { label: spec.label, color: theme.palette[spec.color], glyph: theme.glyphs[spec.glyph] };
}
