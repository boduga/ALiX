#!/usr/bin/env node
/**
 * SRAP-G3-ACCEPT fixture — seed the isolated evidence HMAC key.
 *
 * Imports the BUILT, PINNED G3 credential APIs and exercises the production
 * `generateKey(store)` path against the isolated fixture state. Required
 * preconditions (fixture §5.4):
 *
 *   1. `ALIX_REPO_ROOT_ABS` is an absolute pinned checkout.
 *   2. `HOME` resolves inside the disposable root (`XDG_STATE_HOME` too, on
 *      Linux), so the platform state dir lands under the fixture.
 *   3. the resolved credential-store path is canonicalised and proven INSIDE
 *      the disposable fixture root (symlink-aware) — never assumed. On Linux
 *      that is the exact `$ROOT/state/alix-inspector` fixture layout; on
 *      macOS/Windows the platform state dir sits under `$ROOT/home`.
 *   4. the selected backend is exactly `plain-file`; no keychain fallback.
 *   5. only backend id, active key version and a non-secret success flag print.
 *
 * This is inert fixture infrastructure: no product logic, never imported by
 * `src/**`. It is the reviewed authoring of the seed step the D1 report listed
 * as "not authored".
 */
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.SRAP_ACCEPT_ROOT;
const REPO = process.env.ALIX_REPO_ROOT_ABS;
const HOME = process.env.HOME;
const XDG_STATE_HOME = process.env.XDG_STATE_HOME;

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

if (!ROOT || !isAbsolute(ROOT)) fail("SRAP_ACCEPT_ROOT must be an absolute path");
if (!REPO || !isAbsolute(REPO)) fail("ALIX_REPO_ROOT_ABS must be an absolute pinned checkout");
if (!HOME) fail("HOME must be set to the fixture home");
if (process.platform === "linux" && !XDG_STATE_HOME) {
  fail("XDG_STATE_HOME must be set to the fixture state root");
}

const realRoot = realpathSync(ROOT);
function assertUnderRoot(p, label) {
  let real;
  try {
    real = realpathSync(p);
  } catch {
    fail(`${label} does not resolve: ${p}`);
  }
  if (!(real === realRoot || real.startsWith(realRoot + sep))) {
    fail(`${label} escapes the fixture root: ${real}`);
  }
  return real;
}
assertUnderRoot(HOME, "HOME");
if (XDG_STATE_HOME) assertUnderRoot(XDG_STATE_HOME, "XDG_STATE_HOME");

const bs = await import(
  pathToFileURL(join(REPO, "dist/src/governance/security/credentials/backend-selection.js")).href
);
const srap = await import(
  pathToFileURL(join(REPO, "dist/src/governance/security/credentials/srap-evidence.js")).href
);

// On win32 the platform resolver reads LOCALAPPDATA; prove it inside the root
// before any state is written.
if (process.platform === "win32") assertUnderRoot(process.env.LOCALAPPDATA, "LOCALAPPDATA");

// Prove the fixture state root exists before creating anything under it, and
// that it does not escape the disposable root via a symlink.
let requiredBase;
if (process.platform === "linux") {
  const stateDir = join(ROOT, "state", "alix-inspector");
  if (!existsSync(stateDir)) {
    fail(
      `fixture state dir not found: ${stateDir} ` +
        `(bootstrap the fixture before seeding the evidence key)`,
    );
  }
  requiredBase = realpathSync(stateDir);
} else {
  requiredBase = realRoot;
}
if (!(requiredBase === realRoot || requiredBase.startsWith(realRoot + sep))) {
  fail(`fixture state dir escapes the fixture root: ${requiredBase}`);
}

// (3) canonicalise the resolved credential dir and prove containment BEFORE
// any write.
const credDir = bs.credentialsDir();
mkdirSync(credDir, { recursive: true, mode: 0o700 });
const realCredDir = realpathSync(credDir);
if (!(realCredDir === requiredBase || realCredDir.startsWith(requiredBase + sep))) {
  fail(
    `resolved credential store dir escapes the fixture root: ${realCredDir} ` +
      `(expected under ${requiredBase})`,
  );
}
if (!(realCredDir === realRoot || realCredDir.startsWith(realRoot + sep))) {
  fail(`resolved credential store dir escapes the fixture root: ${realCredDir}`);
}
const storePath = bs.plainStorePath();
// Canonicalize the store's directory before comparing (macOS `/var` symlink).
if (realpathSync(dirname(storePath)) !== realCredDir) {
  fail(`resolved plain store path is outside the credential dir: ${storePath}`);
}

// (4) force the fixture backend only AFTER containment is proven.
await bs.writeStoredBackend("plain-file");

const store = await bs.createCredentialStoreForBackend("plain-file");
await store.load();
if (store.backend !== "plain-file") {
  fail(`selected backend is ${store.backend}, expected plain-file (no keychain fallback permitted)`);
}

const generated = await srap.generateKey(store);
const active = srap.activeKeyVersion(store);
if (active !== generated) {
  fail(`activeKeyVersion ${active} does not match generated version ${generated}`);
}

// (5) non-secret success output only.
console.log(
  JSON.stringify({
    ok: true,
    backend: store.backend,
    activeKeyVersion: active,
    credentialsDirWithinRoot: true,
  }),
);
