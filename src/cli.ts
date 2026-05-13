#!/usr/bin/env node
import { ALIX_VERSION } from "./index.js";

const [, , command] = process.argv;

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

console.error(`Unknown command: ${command}`);
process.exit(1);
