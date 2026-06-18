/**
 * security.ts — Security diagnostics for ALiX.
 *
 * Provides the `security doctor` CLI command that reports the
 * current Inspector boundary state and security configuration.
 */

import { loadConfig } from "../../config/loader.js";
import { isLoopbackHost } from "../../config/validator.js";
import type { AlixConfig, UiSecurityConfig } from "../../config/schema.js";

export async function handleSecurityDoctor(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = await loadConfig(cwd, { requireModel: false });

  console.log("ALiX Security Doctor — Inspector Boundary State\n");

  const host = config.ui.host;
  const port = config.ui.port;
  const enabled = config.ui.enabled;
  const sec = config.ui.security;

  console.log(`Inspector:    ${enabled ? `enabled (${host}:${port})` : "disabled"}`);
  console.log(`Loopback:     ${isLoopbackHost(host) ? "yes" : "no"}`);
  console.log(`Binding:      ${isLoopbackHost(host) ? "safe (loopback)" : "EXTERNAL"}`);
  console.log();

  if (sec) {
    console.log("Security configuration:");
    console.log(`  authentication:      ${sec.authentication}`);
    console.log(`  remoteAccess:        ${sec.remoteAccess}`);
    console.log(`  requireTlsForRemote: ${sec.requireTlsForRemote}`);
    console.log(`  allowedHosts:        ${sec.allowedHosts.length > 0 ? sec.allowedHosts.join(", ") : "(none)"}`);
    console.log(`  allowedOrigins:      ${sec.allowedOrigins.length > 0 ? sec.allowedOrigins.join(", ") : "(none)"}`);
    console.log(`  trustedProxyCidrs:  ${sec.trustedProxyCidrs.length > 0 ? sec.trustedProxyCidrs.join(", ") : "(none)"}`);
  } else {
    console.log("Security configuration: (none — using defaults)");
  }

  console.log();

  // Summary
  if (!isLoopbackHost(host) && host !== "0.0.0.0") {
    console.log("⚠  WARNING: Inspector is bound to a non-loopback address.");
    console.log("   Remote access is not yet approved until authentication lands.");
    console.log("   Set ui.host to 127.0.0.1 for safe local development.");
  } else if (host === "0.0.0.0") {
    console.log("⚠  WARNING: Inspector is bound to all interfaces (0.0.0.0).");
    console.log("   Set ui.host to 127.0.0.1 for loopback-only access.");
    console.log("   See docs/security/inspector-security.md for details.");
  } else {
    console.log("✓ Inspector is bound to loopback — safe.");
  }
}
