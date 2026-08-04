import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessTrust,
  decideInstall,
  renderInstallReport,
  createInstallGate,
  type InstallGateInput,
} from "../../src/skills/trust.js";
import type { ManifestReport } from "../../src/skills/security.js";
import type { SkillScanResult } from "../../src/skills/security.js";

const marketplaces = [
  { name: "anthropics/skills", url: "https://github.com/anthropics/skills" },
  { name: "acme", url: "https://github.com/acme/skills" },
];
const verifiedUrls = ["https://github.com/anthropics/skills", "https://github.com/langfuse/skills"];

function baseInput(overrides: Partial<InstallGateInput> = {}): InstallGateInput {
  return {
    name: "x",
    source: "https://github.com/acme/skills",
    trust: assessTrust("https://github.com/acme/skills", { marketplaces, verifiedUrls }),
    manifest: { requestedTools: [], requires: [], license: "MIT", warnings: [], deny: false } as ManifestReport,
    scan: null,
    force: false,
    interactive: false,
    requireConfirmation: true,
    ...overrides,
  };
}

describe("assessTrust", () => {
  it("labels a default-marketplace source verified-marketplace", () => {
    const t = assessTrust("https://github.com/anthropics/skills", { marketplaces, verifiedUrls });
    assert.equal(t.level, "verified-marketplace");
  });
  it("labels a user-registered marketplace source user-registered", () => {
    const t = assessTrust("https://github.com/acme/skills", { marketplaces, verifiedUrls });
    assert.equal(t.level, "user-registered");
  });
  it("labels a subpath of a marketplace as that marketplace's level", () => {
    const t = assessTrust("https://github.com/anthropics/skills/blob/main/tdd", { marketplaces, verifiedUrls });
    assert.equal(t.level, "verified-marketplace");
  });
  it("labels an arbitrary URL unsigned", () => {
    const t = assessTrust("https://example.com/x.md", { marketplaces, verifiedUrls });
    assert.equal(t.level, "unsigned");
  });
  it("labels a core source core", () => {
    const t = assessTrust("bundled:tdd", { marketplaces, verifiedUrls, coreSources: ["bundled:"] });
    assert.equal(t.level, "core");
  });
});

describe("decideInstall", () => {
  it("hard-denies on scan errors regardless of force", () => {
    const scan: SkillScanResult = {
      ok: false, filesScanned: 1, errorCount: 1, warningCount: 0,
      findings: [{ code: "SC_TARBALL_DENIED_FILE", severity: "error", message: "denied", filePath: ".env" }],
    };
    const d = decideInstall(baseInput({ scan, force: true }));
    assert.equal(d.outcome, "deny");
  });

  it("denies a spoofed-core manifest", () => {
    const manifest = { requestedTools: [], requires: [], license: undefined, warnings: [], deny: true, denyCode: "SC_SKILL_SPOOFED_CORE" } as ManifestReport;
    const d = decideInstall(baseInput({ manifest }));
    assert.equal(d.outcome, "deny");
  });

  it("approves core skills without confirmation", () => {
    const trust = assessTrust("bundled:tdd", { marketplaces, verifiedUrls, coreSources: ["bundled:"] });
    const d = decideInstall(baseInput({ trust }));
    assert.equal(d.outcome, "approve");
  });

  it("approves with --force even when non-interactive", () => {
    const trust = assessTrust("https://example.com/x.md", { marketplaces, verifiedUrls });
    const d = decideInstall(baseInput({ trust, force: true, interactive: false }));
    assert.equal(d.outcome, "approve");
  });

  it("approves when confirmation disabled by config", () => {
    const trust = assessTrust("https://example.com/x.md", { marketplaces, verifiedUrls });
    const d = decideInstall(baseInput({ trust, requireConfirmation: false }));
    assert.equal(d.outcome, "approve");
  });

  it("fails closed for non-core unsigned non-interactive installs", () => {
    const trust = assessTrust("https://example.com/x.md", { marketplaces, verifiedUrls });
    const d = decideInstall(baseInput({ trust, interactive: false }));
    assert.equal(d.outcome, "deny");
    assert.match(d.reason, /--force/);
  });

  it("asks for confirmation in interactive mode", () => {
    const trust = assessTrust("https://example.com/x.md", { marketplaces, verifiedUrls });
    const d = decideInstall(baseInput({ trust, interactive: true }));
    assert.equal(d.outcome, "confirm");
  });
});

describe("createInstallGate", () => {
  it("runs the injected prompt and returns the decision", async () => {
    const gate = createInstallGate(async () => true);
    const ok = await gate(baseInput({ interactive: true }));
    assert.equal(ok.outcome, "approve");
    assert.equal(ok.reason, "user confirmed interactive prompt");
  });
  it("denies when the prompt answers no", async () => {
    const gate = createInstallGate(async () => false);
    const ok = await gate(baseInput({ interactive: true }));
    assert.equal(ok.outcome, "deny");
    assert.equal(ok.reason, "user declined interactive prompt");
  });
  it("surfaces the real decision reason for auto-denies", async () => {
    const gate = createInstallGate(async () => true);
    const blocked = await gate(baseInput({ interactive: false, force: false }));
    assert.equal(blocked.outcome, "deny");
    assert.match(blocked.reason, /requires --force/);
  });
});

describe("renderInstallReport", () => {
  it("includes trust level, tools, license, and scan findings", () => {
    const input = baseInput({
      interactive: true,
      manifest: { requestedTools: ["bash"], requires: [], license: "MIT", warnings: [], deny: false } as ManifestReport,
      scan: { ok: true, filesScanned: 2, errorCount: 0, warningCount: 1, findings: [{ code: "SC_SKILL_DANGEROUS_SCRIPT", severity: "warning", message: "possible dangerous pattern in scripts/nuke.sh: recursive force delete", filePath: "scripts/nuke.sh" }] },
    });
    const report = renderInstallReport(input);
    assert.match(report, /Trust: user-registered/);
    assert.match(report, /Requested tools: bash/);
    assert.match(report, /License: MIT/);
    assert.match(report, /\[warning\]/);
  });
});
