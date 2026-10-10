#!/usr/bin/env node

/**
 * Cross-platform build artifact copier.
 * Replaces Unix shell commands (mkdir -p, cp) that fail on Windows.
 * Called from package.json build script.
 */

import { mkdirSync, cpSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Copy config profiles
const profilesSrc = resolve(root, "src/operations/config/profiles");
const profilesDest = resolve(root, "dist/src/operations/config/profiles");
mkdirSync(profilesDest, { recursive: true });
if (existsSync(profilesSrc)) {
  for (const file of readdirSync(profilesSrc).filter((f) => f.endsWith(".json"))) {
    cpSync(resolve(profilesSrc, file), resolve(profilesDest, file));
  }
}

// Copy UI assets
const uiFiles = ["index.html", "app.js", "projection.js", "styles.css"];
const uiSrc = resolve(root, "src/interfaces/ui");
const uiDest = resolve(root, "dist/src/interfaces/ui");
mkdirSync(uiDest, { recursive: true });
for (const file of uiFiles) {
  cpSync(resolve(uiSrc, file), resolve(uiDest, file));
}

// Copy DB migrations
const dbSrc = resolve(root, "src/operations/db/migrations");
const dbDest = resolve(root, "dist/src/operations/db/migrations");
mkdirSync(dbDest, { recursive: true });
if (existsSync(dbSrc)) {
  for (const file of readdirSync(dbSrc).filter((f) => f.endsWith(".sql"))) {
    cpSync(resolve(dbSrc, file), resolve(dbDest, file));
  }
}

// Copy refine-strategy templates (read module-relative at runtime)
const strategiesSrc = resolve(root, "src/execution/run/task-loop/refine-strategies");
const strategiesDest = resolve(root, "dist/src/execution/run/task-loop/refine-strategies");
mkdirSync(strategiesDest, { recursive: true });
if (existsSync(strategiesSrc)) {
  for (const file of readdirSync(strategiesSrc).filter((f) => f.endsWith(".md"))) {
    cpSync(resolve(strategiesSrc, file), resolve(strategiesDest, file));
  }
}

// Copy tool-repair model patterns (data JSON, read module-relative at runtime
// by `PatternRegistry.loadModel` as `<compiled>/../patterns/<model>.json`).
// tsc never emits an unimported JSON, so without this the repair engine loads
// zero patterns and is inert.
const patternsSrc = resolve(root, "packages/tool-repair/src/patterns");
const patternsDest = resolve(root, "dist/packages/tool-repair/src/patterns");
mkdirSync(patternsDest, { recursive: true });
if (existsSync(patternsSrc)) {
  for (const file of readdirSync(patternsSrc).filter((f) => f.endsWith(".json"))) {
    cpSync(resolve(patternsSrc, file), resolve(patternsDest, file));
  }
}
