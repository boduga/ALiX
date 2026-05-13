#!/usr/bin/env node
import { loadConfig } from "./config/loader.js";
import { ALIX_VERSION } from "./index.js";
import { runTask } from "./run.js";

const [, , command, ...args] = process.argv;

if (!command || command === "--help" || command === "-h") {
  console.log(`ALiX ${ALIX_VERSION}

Usage:
  alix run "<task>"
  alix serve
  alix config show
`);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  console.log(ALIX_VERSION);
  process.exit(0);
}

if (command === "config" && args[0] === "show") {
  console.log(JSON.stringify(await loadConfig(process.cwd()), null, 2));
  process.exit(0);
}

if (command === "run") {
  const task = args.join(" ").trim();
  if (!task) {
    console.error("Usage: alix run \"<task>\"");
    process.exit(1);
  }
  const result = await runTask(process.cwd(), task);
  console.log(result.summary);
  console.log(`Session: ${result.sessionId}`);
  process.exit(0);
}

console.error(`Unknown command: ${command}`);
process.exit(1);
