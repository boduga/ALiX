#!/usr/bin/env node
// bin/alix.js
// Wrapper that spawns the CLI with a higher default heap limit.
// ALiX can be memory-intensive (repo map, embeddings, model context),
// so 4GB is the recommended default. Override with ALIX_MAX_HEAP env var.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const maxMem = process.env.ALIX_MAX_HEAP || "4096";
const cliPath = join(__dirname, "..", "dist", "src", "cli.js");

const child = spawn(
  process.execPath,
  [`--max-old-space-size=${maxMem}`, cliPath, ...process.argv.slice(2)],
  {
    stdio: "inherit",
    env: process.env,
  }
);

child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  console.error("Failed to start ALiX:", err);
  process.exit(1);
});
