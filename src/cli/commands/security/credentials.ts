/**
 * security.ts — Security diagnostics and Inspector auth management for ALiX.
 *
 * Provides:
 * - `alix security doctor` — Inspector boundary state diagnostics (Sb1)
 * - `alix inspector auth create --name <name> --role <role>` (Sb2)
 * - `alix inspector auth list` (Sb2)
 * - `alix inspector auth rotate <token-id> --grace <duration>` (Sb2)
 * - `alix inspector auth revoke <token-id> [--yes]` (Sb2)
 * - `alix inspector auth doctor` (Sb2)
 * - `alix audit verify [--json]` — streaming audit log verification (Sd2)
 * - `alix audit checkpoint --output <path>` — create signed checkpoint (Sd2)
 * - `alix audit checkpoint-verify <path>` — verify checkpoint (Sd2)
 */

import "../../../config/loader.js";
import "../../../config/validator.js";
import "../../../security/inspector/auth-store.js";
import "../../../security/platform/user-state-paths.js";
import "node:path";
import "node:crypto";
import { CredentialStore } from "../../../security/credentials/credential-store.js";
import { makeCredentialReference } from "../../../security/credentials/credential-reference.js";
import { migrateCredentials } from "../../../security/credentials/credential-migration.js";
import {
  chooseBackend,
  writeStoredBackend,
  scrubPlainFileStore,
  createCredentialStoreForBackend,
  loadCredentialStoreWithKeychainFallback,
  resolveCredentialPassphrase,
  type CredentialBackend,
} from "../../../security/credentials/backend-selection.js";
import { homedir } from "node:os";

// Supply-chain imports (P4.3-Sf)
import "../../../security/supply-chain/dependency-policy.js";
import "../../../security/supply-chain/security-exceptions.js";
import "../../../security/supply-chain/package-verifier.js";
import { jsonMode, setJsonMode } from "./shared.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function createCredentialStore(): Promise<CredentialStore> {
  const backend = await chooseBackend();
  // Pass the hidden prompt so an encrypted-file store can be unlocked by
  // typing the passphrase once per session (spec Phase 3). The loader does
  // NOT pass a prompt — config load must never block on interactive input.
  const { promptHidden } = await import("../prompt.js");
  return loadCredentialStoreWithKeychainFallback(backend, undefined, promptHidden);
}


// ---------------------------------------------------------------------------
// alix credential list
// ---------------------------------------------------------------------------

export async function handleCredentialList(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));

  const store = await createCredentialStore();
  const entries = store.list();

  if (jsonMode) {
    console.log(JSON.stringify(entries));
  } else {
    if (entries.length === 0) {
      console.log("No credentials stored.");
      console.log(`\nCapacity: 0/${store.maxEntries} entries`);
    } else {
      console.log(`${"Provider".padEnd(20)} ${"Key Label".padEnd(30)} ${"Encrypted".padEnd(12)} Updated`);
      console.log("-".repeat(90));
      for (const e of entries) {
        const updated = e.updatedAt ? new Date(e.updatedAt).toLocaleDateString() : "";
        console.log(`${e.provider.slice(0, 18).padEnd(20)} ${e.keyLabel.slice(0, 28).padEnd(30)} ${e.encrypted ? "yes".padEnd(12) : "no".padEnd(12)} ${updated}`);
      }
      console.log(`\n${entries.length}/${store.maxEntries} entries`);
    }
  }
}


// ---------------------------------------------------------------------------
// alix credential get
// ---------------------------------------------------------------------------

export async function handleCredentialGet(args: string[]): Promise<void> {
  const provider = args[0];
  const keyLabel = args[1];

  if (!provider || !keyLabel) {
    console.error("Usage: alix credential get <provider> <keyLabel>");
    process.exit(1);
  }

  const store = await createCredentialStore();
  const value = store.get(provider, keyLabel);

  if (value === null) {
    console.error(`Credential not found: ${provider}/${keyLabel}`);
    process.exit(1);
  }

  // Output only the value (usable for piping)
  console.log(value);
}

// ---------------------------------------------------------------------------
// alix credential set
// ---------------------------------------------------------------------------

/**
 * The literal keyword that triggers the interactive provider picker.
 * When the first positional arg of `alix credential set` is this value
 * (case-insensitive), the user is shown a numbered list of available
 * providers instead of being expected to type one. Remaining args
 * (`keyLabel`, `value`) are still honored if provided, so the picker
 * can be combined with shell completion for the rest of the fields.
 */
const PROVIDER_PICKER_KEYWORD = "provider";



