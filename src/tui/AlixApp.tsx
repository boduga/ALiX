import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text, Static, useStdout, useInput, useApp } from "ink";
import TextInput from "ink-text-input";

// ─── Types ──────────────────────────────────────────────────────────

export interface OutputLine {
  id: string;
  text: string;
  kind: "output" | "echo" | "info";
}

export interface AlixAppApi {
  appendOutput: (text: string, streaming: boolean) => void;
  resetOutput: () => void;
  setRunning: (running: boolean) => void;
  setTokenUsage: (fraction: number) => void;
}

export interface AlixAppProps {
  onTask: (task: string) => Promise<void>;
  onExit: () => void;
  maxTokens?: number;
  sessionId?: string;
  onReady?: (api: AlixAppApi) => void;
}

// ─── Helpers ────────────────────────────────────────────────────────

let idCounter = 0;
const nextId = () => `l${++idCounter}`;

const DIVIDER = "─";
function dividerLine(cols: number): string {
  return DIVIDER.repeat(Math.max(cols, 1));
}

// ─── TokenBar ───────────────────────────────────────────────────────

function TokenBar({ usage, cols, sessionId }: { usage: number; cols: number; sessionId?: string }) {
  const pct = Math.round(Math.min(Math.max(usage, 0), 1) * 100);
  const barW = 10;
  const filled = Math.round(barW * pct / 100);
  const bar = "█".repeat(filled) + "░".repeat(barW - filled);
  const label = sessionId ? ` ${sessionId.slice(0, 16)}` : "";
  const tokenLabel = ` ${pct}%`;
  const left = label;
  const right = ` ${bar}${tokenLabel} `;
  const mid = Math.max(cols - left.length - right.length, 1);
  const color: "green" | "yellow" | "red" = pct < 60 ? "green" : pct < 85 ? "yellow" : "red";

  return (
    <Box>
      <Text dimColor>{left}</Text>
      <Text dimColor>{DIVIDER.repeat(mid)}</Text>
      <Text color={color}>{bar}</Text>
      <Text dimColor>{tokenLabel}</Text>
    </Box>
  );
}

// ─── Main Component ─────────────────────────────────────────────────

export function AlixApp({ onTask, onExit, maxTokens, sessionId, onReady }: AlixAppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 80;

  const [lines, setLines] = useState<OutputLine[]>([]);
  const [streamLine, setStreamLine] = useState("");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [usage, setUsage] = useState(0);
  const apiEmitted = useRef(false);

  // Expose imperative API to the Tui wrapper
  useEffect(() => {
    if (apiEmitted.current) return;
    apiEmitted.current = true;

    const api: AlixAppApi = {
      appendOutput: (text: string, streaming: boolean) => {
        if (streaming) {
          const nlIdx = text.lastIndexOf("\n");
          if (nlIdx >= 0) {
            const completed = text.slice(0, nlIdx);
            const remainder = text.slice(nlIdx + 1);
            if (completed) {
              setLines(prev => [...prev, { id: nextId(), text: completed, kind: "output" }]);
            }
            setStreamLine(remainder);
          } else {
            setStreamLine(text);
          }
        } else {
          setLines(prev => [...prev, { id: nextId(), text, kind: "output" }]);
        }
      },
      resetOutput: () => {
        setLines(prev => [...prev, { id: nextId(), text: dividerLine(cols), kind: "info" }]);
      },
      setRunning: (r: boolean) => setRunning(r),
      setTokenUsage: (f: number) => setUsage(f),
    };
    onReady?.(api);
  }, [cols, onReady]);

  // Handle task submission
  const handleSubmit = useCallback(async (value: string) => {
    const task = value.trim();
    setInput("");
    if (!task) return;

    if (task.toLowerCase() === "exit" || task.toLowerCase() === "quit") {
      onExit();
      exit();
      return;
    }

    if (task.length < 3) {
      setLines(prev => [...prev, { id: nextId(), text: "Task too short (min 3 chars).", kind: "info" }]);
      return;
    }

    setLines(prev => [
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
  }, [cols, onTask, onExit, exit]);

  // Ctrl+C/D
  useInput((_input, key) => {
    if (key.ctrl && (_input === "c" || _input === "d")) {
      onExit();
      exit();
    }
  });

  return (
    <Box flexDirection="column" height={stdout?.rows ?? 24}>
      <Static items={lines}>
        {(line) => (
          <Box key={line.id}>
            <Text dimColor={line.kind === "info"} bold={line.kind === "echo"} color={line.kind === "echo" ? "cyan" : undefined}>
              {line.text}
            </Text>
          </Box>
        )}
      </Static>

      {streamLine ? <Text>{streamLine}</Text> : null}

      <Box flexGrow={1} />

      <TokenBar usage={usage} cols={cols} sessionId={sessionId} />

      <Box>
        <Text color="cyan" bold>{running ? " ⟳ " : " > "}</Text>
        {running ? (
          <Text dimColor>running...</Text>
        ) : (
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="Enter a task..." />
        )}
      </Box>
    </Box>
  );
}
