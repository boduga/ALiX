#!/usr/bin/env node
/**
 * SRAP-G3-ACCEPT fixture — seed (or remove) an isolated provider credential.
 *
 * PURPOSE
 *   Place a provider credential into the DISPOSABLE fixture credential store so
 *   the fixture can reference it as `cred://<provider>/<keyLabel>` with no
 *   literal value in any config file. This is the "isolated read-through
 *   seeding" path: the fixture keeps its OWN `plain-file` store, entirely inside
 *   `$SRAP_ACCEPT_ROOT`; the shared OS-user keychain is never selected, read, or
 *   written.
 *
 * CREDENTIAL SOURCING (operator policy — SRAP-G3 acceptance)
 *   - The secret arrives on STDIN, or on an explicit protected FILE DESCRIPTOR
 *     (`--fd N`). It is NEVER accepted from argv (`--provider`/`--label` are
 *     non-secret and are the ONLY argv this tool reads).
 *   - Prefer a DEDICATED, RESTRICTED test credential. Copying a live production
 *     secret here duplicates that secret; it is not equivalent to a test key.
 *   - No temporary secret file is written. No value is logged, echoed, printed
 *     in JSON, or placed in manifests/evidence.
 *
 * PRECONDITIONS (mirrors seed-key.mjs / fixture §5.4)
 *   1. `ALIX_REPO_ROOT_ABS` is an absolute pinned checkout.
 *   2. `HOME` resolves INSIDE the disposable root (`XDG_STATE_HOME` too, on
 *      Linux), so the platform state dir lands under the fixture.
 *   3. the resolved credential-store path canonicalises INSIDE the disposable
 *      fixture root (symlink-aware) — never assumed. On Linux that is the exact
 *      `$ROOT/state/alix-inspector` fixture layout; on macOS/Windows the
 *      platform state dir sits under `$ROOT/home`.
 *   4. the selected backend is exactly `plain-file`; keychain fallback is not
 *      invoked, and the `srap-evidence` namespace is refused.
 *
 * USAGE
 *   # dedicated test key on a protected FD (never argv):
 *   node seed-provider-key.mjs --provider openrouter --label apiKey --fd 3 \
 *     3< <(your-secret-tool read ...)
 *
 *   # or piped on stdin:
 *   your-secret-tool read ... | \
 *     node seed-provider-key.mjs --provider openrouter --label apiKey
 *
 *   # inspect / clean up (no value is ever read out):
 *   node seed-provider-key.mjs --list
 *   node seed-provider-key.mjs --remove --provider openrouter --label apiKey
 *
 * This is inert fixture infrastructure: no product logic, never imported by
 * `src/**`.
 */
import { existsSync, fstatSync, mkdirSync, readSync, realpathSync } from "node:fs";
import { isAbsolute, dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { timingSafeEqual } from "node:crypto";

const ROOT = process.env.SRAP_ACCEPT_ROOT;
const REPO = process.env.ALIX_REPO_ROOT_ABS;
const HOME = process.env.HOME;
const XDG_STATE_HOME = process.env.XDG_STATE_HOME;

/** Provider namespace reserved for SRAP-1 evidence keys; never a provider key. */
const RESERVED_PROVIDER = "srap-evidence";

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }));
  process.exit(1);
}

