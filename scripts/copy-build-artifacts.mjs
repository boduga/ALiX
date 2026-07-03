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
const profilesSrc = resolve(root, "src/config/profiles");
const profilesDest = resolve(root, "dist/src/config/profiles");
mkdirSync(profilesDest, { recursive: true });
if (existsSync(profilesSrc)) {
  for (const file of readdirSync(profilesSrc).filter((f) => f.endsWith(".json"))) {
    cpSync(resolve(profilesSrc, file), resolve(profilesDest, file));
  }
}

// Copy UI assets
const uiFiles = ["index.html", "app.js", "projection.js", "styles.css"];
const uiSrc = resolve(root, "src/ui");
const uiDest = resolve(root, "dist/src/ui");
mkdirSync(uiDest, { recursive: true });
for (const file of uiFiles) {
  cpSync(resolve(uiSrc, file), resolve(uiDest, file));
}

// Copy DB migrations
const dbSrc = resolve(root, "src/db/migrations");
const dbDest = resolve(root, "dist/src/db/migrations");
mkdirSync(dbDest, { recursive: true });
if (existsSync(dbSrc)) {
  for (const file of readdirSync(dbSrc).filter((f) => f.endsWith(".sql"))) {
    cpSync(resolve(dbSrc, file), resolve(dbDest, file));
  }
}
