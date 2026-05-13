export type ToolName = "file.read" | "dir.search" | "shell.run" | "patch.apply";

export type ToolResult =
  | { kind: "success"; content?: string; output?: string; matches?: FileMatch[]; changedFiles?: string[]; exitCode?: number }
  | { kind: "error"; message: string };

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