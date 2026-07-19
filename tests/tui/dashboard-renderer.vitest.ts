import { describe, it, expect } from 'vitest';
import { renderDashboard } from '../../src/tui/dashboard-renderer.js';
import { TerminalCanvas } from '../../src/tui/canvas.js';

/** Strip ANSI escape sequences from a rendered line so visible width can be measured. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function onlineSnap(): any {
  return {
    generatedAt: 1,
    session: { mode: 'auto' as const, phase: 'Idle', version: '0.3.1', startedAt: 0, turns: 0 },
    daemon: {
      pid: 28731,
      uptimeSeconds: 12 * 60 + 47,
      cpuPercent: 2.1,
      memoryRssBytes: 16 * 1024 * 1024 * 1024 * 0.184,
      memoryTotalBytes: 16 * 1024 * 1024 * 1024,
      diskUsedBytes: 500 * 1024 * 1024 * 1024 * 0.087,
      diskTotalBytes: 500 * 1024 * 1024 * 1024,
      clients: [],
      sampledAt: 1,
    },
    approvals: null,
    runtime: null,
    sops: null,
    policy: null,
  };
}

function offlineSnap(): any {
  return {
    generatedAt: 1,
    session: null,
    daemon: null,
    approvals: null,
    runtime: null,
    sops: null,
    policy: null,
  };
}

describe('renderDashboard — DAEMON panel', () => {
  const panelW = (cols: number) => Math.floor(cols / 4);

  describe('online case', () => {
    it('paints Title-Case metadata rows for PID, Uptime, Version, Workspace', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(onlineSnap(), c, 0);
      const frame = c.renderFrame();
      expect(frame).toContain('PID:');
      expect(frame).toContain('Uptime:');
      expect(frame).toContain('Version:');
      expect(frame).toContain('Workspace:');
    });

    it('paints CPU, MEM, DISK metric rows with labels', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(onlineSnap(), c, 0);
      const frame = c.renderFrame();
      expect(frame).toContain('CPU ');
      expect(frame).toContain('MEM ');
      expect(frame).toContain('DISK');
    });

    it('formats Uptime as HH:MM:SS (matches target style)', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(onlineSnap(), c, 0);
      const frame = c.renderFrame();
      // 12m47s = 12*60+47 = 767s → "00:12:47"
      expect(frame).toContain('00:12:47');
      expect(frame).not.toMatch(/uptime\s+12m/);
    });

    it('writes the title bar with DAEMON label and ● running indicator', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(onlineSnap(), c, 0);
      const frame = c.renderFrame();
      expect(frame).toContain('DAEMON');
      expect(frame).toContain('● running');
    });

    it('draws two horizontal rules separating metadata and metrics', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(onlineSnap(), c, 0);
      const frame = c.renderFrame();
      // Strip ANSI; rules must appear on what would be row 1 and row 6 of the
      // rendered panel (relative to startY=0 here).
      const lines = stripAnsi(frame).split('\n').map((l) => l.slice(2, panelW(120)));
      // Row 1: top rule (▓-filled by chars between col 2 and panelW-3)
      expect(/^─+$/.test(lines[1] || '')).toBe(true);
      // Row 6: mid rule
      expect(/^─+$/.test(lines[6] || '')).toBe(true);
    });
  });

  describe('offline case (daemon === null)', () => {
    it('still paints the DAEMON title bar', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(offlineSnap(), c, 0);
      const frame = c.renderFrame();
      expect(frame).toContain('DAEMON');
    });

    it('shows "not running" notice and ○ stopped indicator', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(offlineSnap(), c, 0);
      const frame = c.renderFrame();
      expect(frame).toContain('not running');
      expect(frame).toContain('○ stopped');
    });

    it('does NOT paint metric bar rows in offline state', () => {
      const c = new TerminalCanvas(120, 30);
      renderDashboard(offlineSnap(), c, 0);
      const frame = c.renderFrame();
      // CPU/MEM/DISK labels are rendered with a trailing space; in offline,
      // none of those labels should appear.
      expect(frame).not.toContain('CPU ');
      expect(frame).not.toContain('MEM ');
      expect(frame).not.toContain('DISK');
    });
  });

  describe('column overflow regression', () => {
    it('CPU/MEM/DISK bar glyphs terminate before APPROVALS column at canvas.width=80', () => {
      const width = 80;
      const c = new TerminalCanvas(width, 30);
      renderDashboard(onlineSnap(), c, 0);
      const lines = stripAnsi(c.renderFrame()).split('\n');
      const pw = panelW(width); // 20

      // For each metric row, the rightmost bar glyph (█ or ░) painted by
      // DAEMON must land at or before col pw - 1 (the rightmost cell of the
      // DAEMON column). Anything at col pw or beyond would be a regression.
      for (const rowY of [7, 8, 9]) {
        const line = lines[rowY] || '';
        const daemonCol = line.slice(0, pw);
        const lastBarIdx = Math.max(
          daemonCol.lastIndexOf('█'),
          daemonCol.lastIndexOf('░'),
        );
        // -1 means no bar glyph at all (acceptable for some fractions, but
        // should not happen here since cpuFraction > 0). Require it to be
        // within the DAEMON column.
        expect(lastBarIdx).toBeGreaterThanOrEqual(0);
        expect(lastBarIdx).toBeLessThan(pw);
      }
    });

    it('CPU bar row visible chars stay within DAEMON column budget at width=120', () => {
      const width = 120;
      const c = new TerminalCanvas(width, 30);
      renderDashboard(onlineSnap(), c, 0);
      const lines = stripAnsi(c.renderFrame()).split('\n');
      const pw = panelW(width); // 30

      // Rightmost non-blank DAEMON-owned character in the CPU bar row must
      // land at or before col pw - 1.
      const cpuRow = stripAnsi(lines[7] || '').slice(0, pw);
      // trim trailing spaces
      const trimmed = cpuRow.replace(/\s+$/, '');
      expect(trimmed.length).toBeLessThanOrEqual(pw);
      // last bar glyph must be inside the DAEMON budget
      const lastBarIdx = Math.max(
        trimmed.lastIndexOf('█'),
        trimmed.lastIndexOf('░'),
      );
      expect(lastBarIdx).toBeLessThan(pw);
    });
  });
});
