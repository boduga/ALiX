import { performance } from "node:perf_hooks";

// Simple benchmark: measure time to import CLI module
let printed = false;
const startRef = performance.now();

// Monkey-patch process.exit to intercept and measure
const origExit = process.exit;
(process as any).exit = ((code: number) => {
  const end = performance.now();
  const ms = (end - startRef).toFixed(0);
  if (!printed) {
    console.log(`CLI load time: ${ms}ms`);
    printed = true;
  }
  // Don't actually exit - let benchmark complete
}) as typeof process.exit;

// Import CLI - it will run but exit won't actually exit
await import("../dist/src/cli.js");