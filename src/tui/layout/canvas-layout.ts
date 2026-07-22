export interface TerminalDimensions {
  readonly columns: number;
  readonly rows: number;
}

export interface CanvasGeometry {
  readonly dims: TerminalDimensions;
  readonly headerH: number;
  readonly footerH: number;
  readonly bodyH: number;
  readonly leftW: number;
  readonly rightW: number;
  readonly dividerX: number;
  readonly perPanelH: number;
  readonly panelCount: number;
}

const SPLIT_RATIO = 0.75;
const HEADER_H = 3;
const FOOTER_H = 3;
const DEFAULT_PANEL_H = 14;

export class CanvasLayoutEngine {
  compute(dims: TerminalDimensions, panelCount: number = 4): CanvasGeometry {
    const leftW = Math.max(40, Math.floor(dims.columns * SPLIT_RATIO));
    const rightW = Math.max(20, dims.columns - leftW - 1);
    const dividerX = leftW;
    const bodyH = Math.max(1, dims.rows - HEADER_H - FOOTER_H);
    const available = Math.max(1, bodyH);
    const target = DEFAULT_PANEL_H * panelCount;
    const perPanelH = target <= available
      ? DEFAULT_PANEL_H
      : Math.max(5, Math.floor(available / panelCount));
    return { dims, headerH: HEADER_H, footerH: FOOTER_H, bodyH, leftW, rightW, dividerX, perPanelH, panelCount };
  }
}