export async function handleCredentialSet(args: string[]): Promise<void> {
  // Branch: `alix credential set provider [keyLabel] [value]` — interactive
  // provider picker. The `keyLabel` and `value` slots are optional; if
  // missing, the user is prompted (keyLabel plain, value hidden).
  if (args[0]?.toLowerCase() === PROVIDER_PICKER_KEYWORD) {
    if (!process.stdin.isTTY) {
      console.error(
        "Usage: alix credential set <provider> <keyLabel> <value>\n" +
          "(interactive `provider` keyword requires a TTY; supply the values as positional args in non-TTY contexts)",
      );
      process.exit(1);
    }
    const { resolveProviders, selectFromList } = await import("../../helpers/provider-selection.js");
    const { prompt, promptHidden } = await import("../prompt.js");
    const providers = await resolveProviders();
    if (providers.length === 0) {
      console.error("No providers available to pick from.");
      process.exit(1);
    }
    const picked = await selectFromList(
      providers,
      (p) => `${p.name} — ${p.apiKeySource}${p.reason ? ` (${p.reason})` : ""}`,
      { header: "Select a provider:" },
    );
    if (!picked) {
      console.error("No provider selected.");
      process.exit(1);
    }
    const keyLabel = args[1] ?? (await prompt("Key label [apiKey]: ")) ?? "apiKey";
    const value = args[2] ?? (await promptHidden("Value: "));
    if (!value) {
      console.error("Refusing to store an empty credential value.");
      process.exit(1);
    }
    args = [picked.id, keyLabel, value];
  }

  const provider = args[0];
  const keyLabel = args[1];
  const value = args[2];

  if (!provider || !keyLabel || value === undefined) {
    console.error("Usage: alix credential set <provider> <keyLabel> <value>");
    process.exit(1);
  }

  const store = await createCredentialStore();
  const entry = await store.set(provider, keyLabel, value);
  const reference = makeCredentialReference(provider, keyLabel);

  // Wire the reference into the user config's `apiKeys` so CLI commands can
  // discover the key. A `cred://` reference is a pointer (safe to persist) —
  // the secret itself lives only in the store.
  const { setApiKey } = await import("../../helpers/api-keys.js");
  await setApiKey(provider, reference);

  if (jsonMode) {
    console.log(JSON.stringify({ id: entry.id, provider: entry.provider, keyLabel: entry.keyLabel, created: entry.createdAt }));
  } else {
    console.log(`Credential stored: ${reference}`);
    console.log(`ID: ${entry.id}`);
  }
}


// ---------------------------------------------------------------------------
// alix credential delete
// ---------------------------------------------------------------------------

export async function handleCredentialDelete(args: string[]): Promise<void> {
  const provider = args[0];
  const keyLabel = args[1];

  if (!provider || !keyLabel) {
    console.error("Usage: alix credential delete <provider> <keyLabel>");
    process.exit(1);
  }

  const store = await createCredentialStore();
  const deleted = await store.delete(provider, keyLabel);

  if (!deleted) {
    console.error(`Credential not found: ${provider}/${keyLabel}`);
    process.exit(1);
  }

  // Best-effort: remove the apiKeys reference for this provider so CLI
  // commands stop trying to resolve a now-deleted credential.
  try {
    const { deleteApiKey } = await import("../../helpers/api-keys.js");
    await deleteApiKey(provider);
  } catch {
    /* config write failure should not mask the delete */
  }

  if (jsonMode) {
    console.log(JSON.stringify({ deleted: true, provider, keyLabel }));
  } else {
    console.log(`Deleted: ${provider}/${keyLabel}`);
  }
}


// ---------------------------------------------------------------------------
// alix credential migrate
// ---------------------------------------------------------------------------

