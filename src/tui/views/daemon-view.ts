import { writeRowsToCanvas } from '../canvas.js';
import type { DaemonMetricsSnapshot } from '../daemon-metrics-collector.js';
import type { TuiView, ViewRenderContext, TerminalDimensions } from './types.js';

const NO_DATA = '○ not running';
const BAR_WIDTH = 24;

function renderBar(percent: number, width = BAR_WIDTH): string {
  const pct = Math.max(0, Math.min(100, percent));
  const filled = Math.round((pct / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + `] ${pct.toFixed(0)}%`;
}

export class DaemonView implements TuiView {
  readonly id = 'daemon' as const;

  render(ctx: ViewRenderContext): { rows: string[] } {
    const { snap, dimensions } = ctx;
    const d: DaemonMetricsSnapshot | null = snap.daemon;
    const rows: string[] = [];
    rows.push('DAEMON');

    if (!d) {
      rows.push(NO_DATA);
      return { rows };
    }

    rows.push(`  pid:        ${d.pid}`);
    rows.push(`  uptime:     ${formatUptime(d.uptimeSeconds)}`);
    if (snap.session?.version) {
      rows.push(`  version:    ${snap.session.version}`);
    }
    rows.push('');
    rows.push(`  cpu:        ${renderBar(d.cpuPercent)}`);
    const memPct = d.memoryTotalBytes > 0 ? (d.memoryRssBytes / d.memoryTotalBytes) * 100 : 0;
    rows.push(`  memory:     ${renderBar(memPct)}  (${formatBytes(d.memoryRssBytes)} / ${formatBytes(d.memoryTotalBytes)})`);
    const diskPct = d.diskTotalBytes > 0 ? (d.diskUsedBytes / d.diskTotalBytes) * 100 : 0;
    rows.push(`  disk:       ${renderBar(diskPct)}  (${formatBytes(d.diskUsedBytes)} / ${formatBytes(d.diskTotalBytes)})`);
    rows.push('');
    rows.push(`  clients:    ${d.clients.length}`);
    rows.push(`  sampled:    ${new Date(d.sampledAt).toISOString()}`);

    void dimensions;

    if (ctx.canvas) {
      writeRowsToCanvas(ctx.canvas, rows, 0, 0);
      return { rows: [] };
    }

    return { rows };
  }
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
