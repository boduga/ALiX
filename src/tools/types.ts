export type ToolName = "file.read" | "file.create" | "file.delete" | "file.exists" | "dir.search" | "shell.run" | "patch.apply" | "done";

export type ToolCallRequest = {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolResult =
  | { kind: "success"; content?: string; output?: string; value?: string; matches?: FileMatch[]; changedFiles?: string[]; exitCode?: number; createdPath?: string; deletedPath?: string; exists?: boolean; completed?: boolean }
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