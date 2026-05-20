// tests/security/secret-scanner.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { SecretScanner } from "../../src/security/secret-scanner.js";

describe("SecretScanner", () => {
  it("detects API keys", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('const apiKey = "sk-1234567890abcdef"');
    assert.ok(findings.some(f => f.type === "api_key"));
  });

  it("detects AWS credentials", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE');
    assert.ok(findings.some(f => f.type === "aws_key"));
  });

  it("detects private keys", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan("-----BEGIN RSA PRIVATE KEY-----");
    assert.ok(findings.some(f => f.type === "private_key"));
  });

  it("detects passwords in config", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('password: "mysecretpass"');
    assert.ok(findings.some(f => f.type === "password"));
  });

  it("reports location and context", () => {
    const scanner = new SecretScanner();
    const findings = scanner.scan('DB_PASSWORD="secret123"\nconst db = connect();');
    const finding = findings[0];
    assert.ok(finding.line);
    assert.ok(finding.column);
    assert.ok(finding.context);
  });

  it("sanitizes findings for logging", () => {
    const scanner = new SecretScanner();
    const finding = scanner.scanOne('api_key = "sk-1234567890abcdef"');
    assert.ok(!finding?.value.includes("1234567890"));
    assert.ok(finding?.value.includes("sk-1"));
  });
});