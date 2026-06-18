/**
 * Tests for P4.3-Sf.5 — Package verifier (tarball content check).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkPathDeny,
  checkSecretContent,
  verifyTarball,
  VERIFIER_ERROR_CODES,
} from "../../../src/security/supply-chain/package-verifier.js";
import type { TarballEntry } from "../../../src/security/supply-chain/package-verifier.js";

// ---------------------------------------------------------------------------
// checkPathDeny
// ---------------------------------------------------------------------------

describe("checkPathDeny", () => {
  it("rejects .env files", () => {
    const finding = checkPathDeny("package/.env");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
    assert.ok(finding.message.includes(".env"));
  });

  it("rejects .env.production files", () => {
    const finding = checkPathDeny("package/.env.production");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects .alix/ directories", () => {
    const finding = checkPathDeny("package/.alix/sessions/session.json");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects credential files", () => {
    const finding = checkPathDeny("package/credentials.json");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects auth store files", () => {
    const finding = checkPathDeny("package/auth-store.json");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects private keys (.pem)", () => {
    const finding = checkPathDeny("package/certs/private-key.pem");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects private keys (id_rsa)", () => {
    const finding = checkPathDeny("package/.ssh/id_rsa");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects audit logs", () => {
    const finding = checkPathDeny("package/.alix/audit/audit.jsonl");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects session logs", () => {
    const finding = checkPathDeny("package/sessions.log");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects secret-like fixtures", () => {
    const finding = checkPathDeny("package/tests/fixtures/secret-data.json");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("rejects .DS_Store", () => {
    const finding = checkPathDeny("package/.DS_Store");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });

  it("accepts normal source files", () => {
    assert.equal(checkPathDeny("package/dist/cli.js"), null);
    assert.equal(checkPathDeny("package/README.md"), null);
    assert.equal(checkPathDeny("package/package.json"), null);
    assert.equal(checkPathDeny("package/LICENSE"), null);
  });

  it("accepts normal test files", () => {
    assert.equal(checkPathDeny("package/tests/test.js"), null);
    assert.equal(checkPathDeny("package/src/index.ts"), null);
  });

  it("rejects .npmrc files", () => {
    const finding = checkPathDeny("package/.npmrc");
    assert.ok(finding);
    assert.equal(finding.code, VERIFIER_ERROR_CODES.DENIED_FILE);
  });
});

// ---------------------------------------------------------------------------
// checkSecretContent
// ---------------------------------------------------------------------------

describe("checkSecretContent", () => {
  it("detects private key markers in content", () => {
    const findings = checkSecretContent(
      "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34G...",
      "test/file.txt"
    );
    assert.ok(findings.length > 0);
    assert.equal(findings[0].code, VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT);
    assert.ok(findings[0].message.includes("private_key_marker"));
  });

  it("detects GitHub PAT in content", () => {
    const findings = checkSecretContent(
      'const token = "ghp_123456789012345678901234567890123456";',
      "src/config.ts"
    );
    assert.ok(findings.length > 0);
    assert.equal(findings[0].code, VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT);
    assert.ok(findings[0].message.includes("github_pat"));
  });

  it("detects OpenAI API keys in content", () => {
    const findings = checkSecretContent(
      'const apiKey = "sk-12345678901234567890123456789012";',
      "src/providers.ts"
    );
    assert.ok(findings.length > 0);
    assert.equal(findings[0].code, VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT);
    assert.ok(findings[0].message.includes("openai_api_key"));
  });

  it("detects AWS access keys in content", () => {
    const findings = checkSecretContent(
      "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "scripts/deploy.sh"
    );
    assert.ok(findings.length > 0);
    assert.equal(findings[0].code, VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT);
    assert.ok(findings[0].message.includes("aws_access_key"));
  });

  it("detects password assignments", () => {
    const findings = checkSecretContent(
      'password: "super_secret_password_123"',
      "config.json"
    );
    assert.ok(findings.length > 0);
    assert.equal(findings[0].code, VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT);
    assert.ok(findings[0].message.includes("assigned_secret"));
  });

  it("detects Bearer tokens", () => {
    const findings = checkSecretContent(
      "Authorization: Bearer abc123def456ghi789jkl012",
      "src/auth.ts"
    );
    assert.ok(findings.length > 0);
    assert.ok(findings[0].code === VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT ||
               findings.some((f) => f.code === VERIFIER_ERROR_CODES.SECRET_LIKE_CONTENT));
  });

  it("returns empty for clean content", () => {
    const findings = checkSecretContent(
      "const x = 1;\nfunction foo() { return 42; }",
      "src/utils.ts"
    );
    assert.equal(findings.length, 0);
  });

  it("reports line numbers for matches", () => {
    const findings = checkSecretContent(
      "line 1\nline 2\nconst key = 'ghp_123456789012345678901234567890123456';",
      "test.ts"
    );
    assert.ok(findings.length > 0);
    assert.equal(findings[0].line, 3);
  });
});

// ---------------------------------------------------------------------------
// verifyTarball
// ---------------------------------------------------------------------------

describe("verifyTarball", () => {
  it("passes a clean tarball", () => {
    const entries: TarballEntry[] = [
      { path: "package/package.json", size: 100 },
      { path: "package/dist/cli.js", size: 5000 },
      { path: "package/README.md", size: 200 },
      { path: "package/LICENSE", size: 100 },
    ];
    const result = verifyTarball(entries);
    assert.ok(result.ok);
    assert.equal(result.totalFiles, 4);
    assert.equal(result.passed, 4);
    assert.equal(result.findings.length, 0);
  });

  it("flags denied files in tarball", () => {
    const entries: TarballEntry[] = [
      { path: "package/package.json", size: 100 },
      { path: "package/.env", size: 50 },
      { path: "package/dist/cli.js", size: 5000 },
    ];
    const result = verifyTarball(entries);
    assert.ok(!result.ok);
    assert.equal(result.passed, 2);
    assert.ok(result.findings.some((f) => f.code === VERIFIER_ERROR_CODES.DENIED_FILE));
  });

  it("flags secret-like fixture content", () => {
    const entries: TarballEntry[] = [
      { path: "package/package.json", size: 100 },
      { path: "package/tests/fixtures/secret-data.json", size: 500 },
    ];
    const result = verifyTarball(entries);
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.code === VERIFIER_ERROR_CODES.DENIED_FILE));
  });

  it("flags scan depth exceeded for too many files", () => {
    const entries: TarballEntry[] = Array.from({ length: 1001 }, (_, i) => ({
      path: `package/file-${i}.js`,
      size: 100,
    }));
    const result = verifyTarball(entries, { maxTotalFiles: 1000 });
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.code === VERIFIER_ERROR_CODES.SCAN_DEPTH_EXCEEDED));
  });

  it("warns for deeply nested paths", () => {
    const entries: TarballEntry[] = [
      { path: "package/" + Array.from({ length: 10 }, () => "deep").join("/") + "/file.js", size: 100 },
    ];
    const result = verifyTarball(entries, { maxScanDepth: 5 });
    assert.ok(result.ok); // deep path is a warning, not error
    assert.ok(result.findings.some((f) => f.code === VERIFIER_ERROR_CODES.SCAN_DEPTH_EXCEEDED));
  });

  it("rejects credential store files", () => {
    const entries: TarballEntry[] = [
      { path: "package/package.json", size: 100 },
      { path: "package/credential-store.json", size: 500 },
    ];
    const result = verifyTarball(entries);
    assert.ok(!result.ok);
    assert.ok(result.findings.some((f) => f.code === VERIFIER_ERROR_CODES.DENIED_FILE));
  });

  it("accepts files within allowed paths", () => {
    const entries: TarballEntry[] = [
      { path: "package/bin/alix.js", size: 100 },
      { path: "package/dist/src/cli.js", size: 5000 },
      { path: "package/dist/tests/test.js", size: 2000 },
      { path: "package/node_modules/.package-lock.json", size: 500 },
      { path: "package/package.json", size: 100 },
    ];
    const result = verifyTarball(entries);
    assert.ok(result.ok);
    assert.equal(result.passed, 5);
  });
});