export async function handleCredentialMigrate(args: string[]): Promise<void> {
  setJsonMode(args.includes("--json"));
  const dryRun = args.includes("--dry-run");

  // `--to <backend>` migrates BETWEEN credential backends (plain-file ⇄
  // keychain ⇄ encrypted-file). Without it, the existing config→store
  // migration runs.
  const toIdx = args.indexOf("--to");
  if (toIdx >= 0) {
    const to = args[toIdx + 1];
    if (to !== "keychain" && to !== "plain-file" && to !== "encrypted-file") {
      console.error("Usage: alix credential migrate --to <keychain|plain-file|encrypted-file>");
      process.exit(1);
    }
    // No --passphrase flag: a CLI-arg passphrase would land in shell history
    // and the process list. Passphrases come from ALIX_CREDENTIAL_PASSPHRASE
    // (headless) or an interactive hidden prompt (TTY).
    await migrateBetweenBackends(to as CredentialBackend, { dryRun });
    return;
  }

  const cwd = process.cwd();
  const home = homedir();

  if (!jsonMode) {
    if (dryRun) {
      console.log("Credential Migration — DRY RUN (no changes will be made)\n");
    } else {
      console.log("Credential Migration\n");
    }
  }

  try {
    const result = await migrateCredentials(cwd, home, { dryRun });

    if (jsonMode) {
      console.log(JSON.stringify({ dryRun, ...result }));
    } else {
      console.log(`Migrated:  ${result.migrated}`);
      console.log(`Skipped:   ${result.skipped}`);
      if (result.errors.length > 0) {
        console.log(`Errors:    ${result.errors.length}`);
        for (const err of result.errors) {
          console.log(`  - ${err}`);
        }
      }
      console.log();

      for (const file of result.files) {
        if (file.migrated.length === 0 && file.skipped.length === 0 && file.errors.length === 0) {
          continue; // Skip files with no action
        }
        console.log(`File: ${file.path}`);
        for (const m of file.migrated) console.log(`  ✓ migrated: ${m}`);
        for (const s of file.skipped) console.log(`  − skipped: ${s}`);
        for (const e of file.errors) console.log(`  ✗ error: ${e}`);
        console.log();
      }

      if (dryRun && result.migrated > 0) {
        console.log("This was a dry run. Run without --dry-run to apply changes.");
      }
    }

    if (result.errors.length > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error(`Migration failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}


/**
 * Migrate credential entries between backends (plain-file ⇄ keychain).
 * Reads every entry from the current active backend and writes it to the
 * target backend. `migratedFrom` is recorded on each target entry (the
 * source backend); `backend` is set by the target provider. The source
 * store is left intact (safety / easy rollback via `migrate --to` back).
 * On success, the active-backend selector is updated so future
 * `createCredentialStore()` calls use the target.
 *
 * Not atomic in the strictest sense (the selector flips after the copy),
 * but idempotent: re-running with the same `--to` is a no-op because the
 * selector already points at the target. A failed copy never flips the
 * selector, so a partial run rolls back cleanly to the source backend.
 */
export async function migrateBetweenBackends(
  to: CredentialBackend,
  opts: { dryRun?: boolean },
): Promise<void> {
  const dryRun = opts.dryRun ?? false;
  const current = await chooseBackend();

  if (current === to) {
    console.log(`Credential store is already using the ${to} backend. No migration needed.`);
    return;
  }

  // Resolve the passphrase only when an encrypted-file backend is involved
  // (source OR target). Wrong/missing passphrase must surface loudly.
  // Env var (headless) → interactive hidden prompt (TTY) → error.
  let passphrase: string | undefined;
  if (current === "encrypted-file" || to === "encrypted-file") {
    const { promptHidden } = await import("../prompt.js");
    passphrase = await resolveCredentialPassphrase(undefined, promptHidden);
  }

  if (!jsonMode) {
    console.log(
      dryRun
        ? `Credential Backend Migration — DRY RUN (${current} → ${to})\n`
        : `Credential Backend Migration (${current} → ${to})\n`,
    );
  }

  // Source = current active backend, constructed exactly (no keychain
  // fallback — migrate reads what is selected, and a down keychain is a
  // hard error here, not a silent downgrade).
  const sourceStore = await createCredentialStoreForBackend(current, passphrase);
  await sourceStore.load();

  // Target = the other backend, via the single construction factory. In
  // dry-run mode the target does NOT need to exist — this is a preview.
  // Constructing + probing it (especially the keychain) would make
  // `--dry-run --to keychain` fail when the keychain is down, which is
  // the exact opposite of a dry run's purpose.
  let targetStore: CredentialStore | undefined;
  if (!dryRun) {
    try {
      targetStore = await createCredentialStoreForBackend(to, passphrase);
      await targetStore.load();
    } catch (err) {
      console.error(
        `Cannot migrate to ${to}: backend unavailable (${err instanceof Error ? err.message : String(err)}).`,
      );
      process.exit(1);
    }
  }

  const entries = sourceStore.list();
  let migrated = 0;

  for (const entry of entries) {
    const value = sourceStore.get(entry.provider, entry.keyLabel);
    if (value === null) continue;
    if (dryRun) {
      migrated++;
      continue;
    }
    // Record `migratedFrom` on the entry (issue #350 metadata field): the
    // source backend is what the entry came from. `backend` is set by the
    // target provider itself. Existing metadata is carried over verbatim.
    await targetStore!.set(entry.provider, entry.keyLabel, value, entry.metadata, current);
    migrated++;
  }

  if (!jsonMode) {
    console.log(`Migrated:  ${migrated}`);
    if (dryRun) {
      console.log(`Source backend (${current}) unchanged.`);
      console.log("This was a dry run. Run without --dry-run to apply.");
      return;
    }
  }

  if (dryRun) return;

  await writeStoredBackend(to);

  // Scrub the plain-file source so no plain-text secrets remain on disk.
  // The keychain source (metadata) holds no values, so this only matters
  // when the source is plain-file.
  if (current === "plain-file") {
    await scrubPlainFileStore();
  }

  if (jsonMode) {
    console.log(JSON.stringify({ migrated, from: current, to }));
  } else {
    console.log(`Active backend set to: ${to}`);
    if (current === "plain-file") {
      console.log("Source plain-file store scrubbed of plain-text values (empty tomb left in place).");
    } else if (current === "encrypted-file") {
      console.log("Source encrypted-file retained (it is encrypted at rest; delete it to remove).");
    } else {
      console.log(`Source ${current} metadata retained (keychain metadata holds no values).`);
    }
    console.log(`Roll back with: alix credential migrate --to ${current}`);
  }
}