// --- argv (non-secret flags only) -------------------------------------------
function parseArgs(argv) {
  const out = { mode: "seed", provider: undefined, label: undefined, fd: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.mode = "list";
    else if (a === "--remove") out.mode = "remove";
    else if (a === "--provider") out.provider = argv[++i];
    else if (a === "--label") out.label = argv[++i];
    else if (a === "--fd") out.fd = Number.parseInt(argv[++i] ?? "", 10);
    else fail(`unexpected argument: ${a}`);
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

// --- root + isolation preconditions -----------------------------------------
if (!ROOT || !isAbsolute(ROOT)) fail("SRAP_ACCEPT_ROOT must be an absolute path");
if (!REPO || !isAbsolute(REPO)) fail("ALIX_REPO_ROOT_ABS must be an absolute pinned checkout");
if (!HOME) fail("HOME must be set to the fixture home");
if (process.platform === "linux" && !XDG_STATE_HOME) {
  fail("XDG_STATE_HOME must be set to the fixture state root");
}

const realRoot = realpathSync(ROOT);
function isContained(p, root) {
  return p === root || p.startsWith(root + sep);
}
function assertUnderRoot(p, label) {
  let real;
  try {
    real = realpathSync(p);
  } catch {
    fail(`${label} does not resolve: ${p}`);
  }
  if (!isContained(real, realRoot)) {
    fail(`${label} escapes the fixture root: ${real}`);
  }
  return real;
}
assertUnderRoot(HOME, "HOME");
if (XDG_STATE_HOME) assertUnderRoot(XDG_STATE_HOME, "XDG_STATE_HOME");

const bs = await import(
  pathToFileURL(join(REPO, "dist/src/governance/security/credentials/backend-selection.js")).href
);

// The fixture must place the platform state dir inside the disposable root:
//   linux  -> $ROOT/state/alix-inspector  (XDG_STATE_HOME lives under $ROOT)
//   darwin -> $ROOT/home/Library/Application Support/alix-inspector
//   win32  -> $ROOT/home/AppData/Local/alix-inspector (LOCALAPPDATA under $ROOT)
// Linux keeps the exact reviewed predicate; on win32 LOCALAPPDATA is the
// resolver and must itself be proven under the root before any state is written.
if (process.platform === "win32") assertUnderRoot(process.env.LOCALAPPDATA, "LOCALAPPDATA");

// Prove the fixture state root exists BEFORE creating anything under it, and
// that it does not escape the disposable root via a symlink.
let requiredBase;
if (process.platform === "linux") {
  const stateDir = join(ROOT, "state", "alix-inspector");
  if (!existsSync(stateDir)) {
    fail(
      `fixture state dir not found: ${stateDir} ` +
        `(bootstrap the fixture before seeding credentials)`,
    );
  }
  requiredBase = realpathSync(stateDir);
  if (!isContained(requiredBase, realRoot)) {
    fail(`fixture state dir escapes the fixture root: ${requiredBase}`);
  }
} else {
  requiredBase = realRoot;
}

// (3) prove containment BEFORE creating the credential dir, so a symlinked
// escape never materialises a directory outside the root.
const credDir = bs.credentialsDir();
let ancestor = credDir;
while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) {
  ancestor = dirname(ancestor);
}
const realAncestor = realpathSync(ancestor);
if (!isContained(realAncestor, requiredBase) || !isContained(realAncestor, realRoot)) {
  fail(`credential store dir escapes the fixture root: ${realAncestor}`);
}
try {
  mkdirSync(credDir, { recursive: true, mode: 0o700 });
} catch (err) {
  fail(`could not create credential store dir: ${err.code ?? "error"}`);
}
const realCredDir = realpathSync(credDir);
if (!isContained(realCredDir, requiredBase) || !isContained(realCredDir, realRoot)) {
  fail(`resolved credential store dir escapes the fixture root: ${realCredDir}`);
}
const storePath = bs.plainStorePath();
// Canonicalize the store's directory before comparing: on macOS `/var` is a
// symlink to `/private/var`, so the raw path and the realpath of the credential
// dir disagree even though they are the same location.
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

// --- read the secret (never from argv) --------------------------------------
const MAX_SECRET_BYTES = 4096;
function readSecretFromFd(fd) {
  const chunks = [];
  const buf = Buffer.alloc(MAX_SECRET_BYTES + 1);
  let total = 0;
  for (;;) {
    let n;
    try {
      n = readSync(fd, buf, 0, buf.length, null);
    } catch (err) {
      if (err && err.code === "EAGAIN") continue; // non-blocking pipe not ready
      if (err && err.code === "EOF") break;
      fail(`failed reading secret from fd ${fd}: ${err.code ?? "error"}`);
    }
    if (n === 0) break;
    total += n;
    if (total > MAX_SECRET_BYTES) {
      buf.fill(0);
      fail(`secret exceeds ${MAX_SECRET_BYTES} bytes; refusing`);
    }
    chunks.push(Buffer.from(buf.subarray(0, n)));
  }
  buf.fill(0);
  const all = Buffer.concat(chunks);
  for (const c of chunks) c.fill(0);
  // strip a single trailing newline (echo/heredoc artifact); keep the rest.
  let end = all.length;
  if (end > 0 && all[end - 1] === 0x0a) end--;
  if (end > 0 && all[end - 1] === 0x0d) end--;
  // Copy out, then scrub the concatenation: `subarray` shares memory, so an
  // independent copy is required or `all.fill(0)` would zero the secret.
  const trimmed = Buffer.from(all.subarray(0, end));
  all.fill(0);
  return trimmed;
}

if (args.mode === "seed") {
  if (!args.provider || !args.label) fail("--provider and --label are required for seeding");
  if (args.provider.toLowerCase() === RESERVED_PROVIDER) {
    fail(`provider '${RESERVED_PROVIDER}' is reserved for SRAP-1 evidence keys`);
  }
  const fd = args.fd ?? 0;
  let isTty = false;
  try {
    isTty = fstatSync(fd).isCharacterDevice();
  } catch {
    /* an invalid fd is reported by the read below */
  }
  if (isTty) {
    fail("refusing to read a secret from a TTY; pipe stdin or pass a protected --fd");
  }
  const secret = readSecretFromFd(fd);
  if (secret.length === 0) fail("empty secret; nothing written");
  const secretLength = secret.length;

  await store.set(args.provider, args.label, secret.toString("utf8"));

  // Prove the STORED value equals what we supplied, without emitting it.
  const a = Buffer.from(store.get(args.provider, args.label) ?? "", "utf8");
  const verified =
    a.length === secret.length && a.length > 0 && timingSafeEqual(a, secret);
  a.fill(0);
  secret.fill(0);
  if (!verified) fail("read-back verification failed; credential not confirmed");

  console.log(
    JSON.stringify({
      ok: true,
      mode: "seed",
      backend: store.backend,
      provider: args.provider,
      keyLabel: args.label,
      valueLength: secretLength,
      verified: true,
      credentialsDirWithinRoot: true,
    }),
  );
} else if (args.mode === "remove") {
  if (!args.provider || !args.label) fail("--provider and --label are required for --remove");
  store.delete(args.provider, args.label);
  console.log(
    JSON.stringify({ ok: true, mode: "remove", provider: args.provider, keyLabel: args.label }),
  );
} else {
  // list — metadata only, never values.
  const entries = store.list().map((e) => `${e.provider}/${e.keyLabel}`);
  console.log(JSON.stringify({ ok: true, mode: "list", backend: store.backend, entries }));
}
