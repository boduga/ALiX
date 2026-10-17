#!/usr/bin/env node
/**
 * SRAP-G3-ACCEPT fixture — seed the isolated evidence HMAC key.
 *
 * Imports the BUILT, PINNED G3 credential APIs and exercises the production
 * `generateKey(store)` path against the isolated fixture state. Required
 * preconditions (fixture §5.4):
 *
 *   1. `ALIX_REPO_ROOT_ABS` is an absolute pinned checkout.
 *   2. `HOME` and `XDG_STATE_HOME` resolve inside the disposable root.
 *   3. the resolved credential-store path is canonicalised and proven INSIDE
 *      `$ROOT/state/alix-inspector` (symlink-aware) — never assumed.
 *   4. the selected backend is exactly `plain-file`; no keychain fallback.
 *   5. only backend id, active key version and a non-secret success flag print.
 *
 * This is inert fixture infrastructure: no product logic, never imported by
 * `src/**`. It is the reviewed authoring of the seed step the D1 report listed
 * as "not authored".
 */
import { mkdirSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.env.SRAP_ACCEPT_ROOT;
const REPO = process.env.ALIX_REPO_ROOT_ABS;
const HOME = process.env.HOME;
const XDG_STATE_HOME = process.env.XDG_STATE_HOME;

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

if (!ROOT || !ROOT.startsWith("/")) fail("SRAP_ACCEPT_ROOT must be an absolute path");
if (!REPO || !REPO.startsWith("/")) fail("ALIX_REPO_ROOT_ABS must be an absolute pinned checkout");
if (!HOME || !XDG_STATE_HOME) fail("HOME and XDG_STATE_HOME must be set to the fixture root");

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
assertUnderRoot(XDG_STATE_HOME, "XDG_STATE_HOME");

const bs = await import(
  pathToFileURL(join(REPO, "dist/src/governance/security/credentials/backend-selection.js")).href
);
const srap = await import(
  pathToFileURL(join(REPO, "dist/src/governance/security/credentials/srap-evidence.js")).href
);

let expectedState;
try {
  expectedState = realpathSync(join(ROOT, "state", "alix-inspector"));
} catch {
  fail(
    `fixture state dir not found: ${join(ROOT, "state", "alix-inspector")} ` +
      `(bootstrap the fixture before seeding the evidence key)`,
  );
}

// (4) force the fixture backend before any store is constructed.
await bs.writeStoredBackend("plain-file");

// (3) canonicalise the resolved credential dir and prove containment.
const credDir = bs.credentialsDir();
mkdirSync(credDir, { recursive: true, mode: 0o700 });
const realCredDir = realpathSync(credDir);
if (!(realCredDir === expectedState || realCredDir.startsWith(expectedState + sep))) {
  fail(`resolved credential store dir escapes fixture state: ${realCredDir} (expected under ${expectedState})`);
}
const storePath = bs.plainStorePath();
if (!storePath.startsWith(realCredDir + sep)) {
  fail(`resolved plain store path is outside the credential dir: ${storePath}`);
}

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
    credentialsDirWithinState: true,
  }),
);
