export function fmtBar(fraction: number, width: number = 24): string {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const filled = Math.round((pct / 100) * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${pct}%`;
}
