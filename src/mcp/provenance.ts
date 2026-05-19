import type { ToolCategory } from "./tool-catalog.js";
type TrustLevel = "builtin" | "project" | "user" | "remote";

export type ProvenanceEntry = {
  toolName: string;
  source: "builtin" | "mcp" | "plugin" | "user";
  trustLevel: TrustLevel;
  invocationCount: number;
  lastInvokedAt?: string;
  createdAt: string;
  sessionId: string;
};

export type ProvenanceExport = {
  toolName: string;
  source: string;
  trustLevel: TrustLevel;
  invocationCount: number;
  sessionId: string;
};

export class ToolProvenanceTracker {
  private provenance = new Map<string, ProvenanceEntry>();
  private _sessionId: string;

  constructor(sessionId?: string) {
    this._sessionId = sessionId ?? `session_${Date.now()}`;
  }

  record(
    toolName: string,
    info: { source: ProvenanceEntry["source"]; trustLevel?: TrustLevel }
  ): void {
    const existing = this.provenance.get(toolName);

    if (existing) {
      existing.invocationCount++;
      existing.lastInvokedAt = new Date().toISOString();
    } else {
      this.provenance.set(toolName, {
        toolName,
        source: info.source,
        trustLevel: info.trustLevel ?? "builtin",
        invocationCount: 1,
        createdAt: new Date().toISOString(),
        sessionId: this._sessionId,
      });
    }
  }

  getProvenance(toolName: string): ProvenanceEntry | undefined {
    return this.provenance.get(toolName);
  }

  getAllProvenance(): ProvenanceEntry[] {
    return [...this.provenance.values()];
  }

  exportForEvent(): ProvenanceExport[] {
    return [...this.provenance.values()].map(p => ({
      toolName: p.toolName,
      source: p.source,
      trustLevel: p.trustLevel,
      invocationCount: p.invocationCount,
      sessionId: p.sessionId,
    }));
  }

  get sessionId(): string {
    return this._sessionId;
  }

  clearSession(): void {
    for (const entry of this.provenance.values()) {
      entry.invocationCount = 0;
    }
  }
}