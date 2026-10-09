import { watch, existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { ToolResult, MonitorEvent } from "./types.js";

// ---------------------------------------------------------------------------
// monitor — background watcher for logs, file changes, processes, WebSocket
// ---------------------------------------------------------------------------

export type MonitorArgs = {
  type: "file" | "process" | "websocket";
  target: string;
  pattern?: string;
  timeoutMs?: number;
  maxEvents?: number;
  cwd?: string;
};

export async function monitorTool(args: MonitorArgs): Promise<ToolResult> {
  const { type, target, pattern, cwd: workingDir } = args;
  const timeoutMs = args.timeoutMs ?? 30000;
  const maxEvents = args.maxEvents ?? 10;
  const patternRe = pattern ? new RegExp(pattern) : null;
  const events: MonitorEvent[] = [];

  return new Promise<ToolResult>((resolveResult) => {
    let cleanupActive: (() => void) | null = null;

    const timer = setTimeout(() => {
      if (cleanupActive) cleanupActive();
      resolveResult({
        kind: "success",
        events,
        output: `Monitor timed out after ${timeoutMs}ms. Collected ${events.length} event(s).`,
      });
    }, timeoutMs);

    function collect(evt: MonitorEvent): void {
      if (patternRe && evt.data !== undefined && !patternRe.test(evt.data)) return;
      events.push(evt);
      if (events.length >= maxEvents) {
        if (cleanupActive) cleanupActive();
        resolveResult({
          kind: "success",
          events,
          output: `Collected ${events.length} event(s).`,
        });
      }
    }

    function cleanupBase(): void {
      clearTimeout(timer);
    }

    switch (type) {
      // -------------------------------------------------------------------
      // file — watch a file for changes (fs.watch)
      // -------------------------------------------------------------------
      case "file": {
        if (!target) {
          cleanupBase();
          resolveResult({ kind: "error", message: "monitor file requires a target path" });
          return;
        }
        const resolvedPath = resolve(workingDir ?? process.cwd(), target);
        if (!existsSync(resolvedPath)) {
          cleanupBase();
          resolveResult({ kind: "error", message: `File not found: ${target}` });
          return;
        }

        let watcher: ReturnType<typeof watch> | null = null;
        let lastSize = 0;

        // Read initial size
        try {
          const stat = statSync(resolvedPath);
          lastSize = stat.size;
        } catch {
          // ignore
        }

        try {
          watcher = watch(resolvedPath, async (eventType) => {
            if (eventType === "change") {
              try {
                const content = await readFile(resolvedPath, "utf8");
                const newSize = content.length;
                if (newSize > lastSize) {
                  const newData = content.slice(lastSize);
                  lastSize = newSize;
                  collect({
                    timestamp: new Date().toISOString(),
                    source: target,
                    data: newData,
                    type: "line",
                  });
                } else if (newSize < lastSize) {
                  // File was truncated — read from start
                  lastSize = newSize;
                  collect({
                    timestamp: new Date().toISOString(),
                    source: target,
                    data: "(file truncated)",
                    type: "change",
                  });
                }
              } catch {
                // file may be temporarily unavailable
              }
            }
          });
          cleanupActive = () => {
            cleanupBase();
            if (watcher) {
              watcher.close();
              watcher = null;
            }
          };
        } catch (err) {
          cleanupBase();
          resolveResult({
            kind: "error",
            message: `Failed to watch file: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        break;
      }

      // -------------------------------------------------------------------
      // process — spawn a process and collect its stdout lines
      // -------------------------------------------------------------------
      case "process": {
        if (!target) {
          cleanupBase();
          resolveResult({ kind: "error", message: "monitor process requires a command string" });
          return;
        }
        const child = spawn(target, [], {
          cwd: workingDir ?? process.cwd(),
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let buf = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim()) {
              collect({
                timestamp: new Date().toISOString(),
                source: target,
                data: line,
                type: "line",
              });
            }
          }
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) {
            collect({
              timestamp: new Date().toISOString(),
              source: target,
              data: text,
              type: "error",
            });
          }
        });
        child.on("error", (err) => {
          cleanupActive?.();
          resolveResult({
            kind: "error",
            message: `Process failed: ${err.message}`,
          });
        });
        child.on("exit", (code) => {
          // Flush remaining buffer
          if (buf.trim()) {
            collect({
              timestamp: new Date().toISOString(),
              source: target,
              data: buf,
              type: "line",
            });
          }
          if (events.length === 0) {
            cleanupActive?.();
            resolveResult({
              kind: "success",
              events: [],
              output: `Process exited with code ${code}. No output captured.`,
            });
          }
        });
        cleanupActive = () => {
          cleanupBase();
          if (!child.killed) {
            child.kill("SIGTERM");
            setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 2000);
          }
        };
        break;
      }

      // -------------------------------------------------------------------
      // websocket — connect to a WebSocket feed and collect messages
      // -------------------------------------------------------------------
      case "websocket": {
        if (!target) {
          cleanupBase();
          resolveResult({ kind: "error", message: "monitor websocket requires a URL" });
          return;
        }
        // Use global WebSocket (Node 22+ built-in or `ws` polyfill)
        let ws: WebSocket | null = null;
        try {
          ws = new WebSocket(target);

          cleanupActive = () => {
            cleanupBase();
            if (ws) {
              ws.close();
              ws = null;
            }
          };

          ws.onopen = () => {
            collect({
              timestamp: new Date().toISOString(),
              source: target,
              data: "WebSocket connected",
              type: "message",
            });
          };

          ws.onmessage = (event: MessageEvent) => {
            collect({
              timestamp: new Date().toISOString(),
              source: target,
              data: typeof event.data === "string" ? event.data : String(event.data),
              type: "message",
            });
          };

          ws.onerror = () => {
            collect({
              timestamp: new Date().toISOString(),
              source: target,
              data: "WebSocket connection error",
              type: "error",
            });
          };

          ws.onclose = () => {
            collect({
              timestamp: new Date().toISOString(),
              source: target,
              data: "WebSocket connection closed",
              type: "change",
            });
          };
        } catch (err) {
          cleanupBase();
          resolveResult({
            kind: "error",
            message: `WebSocket failed: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        break;
      }

      default:
        cleanupBase();
        resolveResult({
          kind: "error",
          message: `Unknown monitor type: ${type}. Supported: file, process, websocket`,
        });
    }
  });
}
