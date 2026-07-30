export type ToolName = "file.read" | "file.create" | "file.delete" | "file.exists" | "dir.search" | "shell.run" | "patch.apply" | "done";

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  summary?: string;
  agentId?: string;
  sessionId?: string;
  replayId?: string;
  /**
   * When set to "continuation-resume", the tool executor will bypass
   * PolicyGate. Only set by ContinuationManager after approval is
   * already verified — never set from user input.
   */
  source?: string;
};

export interface FindingReport {
  severity: "low" | "medium" | "high" | "critical";
  category: string;
  file: string;
  line: number;
  summary: string;
  failure_scenario: string;
}

export interface MonitorEvent {
  type: string;
  path?: string;
  data?: string;
  source?: string;
  timestamp: string | number;
}

export type ToolResult =
  | { kind: "success"; content?: string; output?: string; value?: string; matches?: FileMatch[]; changedFiles?: string[]; exitCode?: number; createdPath?: string; deletedPath?: string; exists?: boolean; completed?: boolean; reports?: FindingReport[]; events?: MonitorEvent[] }
  | { kind: "error"; message: string; retryable?: boolean; hint?: string };
// retryable: true = safe to retry. false/undefined = fatal (don't spin).
// hint: short instruction for the model on how to recover.

export type FileMatch = {
  path: string;
  lineNumber: number;
  line: string;
};

export type ToolArgs = {
  "file.read": { root: string; path: string };
  "dir.search": { root: string; pattern: string; extensions: string[] };
  "shell.run": { command: string; cwd: string; timeoutMs?: number };
  "patch.apply": { root: string; format: string; patchText: string };
};