export type ChroniclePanelEntry = {
  chronicleId: string;
  traceId?: string;
  signalCode?: string;
  offeringAction?: string;
  routeTarget?: string;
  guildCandidateCount?: number;
  summary: string;
  createdAt: string;
};

export type ChroniclePanelData = {
  query?: string;
  entries: ChroniclePanelEntry[];
  totalEntries: number;
  emptyReason?: string;
};

export function formatChroniclePanel(data: ChroniclePanelData): string[] {
  const lines: string[] = [];

  if (data.query) {
    lines.push(`── Chronicle (filter: ${data.query}) ────────`);
  } else {
    lines.push("── Recent Chronicle ──────────────────────");
  }

  if (data.entries.length === 0) {
    lines.push(`  ${data.emptyReason ?? "No chronicle entries found."}`);
    return lines;
  }

  lines.push(`Entries: ${data.totalEntries}${data.query ? ` (showing ${data.entries.length})` : ""}`);

  for (const entry of data.entries) {
    const time = new Date(entry.createdAt).toLocaleTimeString();
    lines.push(`  ${time}  ${entry.signalCode?.padEnd(10) ?? "—".padEnd(10)}  ${entry.offeringAction?.padEnd(16) ?? "—".padEnd(16)}  ${entry.routeTarget ?? "—"}`);
    lines.push(`         ${entry.summary.slice(0, 60)}`);
    if (entry.guildCandidateCount !== undefined) {
      lines.push(`         guild: ${entry.guildCandidateCount} candidate(s)`);
    }
  }

  return lines;
}

export function chronicleEntryToPanelEntry(
  chronicleEntry: { entryId: string; signalCode: string; domain: string; polarity: string; problem: string; diagnosis: string; actionTaken: string; outcome: string; lesson: string; offeringsUsed: string[]; createdAt: string; traceRefs: string[] },
): ChroniclePanelEntry {
  return {
    chronicleId: chronicleEntry.entryId,
    signalCode: chronicleEntry.signalCode,
    offeringAction: chronicleEntry.actionTaken,
    summary: chronicleEntry.problem,
    createdAt: chronicleEntry.createdAt,
  };
}
