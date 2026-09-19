/**
 * `alix credential / inspector / recovery / security / serve` subcommands — extracted from `src/cli.ts`
 * (#717 step 6). Bodies moved verbatim; each handler terminates via `process.exit`.
 */

import "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, projectConfigDir } from "../../config/loader.js";
import "../../config/model-resolver.js";
import "../../index.js";
import "./prompt.js";
import "../helpers/api-keys.js";
import "../../providers/catalog.js";
import "../../daemon/daemon-paths.js";

export async function handleServe(_args: string[]): Promise<void> {
  const config = await loadConfig(process.cwd());
  if (!config.ui?.enabled) {
    console.error("UI inspector is not enabled. Set ui.enabled=true in your config.");
    process.exit(1);
  }
  // Startup security check
  const { checkStartupSafety } = await import("../../security/inspector/remote-access-policy.js");
  const safety = checkStartupSafety(config);
  for (const w of safety.warnings) {
    console.error(`\x1b[33m${w}\x1b[0m`); // yellow
  }
  if (!safety.ok) {
    console.error(`\x1b[31m${safety.error}\x1b[0m`); // red
    process.exit(1);
  }
  const { startServer } = await import("../../server/server.js");
  const sec = config.ui.security;
  const server = await startServer(
    process.cwd(),
    config.ui.host,
    config.ui.port,
    sec?.allowedHosts,
    sec?.allowedOrigins,
    sec?.trustedProxyCidrs,
    sec?.authentication,
  );
  console.log(`ALiX inspector running at ${server.url}`);
  // Graceful shutdown: close the server (which aborts in-flight
  // coordination runs and their worker children) before exiting.
  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal} — shutting down inspector…`);
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  await new Promise(() => undefined);
}

export async function handleInspectorOpen(_args: string[]): Promise<void> {
  const { startServer } = await import("../../server/server.js");
  const { execFile } = await import("node:child_process");
  const { platform } = await import("node:os");

  const config = await loadConfig(process.cwd());
  const host = config.ui?.host ?? "localhost";
  const port = config.ui?.port ?? 4137;

  // Startup security check
  const { checkStartupSafety } = await import("../../security/inspector/remote-access-policy.js");
  const safety = checkStartupSafety(config);
  for (const w of safety.warnings) {
    console.error(`\x1b[33m${w}\x1b[0m`);
  }
  if (!safety.ok) {
    console.error(`\x1b[31m${safety.error}\x1b[0m`);
    process.exit(1);
  }

  const sec = config.ui?.security;
  const server = await startServer(
    process.cwd(),
    host,
    port,
    sec?.allowedHosts,
    sec?.allowedOrigins,
    sec?.trustedProxyCidrs,
    sec?.authentication,
  );
  const url = server.url;

  // Open browser (platform-aware, best-effort)
  const platformName = platform();
  const openBrowser = (cmd: string, args: string[]) => {
    try {
      execFile(cmd, args, () => {});
    } catch {
      // Browser open is best-effort — user can copy the URL
    }
  };

  if (platformName === "darwin") {
    openBrowser("open", [url]);
  } else if (platformName === "win32") {
    openBrowser("cmd", ["/c", "start", url]);
  } else {
    openBrowser("xdg-open", [url]);
  }

  console.log(`\n  ALiX Inspector: ${url}\n`);
  console.log("  Press Ctrl+C to stop the server.\n");

  // Block until SIGINT
  await new Promise(() => {});
}

export async function handleSecurityDoctor(args: string[]): Promise<void> {
  const { handleSecurityDoctor } = await import("./security.js");
  await handleSecurityDoctor(args.slice(1));
  process.exit(0);
}

export async function handleSecurityConfigKeygen(_args: string[]): Promise<void> {
  const { ConfigSigner } = await import("../../config/signing.js");
  try {
    const result = await ConfigSigner.generateAndPersistKey();
    console.log(`Signing keypair generated.`);
    console.log(`Private key: ${result.keyPath}`);
    console.log(`Key ID:      ${result.publicKey.slice(0, 20)}...`);
    console.log();
    console.log("Public key (share this with config verifiers):");
    console.log(result.publicKey);
  } catch (err: any) {
    console.error(`Key generation failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleSecurityConfigSign(_args: string[]): Promise<void> {
  const alixDir = projectConfigDir(process.cwd());
  const { ConfigSigner } = await import("../../config/signing.js");
  const { ConfigMutationService } = await import("../../config/mutation.js");
  try {
    const signer = new ConfigSigner();
    const service = new ConfigMutationService(alixDir);
    const version = await service.getVersion();
    const provenance = await service.getProvenance();
    const prevHash = provenance.length > 0 ? provenance[provenance.length - 1].configHash : null;
    const sig = await signer.sign(alixDir, version, prevHash);
    console.log(`Config signed successfully.`);
    console.log(`Key ID:      ${sig.keyId}`);
    console.log(`Version:     ${sig.configVersion}`);
    console.log(`Config hash: ${sig.configHash}`);
    console.log(`Signed at:   ${sig.signedAt}`);
    console.log(`Signature:   .alix/config.sig`);

    // P4.4c: Record signing evidence
    try {
      const { ConfigTrustHistory } = await import("../../security/evidence/config-trust-history.js");
      const history = new ConfigTrustHistory();
      const ev = await history.recordSign(sig);
      if (ev) {
        console.log(`Evidence:    ${ev.fingerprint}`);
      }
    } catch {
      // Evidence recording is best-effort
    }
  } catch (err: any) {
    console.error(`Signing failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleSecurityConfigVerify(_args: string[]): Promise<void> {
  const alixDir = projectConfigDir(process.cwd());
  const { ConfigSigner } = await import("../../config/signing.js");
  const { ConfigMutationService } = await import("../../config/mutation.js");
  try {
    const signer = new ConfigSigner();
    const publicKeyPem = await signer.getPublicKey().catch(() => null);
    if (!publicKeyPem) {
      console.error("No signing key found. Generate one with: alix security config keygen");
      console.error("Or import a trusted key with: alix security config trust-key <path>");
      process.exit(1);
    }

    const verifyResult = await signer.verify(alixDir, publicKeyPem);
    if (verifyResult.ok) {
      const sig = await ConfigSigner.readSignature(alixDir);
      const service = new ConfigMutationService(alixDir);
      const version = await service.getVersion();
      const rollback = await ConfigSigner.checkRollback(sig?.configVersion ?? version);

      console.log("Config signature: VALID");
      if (sig) {
        console.log(`Key ID:      ${sig.keyId}`);
        console.log(`Version:     ${sig.configVersion}`);
        console.log(`Config hash: ${sig.configHash}`);
        console.log(`Signed at:   ${sig.signedAt}`);
      }
      if (rollback.ok) {
        console.log("Anti-rollback: OK");
      } else {
        console.log(`Anti-rollback: WARNING — ${rollback.error}`);
      }
    } else {
      console.error(`Config signature: INVALID`);
      console.error(`  ${verifyResult.error}`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`Verification failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleSecurityConfigTrustKey(args: string[]): Promise<void> {
  const keyPath = args[2];
  if (!keyPath) {
    console.error("Usage: alix security config trust-key <path-to-public-key.pem>");
    process.exit(1);
  }
  const { readFile, mkdir: mkdirP } = await import("node:fs/promises");
  const { existsSync: existsP } = await import("node:fs");
  if (!existsP(keyPath)) {
    console.error(`File not found: ${keyPath}`);
    process.exit(1);
  }
  try {
    const pem = await readFile(keyPath, "utf-8");
    if (!pem.includes("PUBLIC KEY")) {
      console.error("File does not contain a valid public key (PEM format).");
      process.exit(1);
    }
    // Store trusted key in user config
    const homedirP = (await import("node:os")).homedir();
    const trustedDir = join(homedirP, ".config", "alix");
    await mkdirP(trustedDir, { recursive: true });
    const trustedPath = join(trustedDir, "trusted-signing-key.pem");
    await writeFile(trustedPath, pem);
    console.log(`Trusted key imported: ${trustedPath}`);
    const { createHash } = await import("node:crypto");
    const keyId = createHash("sha256").update(pem).digest("hex").slice(0, 16);
    console.log(`Key ID: ${keyId}`);
  } catch (err: any) {
    console.error(`Failed to import key: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleSecurityConfigAllowRollback(args: string[]): Promise<void> {
  const reasonIdx = args.indexOf("--reason");
  const reason = reasonIdx >= 0 ? args[reasonIdx + 1] : undefined;
  if (!reason) {
    console.error('Usage: alix security config allow-rollback --reason "<reason>"');
    process.exit(1);
  }
  const alixDir = projectConfigDir(process.cwd());
  const { ConfigMutationService } = await import("../../config/mutation.js");
  const { ConfigSigner } = await import("../../config/signing.js");
  try {
    const service = new ConfigMutationService(alixDir);
    const version = await service.getVersion();
    await ConfigSigner.acceptVersion(version);
    console.log(`Accepted config version ${version}.`);
    console.log(`Reason: ${reason}`);
  } catch (err: any) {
    console.error(`Failed: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

export async function handleCredential(args: string[]): Promise<void> {
  const sub = args[0] ?? "";
  const subArgs = args.slice(1);
  const {
    handleCredentialList,
    handleCredentialGet,
    handleCredentialSet,
    handleCredentialDelete,
    handleCredentialMigrate,
  } = await import("./security.js");

  if (sub === "list") {
    await handleCredentialList(subArgs);
  } else if (sub === "get") {
    await handleCredentialGet(subArgs);
  } else if (sub === "set") {
    await handleCredentialSet(subArgs);
  } else if (sub === "delete") {
    await handleCredentialDelete(subArgs);
  } else if (sub === "migrate") {
    await handleCredentialMigrate(subArgs);
  } else {
    console.error("Usage: alix credential {list|get|set|delete|migrate} [options]");
    console.error("  list [--json]");
    console.error("  get <provider> <keyLabel>");
    console.error("  set <provider> <keyLabel> <value>");
    console.error("  delete <provider> <keyLabel>");
    console.error("  migrate [--dry-run] [--json]");
    process.exit(1);
  }
  process.exit(0);
}

export async function handleInspectorAuth(args: string[]): Promise<void> {
  const sub = args[1] ?? "";
  const subArgs = args.slice(2);
  const {
    handleInspectorAuthCreate,
    handleInspectorAuthList,
    handleInspectorAuthRotate,
    handleInspectorAuthRevoke,
    handleInspectorAuthDoctor,
  } = await import("./security.js");

  if (sub === "create") {
    await handleInspectorAuthCreate(subArgs);
  } else if (sub === "list") {
    await handleInspectorAuthList(subArgs);
  } else if (sub === "rotate") {
    await handleInspectorAuthRotate(subArgs);
  } else if (sub === "revoke") {
    await handleInspectorAuthRevoke(subArgs);
  } else if (sub === "doctor") {
    await handleInspectorAuthDoctor(subArgs);
  } else {
    console.error("Usage: alix inspector auth {create|list|rotate|revoke|doctor}");
    console.error("  create --name <name> --role <role> [--json]");
    console.error("  list [--json]");
    console.error("  rotate <token-id> --grace <duration> [--json]");
    console.error("  revoke <token-id> [--yes] [--json]");
    console.error("  doctor [--json]");
    process.exit(1);
  }
  process.exit(0);
}

export async function handleSecuritySupplyChain(args: string[]): Promise<void> {
  const sub = args[1] ?? "";
  const subArgs = args.slice(2);

  if (sub === "lifecycle-check") {
    const { handleSupplyChainLifecycleCheck } = await import("./security.js");
    await handleSupplyChainLifecycleCheck(subArgs);
    process.exit(0);
  }

  if (sub === "exceptions") {
    const { handleSupplyChainExceptions } = await import("./security.js");
    await handleSupplyChainExceptions(subArgs);
    process.exit(0);
  }

  if (sub === "verify-tarball") {
    const { handleSupplyChainVerifyTarball } = await import("./security.js");
    await handleSupplyChainVerifyTarball(subArgs);
    process.exit(0);
  }

  console.error("Usage: alix security supply-chain {lifecycle-check|exceptions|verify-tarball} [--json]");
  console.error("  lifecycle-check          Check lifecycle scripts against allowlist");
  console.error("  exceptions list           List all audit exceptions");
  console.error("  exceptions check          Check npm audit against exceptions policy");
  console.error("  verify-tarball <path>     Verify tarball contents against security policy");
  process.exit(1);
}

export async function handleSecurity(_args: string[]): Promise<void> {
  console.error("Usage: alix security doctor");
  console.error("       alix security config keygen|sign|verify|trust-key|allow-rollback");
  console.error("       alix security supply-chain lifecycle-check|exceptions|verify-tarball");
  console.error("       alix security gate [--json]");
  console.error("Usage: alix security doctor [--json]");
  console.error("       alix security gate [--json]");

  console.error("       alix credential list|get|set|delete|migrate");
  process.exit(1);
}

export async function handleRecovery(args: string[]): Promise<void> {
  const { cmdScan, cmdInspect, cmdRepair, cmdVerify } = await import("./recover.js");
  const sub = args[0];
  if (sub === "scan") await cmdScan(args.slice(1));
  else if (sub === "inspect") await cmdInspect(args.slice(1));
  else if (sub === "repair") await cmdRepair(args.slice(1));
  else if (sub === "verify") await cmdVerify(args.slice(1));
  else {
    console.error("Usage: alix recovery {scan|inspect|repair|verify} [options]");
    process.exit(1);
  }
  process.exit(0);
}

