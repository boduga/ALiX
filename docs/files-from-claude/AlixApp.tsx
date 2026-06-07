/**
 * AlixApp.tsx
 * Root Ink component for the ALiX TUI.
 *
 * Layout:
 *   ┌──────────────────────────────────┐
 *   │  scrollable output (Static)      │  expands to fill terminal height
 *   ├──────────────────────────────────┤
 *   │ ────────────────────────────── │  divider
 *   │ >  user input                    │  text input, always at bottom
 *   └──────────────────────────────────┘
 */

import React, { useState, useCallback, useRef } from "react";
import { Box, Text, Static, useStdout, useInput, useApp } from "ink";
import TextInput from "ink-text-input";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OutputLine {
  id: string;
  text: string;
  /** "output" = normal streamed text, "echo" = the submitted task, "info" = dim system text */
  kind: "output" | "echo" | "info";
}

export interface AlixAppProps {
  /** Called when the user submits a non-empty, non-exit task. */
  onTask: (task: string) => Promise<void>;
  /** Called when the user types exit/quit or Ctrl+C/D. */
  onExit: () => void;
  /** Token budget 0–1, shown in the status bar. */
  tokenUsage?: number;
  /** Max context tokens, for display only. */
  maxTokens?: number;
  /** Session ID shown in the status bar. */
  sessionId?: string;
  /** Imperative handle passed back to the caller so it can push output lines. */
  onReady?: (api: AlixAppApi) => void;
}

export interface AlixAppApi {
  /** Append a line to the scrollable output area. */
  appendLine: (text: string, kind?: OutputLine["kind"]) => void;
  /** Clear all output lines. */
  clearOutput: () => void;
  /** Update the token usage fraction (0–1). */
  setTokenUsage: (fraction: number) => void;
  /** Lock / unlock the input bar while a task is running. */
  setRunning: (running: boolean) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

let lineCounter = 0;
function nextId() {
  return `l${++lineCounter}`;
}

const DIVIDER = "─";

function dividerLine(cols: number): string {
  return DIVIDER.repeat(Math.max(cols, 1));
}

// ─── Token bar ───────────────────────────────────────────────────────────────

function TokenBar({
  fraction,
  cols,
  sessionId,
}: {
  fraction: number;
  cols: number;
  sessionId?: string;
}) {
  const pct = Math.round(Math.min(Math.max(fraction, 0), 1) * 100);
  const label = sessionId ? ` ${sessionId.slice(0, 16)}` : "";
  const tokenLabel = ` ctx ${pct}% `;
  // Build a mini bar that fits in the right portion of the divider line
  const barWidth = 10;
  const filled = Math.round((barWidth * pct) / 100);
  const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);

  const left = label;
  const right = `${bar} ${tokenLabel}`;
  const mid = cols - left.length - right.length;
  const divider = DIVIDER.repeat(Math.max(mid, 1));

  const color: "green" | "yellow" | "red" =
    pct < 60 ? "green" : pct < 85 ? "yellow" : "red";

  return (
    <Box>
      <Text dimColor>{left}</Text>
      <Text dimColor>{divider}</Text>
      <Text color={color}>{bar}</Text>
      <Text dimColor>{tokenLabel}</Text>
    </Box>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function AlixApp({
  onTask,
  onExit,
  tokenUsage = 0,
  maxTokens,
  sessionId,
  onReady,
}: AlixAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;

  const [lines, setLines] = useState<OutputLine[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [usage, setUsage] = useState(tokenUsage);

  // Expose imperative API to the caller on first render
  const apiEmitted = useRef(false);
  if (!apiEmitted.current && onReady) {
    apiEmitted.current = true;
    const api: AlixAppApi = {
      appendLine: (text, kind = "output") =>
        setLines((prev) => [...prev, { id: nextId(), text, kind }]),
      clearOutput: () => setLines([]),
      setTokenUsage: (f) => setUsage(f),
      setRunning: (r) => setRunning(r),
    };
    // Call synchronously so the caller has the handle before first paint
    onReady(api);
  }

  const handleSubmit = useCallback(
    async (value: string) => {
      const task = value.trim();
      setInput("");

      if (!task) return;

      if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") {
        onExit();
        exit();
        return;
      }

      if (task.length < 3) {
        setLines((prev) => [
          ...prev,
          { id: nextId(), text: "Task too short (min 3 chars).", kind: "info" },
        ]);
        return;
      }

      // Echo the submitted task
      setLines((prev) => [
        ...prev,
        { id: nextId(), text: dividerLine(cols), kind: "info" },
        { id: nextId(), text: task, kind: "echo" },
        { id: nextId(), text: dividerLine(cols), kind: "info" },
      ]);

      setRunning(true);
      try {
        await onTask(task);
      } finally {
        setRunning(false);
      }
    },
    [cols, onTask, onExit, exit],
  );

  // Ctrl+C / Ctrl+D while not handled by TextInput
  useInput((_input, key) => {
    if (key.ctrl && (_input === "c" || _input === "d")) {
      onExit();
      exit();
    }
  });

  return (
    <Box flexDirection="column" height={stdout?.rows ?? 24}>
      {/*
       * Static renders lines that will never change — Ink won't repaint them.
       * New lines get appended; the terminal scrolls naturally.
       */}
      <Static items={lines}>
        {(line) => (
          <Box key={line.id}>
            <Text
              dimColor={line.kind === "info"}
              bold={line.kind === "echo"}
              color={line.kind === "echo" ? "cyan" : undefined}
            >
              {line.text}
            </Text>
          </Box>
        )}
      </Static>

      {/* Spacer pushes the prompt bar to the bottom */}
      <Box flexGrow={1} />

      {/* ── Status / divider row ── */}
      <TokenBar fraction={usage} cols={cols} sessionId={sessionId} />

      {/* ── Input row ── */}
      <Box>
        <Text color="cyan" bold>
          {running ? " ⟳ " : " > "}
        </Text>
        {running ? (
          <Text dimColor>running…</Text>
        ) : (
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Enter a task…"
          />
        )}
      </Box>
    </Box>
  );
}
