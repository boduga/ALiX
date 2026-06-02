#!/usr/bin/env node
// bin/alix.js
// Wrapper that sets a higher default heap limit for the CLI.
// ALiX can be memory-intensive (repo map, embeddings, model context),
// so 4GB is the recommended default. Override with ALIX_MAX_HEAP env var.
const maxMem = process.env.ALIX_MAX_HEAP || "4096";
process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ""} --max-old-space-size=${maxMem}`.trim();

import("../dist/src/cli.js").catch((err) => {
  console.error("Failed to start ALiX:", err);
  process.exit(1);
});
